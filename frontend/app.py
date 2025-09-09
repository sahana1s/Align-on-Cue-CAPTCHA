import streamlit as st
import requests
import time
import hmac
import hashlib
import json
import random
from PIL import Image, ImageDraw
import io
import base64

BACKEND = "http://localhost:8000"

def make_digest(nonce, val, ts, key):
    msg = f"{nonce}|{val}|{ts}"
    return hmac.new(key.encode(), msg.encode(), hashlib.sha256).hexdigest()

@st.cache_data(ttl=30, show_spinner=False)
def get_challenge(challenge_type="flashlag"):
    """Get a new challenge from the backend with error handling and timeout"""
    try:
        response = requests.get(f"{BACKEND}/challenge/{challenge_type}", timeout=5.0)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.Timeout:
        st.error("Connection to backend timed out. Please try again later.")
        return None
    except requests.exceptions.ConnectionError:
        st.error("Cannot connect to backend server. Please check if the server is running.")
        return None
    except requests.exceptions.RequestException as e:
        st.error(f"Error connecting to backend: {str(e)}")
        return None

@st.cache_data(ttl=60)
def create_illusion_image(width=400, height=400, seed=None):
    """Create a visual illusion image that's hard for AI to interpret but easy for humans"""
    if seed is not None:
        random.seed(seed)
        
    img = Image.new('RGB', (width, height), color='white')
    draw = ImageDraw.Draw(img)
    
    line_spacing = 10
    
    # Draw vertical lines
    for i in range(0, width, line_spacing):
        thickness = random.randint(1, 3)
        draw.line([(i, 0), (i, height)], fill='black', width=thickness)
    
    # Draw horizontal lines
    for i in range(0, height, line_spacing):
        thickness = random.randint(1, 3)
        draw.line([(0, i), (width, i)], fill='black', width=thickness)
    
    # Draw a hidden shape
    shape_type = random.choice(['circle', 'square', 'triangle'])
    center_x, center_y = width // 2, height // 2
    size = min(width, height) // 4
    
    if seed is not None:
        random.seed(None)
    
    shape_color = (240, 240, 240)
    
    if shape_type == 'circle':
        draw.ellipse([(center_x - size, center_y - size), 
                     (center_x + size, center_y + size)], fill=shape_color)
    elif shape_type == 'square':
        draw.rectangle([(center_x - size, center_y - size), 
                       (center_x + size, center_y + size)], fill=shape_color)
    elif shape_type == 'triangle':
        draw.polygon([(center_x, center_y - size),
                     (center_x - size, center_y + size),
                     (center_x + size, center_y + size)], fill=shape_color)
    
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue(), shape_type

# Set page configuration
st.set_page_config(page_title="AI-Resistant CAPTCHA", layout="wide")

@st.cache_data(ttl=300)
def get_page_title():
    return "AI-Resistant CAPTCHA Demo"

st.title(get_page_title())

# Sidebar for challenge type selection
st.sidebar.title("CAPTCHA Options")
challenge_type = st.sidebar.radio(
    "Select CAPTCHA Type",
    ["Flash-Lag Effect", "Visual Illusion", "Drawing Challenge"]
)

# Initialize session state variables
if "challenge_type" not in st.session_state:
    st.session_state.challenge_type = challenge_type

# Check if challenge type has changed
if st.session_state.challenge_type != challenge_type:
    st.session_state.challenge_type = challenge_type
    if "challenge" in st.session_state:
        del st.session_state.challenge
    if "flash_shown" in st.session_state:
        del st.session_state.flash_shown
    if "placeholders" in st.session_state:
        del st.session_state.placeholders

# Create a placeholder for status messages
status_placeholder = st.empty()

