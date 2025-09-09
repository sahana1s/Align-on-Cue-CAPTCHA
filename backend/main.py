import secrets
import time
import hmac
import hashlib
import logging
import base64
from io import BytesIO
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, validator
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
import numpy as np
import cv2
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI-Resistant CAPTCHA API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = "supersecretkey"  
CHALLENGE_DB = {}
USER_PERFORMANCE = {}

# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    logger.info(f"{request.method} {request.url.path} - {response.status_code} - {process_time:.4f}s")
    return response

class FlashLagAnswer(BaseModel):
    nonce: str
    chosen_index: int
    ts: int
    digest: str
    
    @validator('nonce')
    def validate_nonce(cls, v):
        if not v or len(v) < 8:
            raise ValueError('Invalid nonce format')
        return v
        
    @validator('chosen_index')
    def validate_index(cls, v):
        if not (0 <= v <= 8):
            raise ValueError('Chosen index must be between 0 and 8')
        return v

def cleanup_expired_challenges():
    """Remove expired challenges from the database"""
    now = int(time.time() * 1000)
    expired_nonces = []
    
    for nonce, challenge in CHALLENGE_DB.items():
        if now - challenge["created"] > challenge["ttl_ms"]:
            expired_nonces.append(nonce)
    
    for nonce in expired_nonces:
        CHALLENGE_DB.pop(nonce, None)
    
    if expired_nonces:
        logger.info(f"Cleaned up {len(expired_nonces)} expired challenges")

def determine_difficulty(client_ip):
    """Determine difficulty level based on user's past performance"""
    if client_ip not in USER_PERFORMANCE:
        USER_PERFORMANCE[client_ip] = {
            "attempts": 0,
            "successes": 0,
            "difficulty": 0,
            "last_attempt": int(time.time())
        }
        return 0
    
    user_data = USER_PERFORMANCE[client_ip]
    
    # Reset difficulty if it's been a while (24 hours)
    if int(time.time()) - user_data["last_attempt"] > 86400:
        user_data["difficulty"] = 0
        user_data["attempts"] = 0
        user_data["successes"] = 0
    
    # Calculate success rate if we have enough attempts
    if user_data["attempts"] >= 3:
        success_rate = user_data["successes"] / user_data["attempts"]
        
        if success_rate > 0.8 and user_data["difficulty"] < 4:
            user_data["difficulty"] += 1
        elif success_rate < 0.3 and user_data["difficulty"] > 0:
            user_data["difficulty"] -= 1
    
    return user_data["difficulty"]

@app.get("/challenge/flashlag")
def get_flashlag_challenge(request: Request):
    """Issue a flash-lag challenge with adaptive difficulty"""
    try:
        client_ip = request.client.host
        difficulty = determine_difficulty(client_ip)
        
        nonce = secrets.token_urlsafe(16)
        target_index = secrets.randbelow(9)  # 0–8
        created = int(time.time() * 1000)
        ephemeral_key = secrets.token_urlsafe(24)

        cleanup_expired_challenges()
        
        # Adjust frame_ms based on difficulty
        frame_ms = max(200, 400 - (difficulty * 50))
        
        CHALLENGE_DB[nonce] = {
            "target_index": target_index,
            "created": created,
            "ephemeral_key": ephemeral_key,
            "ttl_ms": 60000,
            "difficulty": difficulty,
            "client_ip": client_ip
        }
        
        logger.info(f"New challenge created: nonce={nonce}, target={target_index}, difficulty={difficulty}")

        return {
            "nonce": nonce,
            "ephemeral_key": ephemeral_key,
            "grid_size": 3,
            "frame_ms": frame_ms,
            "ttl_ms": 60000,
            "target_index": target_index,
            "created": created,
            "difficulty": difficulty
        }
    except Exception as e:
        logger.error(f"Error generating challenge: {str(e)}")
        raise HTTPException(status_code=500, detail="Error generating challenge")

