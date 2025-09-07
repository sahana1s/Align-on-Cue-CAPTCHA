import secrets
import time
import hmac
import hashlib
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

app = FastAPI()

SECRET_KEY = "supersecretkey"
CHALLENGE_DB = {}

class FlashLagAnswer(BaseModel):
    nonce: str
    chosen_index: int
    ts: int
    digest: str

@app.get("/challenge/flashlag")
def get_flashlag_challenge():
    """Issue a flash-lag challenge"""
    nonce = secrets.token_urlsafe(16)
    target_index = secrets.randbelow(9)  # 0–8
    created = int(time.time() * 1000)
    ephemeral_key = secrets.token_urlsafe(24)

    CHALLENGE_DB[nonce] = {
        "target_index": target_index,
        "created": created,
        "ephemeral_key": ephemeral_key,
        "ttl_ms": 20000  # <-- 20 seconds now
    }

    return {
        "nonce": nonce,
        "ephemeral_key": ephemeral_key,
        "grid_size": 3,
        "frame_ms": 400,
        "ttl_ms": 20000,
        "target_index": target_index  # demo only for MVP
    }

@app.post("/validate/flashlag")
def validate_flashlag(answer: FlashLagAnswer):
    if answer.nonce not in CHALLENGE_DB:
        return {"status": "error", "reason": "invalid nonce"}

    ch = CHALLENGE_DB[answer.nonce]
    now = int(time.time() * 1000)

    # Enforce strict TTL (now 20s)
    if now - ch["created"] > ch["ttl_ms"]:
        # invalidate nonce
        CHALLENGE_DB.pop(answer.nonce, None)
        return {"status": "fail", "reason": "timeout"}

    msg = f"{answer.nonce}|{answer.chosen_index}|{answer.ts}"
    expected_digest = hmac.new(
        ch["ephemeral_key"].encode(), msg.encode(), hashlib.sha256
    ).hexdigest()

    print(f"[DEBUG] Nonce={answer.nonce} Target={ch['target_index']} "
          f"ClientTS={answer.ts} ExpectedHMAC={expected_digest} "
          f"ReceivedHMAC={answer.digest}")

    if not hmac.compare_digest(answer.digest, expected_digest):
        return {"status": "error", "reason": "invalid digest"}

    # one-time nonce use
    CHALLENGE_DB.pop(answer.nonce, None)

    if answer.chosen_index == ch["target_index"]:
        return {"status": "success"}
    else:
        return {"status": "fail", "reason": "wrong index"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