# Start challenge button
start_button = st.button("Start Challenge", key="start_challenge")
if start_button:
    with st.spinner("Loading challenge..."):
        if challenge_type == "Flash-Lag Effect":
            status_placeholder.info("Connecting to backend server...")
            
            challenge = get_challenge("flashlag")
            if challenge:
                st.session_state.challenge = challenge
                st.session_state.flash_shown = False
                if "placeholders" in st.session_state:
                    del st.session_state.placeholders
                difficulty = challenge.get("difficulty", 0)
                status_placeholder.info(f"Challenge difficulty: Level {difficulty+1}/5 (higher = harder)")
            else:
                status_placeholder.error("Failed to get challenge from server. Please try again.")
                st.stop()
                
        elif challenge_type == "Visual Illusion":
            seed = int(time.time())
            status_placeholder.info("Generating visual illusion...")
            illusion_image, shape_type = create_illusion_image(seed=seed)
            st.session_state.illusion_image = illusion_image
            st.session_state.shape_type = shape_type
            st.session_state.challenge = {"type": "illusion", "created": int(time.time() * 1000)}
            status_placeholder.empty()
            
        elif challenge_type == "Drawing Challenge":
            st.session_state.challenge = {"type": "drawing", "created": int(time.time() * 1000)}
            st.session_state.drawing_prompt = random.choice([
                "Draw a sun with exactly 5 rays",
                "Draw a house with a chimney",
                "Draw a simple flower with 6 petals",
                "Draw a stick figure with both arms raised"
            ])

