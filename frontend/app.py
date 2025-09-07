import streamlit as st
import requests
import time
import hmac
import hashlib

BACKEND = "http://localhost:8000"

def make_digest(nonce, val, ts, key):
    msg = f"{nonce}|{val}|{ts}"
    return hmac.new(key.encode(), msg.encode(), hashlib.sha256).hexdigest()

st.set_page_config(page_title="Flash-Lag CAPTCHA")
st.title("Flash-Lag CAPTCHA MVP")

if "challenge" not in st.session_state:
    if st.button("Start Challenge"):
        st.session_state.challenge = requests.get(f"{BACKEND}/challenge/flashlag").json()
        st.session_state.flash_shown = False

if "challenge" in st.session_state:
    ch = st.session_state.challenge
    grid_size = ch["grid_size"]
    target_index = ch["target_index"]
    frame_ms = ch["frame_ms"]

    st.write("Watch carefully: one cell will flash briefly (⚡).")

    # --- Pre-render grid with placeholders ---
    if "placeholders" not in st.session_state:
        placeholders = []
        for _row in range(grid_size):
            cols = st.columns(grid_size)
            for c in cols:
                placeholders.append(c.empty())
        # Fill grid with blanks
        for p in placeholders:
            p.markdown("⬜")
        st.session_state.placeholders = placeholders

    placeholders = st.session_state.placeholders

    # --- Flash button ---
    if not st.session_state.flash_shown:
        if st.button("Show Flash"):
            placeholders[target_index].markdown("### ⚡")
            time.sleep(frame_ms / 1000.0)
            placeholders[target_index].markdown("⬜")
            st.session_state.flash_shown = True

    # --- After flash, allow answer input ---
    if st.session_state.flash_shown:
        chosen_index = st.number_input("Which cell flashed? (0–8)", 0, 8, 0)
        if st.button("Submit"):
            ts = int(time.time() * 1000)
            digest = make_digest(ch["nonce"], chosen_index, ts, ch["ephemeral_key"])
            payload = {
                "nonce": ch["nonce"],
                "chosen_index": int(chosen_index),
                "ts": ts,
                "digest": digest
            }
            result = requests.post(f"{BACKEND}/validate/flashlag", json=payload).json()
            st.write("Validation result:", result)