def calculate_ai_detection_score(challenge, response_time_ms):
    """Calculate a score indicating likelihood of AI solver (0-100, higher = more likely AI)"""
    score = 0
    
    if response_time_ms is not None:
        if response_time_ms < 500:
            score += 30
        elif response_time_ms < 1000:
            score += 15
        elif response_time_ms < 5000:
            score += 0
        else:
            score -= 10
    
    difficulty = challenge.get("difficulty", 0)
    if difficulty >= 3:
        score += difficulty * 5
    
    if "client_ip" in challenge and challenge["client_ip"] in USER_PERFORMANCE:
        user_data = USER_PERFORMANCE[challenge["client_ip"]]
        if user_data["attempts"] > 5 and user_data["successes"] / user_data["attempts"] > 0.9:
            score += 20
    
    return max(0, min(100, score))

@app.post("/validate/flashlag")
def validate_flashlag(answer: FlashLagAnswer):
    try:
        if answer.nonce not in CHALLENGE_DB:
            logger.warning(f"Invalid nonce attempted: {answer.nonce}")
            return {"status": "error", "reason": "invalid nonce"}

        ch = CHALLENGE_DB[answer.nonce]
        now = int(time.time() * 1000)

        if now - ch["created"] > ch["ttl_ms"]:
            CHALLENGE_DB.pop(answer.nonce, None)
            logger.info(f"Challenge timeout: nonce={answer.nonce}, elapsed={now - ch['created']}ms")
            return {"status": "fail", "reason": "timeout"}

        # Validate HMAC digest
        msg = f"{answer.nonce}|{answer.chosen_index}|{answer.ts}"
        expected_digest = hmac.new(
            ch["ephemeral_key"].encode(), msg.encode(), hashlib.sha256
        ).hexdigest()

        logger.info(f"Validation attempt: Nonce={answer.nonce} Target={ch['target_index']} "
              f"Chosen={answer.chosen_index} ClientTS={answer.ts}")

        if not hmac.compare_digest(answer.digest, expected_digest):
            logger.warning(f"Invalid digest for nonce={answer.nonce}")
            return {"status": "error", "reason": "invalid digest"}

        # One-time nonce use
        CHALLENGE_DB.pop(answer.nonce, None)

        # Update user performance tracking
        if "client_ip" in ch and ch["client_ip"] in USER_PERFORMANCE:
            USER_PERFORMANCE[ch["client_ip"]]["attempts"] += 1
            USER_PERFORMANCE[ch["client_ip"]]["last_attempt"] = int(time.time())
        
        response_time_ms = answer.ts - ch["created"]
        ai_detection_score = calculate_ai_detection_score(ch, response_time_ms)
        
        if answer.chosen_index == ch["target_index"]:
            if "client_ip" in ch and ch["client_ip"] in USER_PERFORMANCE:
                USER_PERFORMANCE[ch["client_ip"]]["successes"] += 1
            
            logger.info(f"CAPTCHA passed: nonce={answer.nonce}, difficulty={ch.get('difficulty', 0)}, ai_score={ai_detection_score}")
            return {
                "status": "success", 
                "difficulty": ch.get("difficulty", 0),
                "ai_detection": ai_detection_score,
                "response_time_ms": response_time_ms
            }
        else:
            logger.info(f"CAPTCHA failed: nonce={answer.nonce}, chosen={answer.chosen_index}, target={ch['target_index']}")
            return {
                "status": "fail", 
                "reason": "wrong index", 
                "difficulty": ch.get("difficulty", 0),
                "ai_detection": ai_detection_score,
                "response_time_ms": response_time_ms
            }
    except Exception as e:
        logger.error(f"Error validating CAPTCHA: {str(e)}")
        raise HTTPException(status_code=500, detail="Error validating CAPTCHA")

@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": int(time.time())}

@app.get("/challenge/illusion")
def get_illusion_challenge(request: Request):
    """Issue a visual illusion challenge"""
    try:
        client_ip = request.client.host
        difficulty = determine_difficulty(client_ip)
        
        nonce = secrets.token_urlsafe(16)
        shape_options = ["circle", "square", "triangle", "star", "heart"]
        target_shape = secrets.choice(shape_options)
        created = int(time.time() * 1000)
        ephemeral_key = secrets.token_urlsafe(24)

        cleanup_expired_challenges()
        
        CHALLENGE_DB[nonce] = {
            "target_shape": target_shape,
            "created": created,
            "ephemeral_key": ephemeral_key,
            "ttl_ms": 60000,
            "difficulty": difficulty,
            "client_ip": client_ip,
            "type": "illusion"
        }
        
        logger.info(f"New illusion challenge created: nonce={nonce}, shape={target_shape}, difficulty={difficulty}")

        return {
            "nonce": nonce,
            "ephemeral_key": ephemeral_key,
            "ttl_ms": 60000,
            "difficulty": difficulty,
            "created": created
        }
    except Exception as e:
        logger.error(f"Error generating illusion challenge: {str(e)}")
        raise HTTPException(status_code=500, detail="Error generating challenge")