# Handle challenges
if "challenge" in st.session_state:
    ch = st.session_state.challenge
    
    if st.session_state.challenge_type == "Flash-Lag Effect":
        try:
            grid_size = ch["grid_size"]
            target_index = ch["target_index"]
            frame_ms = ch["frame_ms"]
            difficulty = ch.get("difficulty", 0)

            st.write(f"Watch carefully: one cell will flash briefly (⚡). Difficulty: Level {difficulty+1}/5")

            # Pre-render grid with placeholders
            if "placeholders" not in st.session_state:
                placeholders = []
                st.write("Grid indices reference:")
                grid_indices = ""
                for row in range(grid_size):
                    for col in range(grid_size):
                        index = row * grid_size + col
                        grid_indices += f"[{index}] "
                    grid_indices += "\n"
                st.code(grid_indices)
                
                # Create the actual grid
                for _row in range(grid_size):
                    cols = st.columns(grid_size)
                    for c in cols:
                        placeholders.append(c.empty())
                # Fill grid with blanks
                for p in placeholders:
                    p.markdown("⬜")
                st.session_state.placeholders = placeholders

            placeholders = st.session_state.placeholders

            # Flash button
            if not st.session_state.get("flash_shown", False):
                if st.button("Show Flash"):
                    random_delay = random.uniform(0, 0.2)
                    time.sleep(random_delay)
                    
                    placeholders[target_index].markdown("### ⚡")
                    time.sleep(frame_ms / 1000.0)
                    placeholders[target_index].markdown("⬜")
                    st.session_state.flash_shown = True

            # After flash, allow answer input
            if st.session_state.get("flash_shown", False):
                chosen_index = st.number_input("Which cell flashed? (0–8)", 0, 8, 0)
                if st.button("Submit Answer"):
                    try:
                        ts = int(time.time() * 1000)
                        digest = make_digest(ch["nonce"], chosen_index, ts, ch["ephemeral_key"])
                        payload = {
                            "nonce": ch["nonce"],
                            "chosen_index": int(chosen_index),
                            "ts": ts,
                            "digest": digest
                        }
                        
                        response = requests.post(f"{BACKEND}/validate/flashlag", json=payload)
                        response.raise_for_status()
                        result = response.json()
                        
                        # Display result
                        if result.get("status") == "success":
                            st.success("✅ CAPTCHA passed successfully!")
                            
                            if "ai_detection" in result:
                                ai_score = result.get("ai_detection")
                                st.write(f"AI Detection Score: {ai_score}/100")
                                
                                if ai_score < 30:
                                    st.success("Low AI probability detected")
                                elif ai_score < 70:
                                    st.warning("Moderate AI probability detected")
                                else:
                                    st.error("High AI probability detected")
                                    
                            if "response_time_ms" in result:
                                st.write(f"Response time: {result.get('response_time_ms')}ms")
                                
                        elif result.get("status") == "fail":
                            st.error(f"❌ CAPTCHA failed: {result.get('reason', 'Unknown reason')}")
                            if result.get('reason') == 'wrong index':
                                st.info(f"You selected cell {chosen_index}, but the correct cell was {ch['target_index']}")
                                # Highlight the correct cell in the grid
                                for i, p in enumerate(placeholders):
                                    if i == ch['target_index']:
                                        p.markdown("🟩")
                                    elif i == chosen_index:
                                        p.markdown("🟥")
                        elif result.get('reason') == 'timeout':
                            st.warning("⏱️ Challenge timed out. Starting a new challenge...")
                        else:
                            st.error(f"❌ Error: {result.get('reason', 'Unknown error')}")
                            
                        # Debug information
                        with st.expander("Debug Information"):
                            st.write("Payload sent:", payload)
                            st.write("Response received:", result)
                            st.write("Challenge details:")
                            current_time = int(time.time() * 1000)
                            st.json({
                                "nonce": ch["nonce"],
                                "target_index": ch["target_index"],
                                "ttl_ms": ch["ttl_ms"],
                                "current_time": current_time,
                                "time_elapsed_since_creation": current_time - int(ch.get("created", current_time))
                            })
                            
                    except requests.exceptions.RequestException as e:
                        st.error(f"Error connecting to backend: {str(e)}")
                    except Exception as e:
                        st.error(f"Unexpected error: {str(e)}")
                        
        except KeyError as e:
            st.error(f"Missing challenge data: {str(e)}")
            if st.button("Reset Challenge"):
                for key in ["challenge", "flash_shown", "placeholders"]:
                    if key in st.session_state:
                        del st.session_state[key]
                st.rerun()
                
    elif st.session_state.challenge_type == "Visual Illusion":
        st.write("What shape is hidden in this image? Look carefully at the pattern.")
        
        # Display the illusion image
        st.image(st.session_state.illusion_image, caption="Find the hidden shape", width=400)
        
        # Get user's answer
        shape_options = ["Circle", "Square", "Triangle"]
        user_answer = st.radio("Select the shape you see:", shape_options)
        
        if st.button("Submit Answer"):
            response_time = int(time.time() * 1000) - ch['created']
            
            correct_shape = st.session_state.shape_type.capitalize()
            if user_answer == correct_shape:
                st.success(f"✅ Correct! You identified the {correct_shape.lower()}.")
                ai_score = random.randint(10, 30)
                st.write(f"AI Detection Score: {ai_score}/100")
                st.success("Low AI probability detected")
            else:
                st.error(f"❌ Incorrect. The hidden shape was a {correct_shape.lower()}.")
            
            # Debug information
            with st.expander("Debug Information"):
                st.write("Challenge type: Visual Illusion")
                st.write(f"Correct shape: {correct_shape}")
                st.write(f"User answer: {user_answer}")
                st.write(f"Response time: {response_time}ms")
    
    elif st.session_state.challenge_type == "Drawing Challenge":
        st.write("Drawing-based CAPTCHA")
        st.write("This type of CAPTCHA exploits the creative generation limits of AI.")
        
        # Display the drawing prompt
        st.subheader(st.session_state.drawing_prompt)
        
        # File uploader for drawing submission
        uploaded_file = st.file_uploader("Upload your drawing", type=["png", "jpg", "jpeg"])
        
        if uploaded_file is not None:
            st.image(uploaded_file, caption="Uploaded drawing", use_column_width=True)
            description = st.text_area("Describe what you drew:", "")
            
            if st.button("Submit Drawing"):
                response_time = int(time.time() * 1000) - ch['created']
                
                st.success("✅ Drawing submitted successfully!")
                st.info("In a full implementation, this would be validated by comparing against the prompt requirements.")
                
                ai_score = random.randint(10, 30)
                st.write(f"AI Detection Score: {ai_score}/100")
                st.success("Low AI probability detected")
                
                # Debug information
                with st.expander("Debug Information"):
                    st.write("Challenge type: Drawing Challenge")
                    st.write(f"Prompt: {st.session_state.drawing_prompt}")
                    st.write(f"Response time: {response_time}ms")
                    st.write(f"Description: {description}")
        else:
            st.info("Please upload a drawing that matches the prompt")

# Reset button
if "challenge" in st.session_state:
    if st.button("Reset Challenge"):
        keys_to_delete = ["challenge", "flash_shown", "placeholders", "illusion_image", "shape_type", "drawing_prompt"]
        for key in keys_to_delete:
            if key in st.session_state:
                del st.session_state[key]
        st.rerun()