@app.get("/challenge/drawing")
def get_drawing_challenge(request: Request):
    """Issue a drawing challenge"""
    try:
        client_ip = request.client.host
        difficulty = determine_difficulty(client_ip)
        
        nonce = secrets.token_urlsafe(16)
        drawing_prompts = [
            "Draw a sun with exactly 5 rays",
            "Draw a house with a chimney",
            "Draw a simple flower with 6 petals",
            "Draw a stick figure with both arms raised",
            "Draw a cat with whiskers"
        ]
        
        advanced_prompts = [
            "Draw a clock showing exactly 3:45",
            "Draw a face with one eye closed and one eye open",
            "Draw a hand making a peace sign",
            "Draw a butterfly with symmetrical wings",
            "Draw a cube in 3D perspective"
        ]
        
        if difficulty >= 3:
            prompt = secrets.choice(advanced_prompts)
        else:
            prompt = secrets.choice(drawing_prompts)
            
        created = int(time.time() * 1000)
        ephemeral_key = secrets.token_urlsafe(24)

        cleanup_expired_challenges()
        
        expected_features = extract_expected_features(prompt)
        
        CHALLENGE_DB[nonce] = {
            "prompt": prompt,
            "created": created,
            "ephemeral_key": ephemeral_key,
            "ttl_ms": 120000,  # 2 minutes for drawing
            "difficulty": difficulty,
            "client_ip": client_ip,
            "type": "drawing",
            "expected_features": expected_features
        }
        
        logger.info(f"New drawing challenge created: nonce={nonce}, prompt={prompt}, difficulty={difficulty}")

        return {
            "nonce": nonce,
            "ephemeral_key": ephemeral_key,
            "prompt": prompt,
            "ttl_ms": 120000,
            "difficulty": difficulty,
            "created": created
        }
    except Exception as e:
        logger.error(f"Error generating drawing challenge: {str(e)}")
        raise HTTPException(status_code=500, detail="Error generating challenge")

class IllusionAnswer(BaseModel):
    nonce: str
    chosen_shape: str
    response_time_ms: int = None
    
    @validator('nonce')
    def validate_nonce(cls, v):
        if not v or len(v) < 8:
            raise ValueError('Invalid nonce format')
        return v

@app.post("/validate/illusion")
def validate_illusion(answer: IllusionAnswer):
    """Validate a visual illusion challenge response"""
    try:
        nonce = answer.nonce
        chosen_shape = answer.chosen_shape
        response_time = answer.response_time_ms
        
        if nonce not in CHALLENGE_DB:
            logger.warning(f"Invalid nonce attempted: {nonce}")
            return {"status": "error", "reason": "invalid nonce"}

        ch = CHALLENGE_DB[nonce]
        now = int(time.time() * 1000)

        if now - ch["created"] > ch["ttl_ms"]:
            CHALLENGE_DB.pop(nonce, None)
            logger.info(f"Challenge timeout: nonce={nonce}, elapsed={now - ch['created']}ms")
            return {"status": "fail", "reason": "timeout"}
        
        # Remove challenge (one-time use)
        CHALLENGE_DB.pop(nonce, None)
        
        if "client_ip" in ch and ch["client_ip"] in USER_PERFORMANCE:
            USER_PERFORMANCE[ch["client_ip"]]["attempts"] += 1
            USER_PERFORMANCE[ch["client_ip"]]["last_attempt"] = int(time.time())
        
        ai_detection_score = calculate_ai_detection_score(ch, response_time)
        
        if chosen_shape == ch["target_shape"]:
            if "client_ip" in ch and ch["client_ip"] in USER_PERFORMANCE:
                USER_PERFORMANCE[ch["client_ip"]]["successes"] += 1
            
            logger.info(f"Illusion CAPTCHA passed: nonce={nonce}, difficulty={ch.get('difficulty', 0)}, ai_score={ai_detection_score}")
            return {
                "status": "success", 
                "difficulty": ch.get("difficulty", 0),
                "ai_detection": ai_detection_score
            }
        else:
            logger.info(f"Illusion CAPTCHA failed: nonce={nonce}, chosen={chosen_shape}, target={ch['target_shape']}, difficulty={ch.get('difficulty', 0)}")
            return {
                "status": "fail", 
                "reason": "wrong shape", 
                "difficulty": ch.get("difficulty", 0),
                "ai_detection": ai_detection_score
            }
    except Exception as e:
        logger.error(f"Error validating illusion CAPTCHA: {str(e)}")
        raise HTTPException(status_code=500, detail="Error validating CAPTCHA")

def extract_expected_features(prompt):
    """Extract expected features from a drawing prompt"""
    features = {}
    
    if "sun" in prompt.lower():
        features["shape"] = "circle"
        if "5 rays" in prompt.lower():
            features["rays"] = 5
    elif "house" in prompt.lower():
        features["shape"] = "house"
        if "chimney" in prompt.lower():
            features["has_chimney"] = True
    elif "flower" in prompt.lower():
        features["shape"] = "flower"
        if "6 petals" in prompt.lower():
            features["petals"] = 6
    elif "stick figure" in prompt.lower():
        features["shape"] = "human"
        if "arms raised" in prompt.lower():
            features["arms_raised"] = True
    elif "cat" in prompt.lower():
        features["shape"] = "cat"
        if "whiskers" in prompt.lower():
            features["has_whiskers"] = True
    elif "clock" in prompt.lower():
        features["shape"] = "clock"
        if "3:45" in prompt.lower():
            features["time"] = "3:45"
    elif "face" in prompt.lower():
        features["shape"] = "face"
        if "eye closed" in prompt.lower():
            features["eye_closed"] = True
            
    return features

def extract_image_features(image):
    """Extract features from an uploaded drawing image"""
    features = {}
    
    try:
        # Convert to grayscale for shape detection
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Apply threshold to get binary image
        _, binary = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY_INV)
        
        # Find contours
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        # Basic shape detection
        if len(contours) > 0:
            # Get the largest contour
            largest_contour = max(contours, key=cv2.contourArea)
            
            # Approximate the contour to detect shape
            epsilon = 0.04 * cv2.arcLength(largest_contour, True)
            approx = cv2.approxPolyDP(largest_contour, epsilon, True)
            
            # Detect basic shapes
            if len(approx) == 3:
                features["shape"] = "triangle"
            elif len(approx) == 4:
                # Check if it's a square or rectangle
                x, y, w, h = cv2.boundingRect(approx)
                aspect_ratio = float(w) / h
                if 0.95 <= aspect_ratio <= 1.05:
                    features["shape"] = "square"
                else:
                    features["shape"] = "rectangle"
            elif len(approx) == 5:
                features["shape"] = "pentagon"
            elif len(approx) >= 8 and len(approx) <= 12:
                # Could be a circle or an ellipse
                features["shape"] = "circle"
            
            # Check for specific features
            if features.get("shape") == "circle":
                # Count potential rays by looking for lines extending from the circle
                hull = cv2.convexHull(largest_contour)
                defects = cv2.convexityDefects(largest_contour, cv2.convexHull(largest_contour, returnPoints=False))
                if defects is not None:
                    ray_count = sum(1 for defect in defects if defect[0][3] > 1000)
                    features["rays"] = ray_count
    except Exception as e:
        logger.error(f"Error extracting image features: {str(e)}")
    
    return features

def compare_features(extracted, expected):
    """Compare extracted features with expected features"""
    if not expected:
        return 0.5  # No expectations, return neutral score
        
    total_points = len(expected)
    matched_points = 0
    
    for key, value in expected.items():
        if key in extracted and extracted[key] == value:
            matched_points += 1
    
    return matched_points / total_points if total_points > 0 else 0

class DrawingAnswer(BaseModel):
    nonce: str
    drawing_data: str  # Base64 encoded image
    response_time_ms: int = None
    
    @validator('nonce')
    def validate_nonce(cls, v):
        if not v or len(v) < 8:
            raise ValueError('Invalid nonce format')
        return v

@app.post("/validate/drawing")
def validate_drawing(answer: DrawingAnswer):
    """Validate a drawing challenge response"""
    try:
        nonce = answer.nonce
        drawing_data = answer.drawing_data
        response_time = answer.response_time_ms
        
        if nonce not in CHALLENGE_DB:
            logger.warning(f"Invalid nonce attempted: {nonce}")
            return {"status": "error", "reason": "invalid nonce"}

        ch = CHALLENGE_DB[nonce]
        now = int(time.time() * 1000)

        if now - ch["created"] > ch["ttl_ms"]:
            CHALLENGE_DB.pop(nonce, None)
            logger.info(f"Challenge timeout: nonce={nonce}, elapsed={now - ch['created']}ms")
            return {"status": "fail", "reason": "timeout"}
        
        if ch.get("type") != "drawing":
            return {"status": "fail", "reason": "wrong challenge type"}
        
        # Remove challenge (one-time use)
        CHALLENGE_DB.pop(nonce, None)
        
        if "client_ip" in ch and ch["client_ip"] in USER_PERFORMANCE:
            USER_PERFORMANCE[ch["client_ip"]]["attempts"] += 1
            USER_PERFORMANCE[ch["client_ip"]]["last_attempt"] = int(time.time())
        
        ai_detection_score = calculate_ai_detection_score(ch, response_time)
        
        # Process the drawing
        try:
            # Decode base64 image
            image_data = base64.b64decode(drawing_data)
            image = Image.open(BytesIO(image_data))
            
            # Convert to OpenCV format for analysis
            cv_image = np.array(image)
            cv_image = cv2.cvtColor(cv_image, cv2.COLOR_RGB2BGR)
            
            # Extract features from the drawing
            extracted_features = extract_image_features(cv_image)
            
            # Compare with expected features
            expected_features = ch.get("expected_features", {})
            match_score = compare_features(extracted_features, expected_features)
            
            # Determine if the drawing matches the prompt
            threshold = 0.6  # 60% match required
            if match_score >= threshold:
                if "client_ip" in ch and ch["client_ip"] in USER_PERFORMANCE:
                    USER_PERFORMANCE[ch["client_ip"]]["successes"] += 1
                
                logger.info(f"Drawing CAPTCHA passed: nonce={nonce}, match_score={match_score:.2f}, ai_score={ai_detection_score}")
                return {
                    "status": "success", 
                    "difficulty": ch.get("difficulty", 0),
                    "ai_detection": ai_detection_score,
                    "match_score": match_score
                }
            else:
                logger.info(f"Drawing CAPTCHA failed: nonce={nonce}, match_score={match_score:.2f}, ai_score={ai_detection_score}")
                return {
                    "status": "fail", 
                    "reason": "drawing does not match prompt", 
                    "difficulty": ch.get("difficulty", 0),
                    "ai_detection": ai_detection_score,
                    "match_score": match_score
                }
                
        except Exception as e:
            logger.error(f"Error processing drawing: {str(e)}")
            return {"status": "fail", "reason": "error processing drawing"}
            
    except Exception as e:
        logger.error(f"Error validating drawing CAPTCHA: {str(e)}")
        raise HTTPException(status_code=500, detail="Error validating CAPTCHA")

@app.get("/stats")
def get_stats():
    """Get basic statistics about the CAPTCHA system"""
    return {
        "active_challenges": len(CHALLENGE_DB),
        "server_time": int(time.time() * 1000),
        "challenge_types": {
            "flashlag": sum(1 for ch in CHALLENGE_DB.values() if ch.get("type", "flashlag") == "flashlag"),
            "illusion": sum(1 for ch in CHALLENGE_DB.values() if ch.get("type") == "illusion"),
            "drawing": sum(1 for ch in CHALLENGE_DB.values() if ch.get("type") == "drawing")
        },
        "user_count": len(USER_PERFORMANCE)
    }

if __name__ == "__main__":
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=8000,
        log_level="info"
    )
