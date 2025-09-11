# AI-Resistant CAPTCHA Systems
Traditional CAPTCHAs based on text, images, or audio are increasingly compromised, while biometric and adversarial methods raise concerns around privacy and usability. This project explores a new direction: cognitive and perceptual CAPTCHAs that leverage innate human advantages - such as flash-lag perception, biological motion, and gesture mimicry - to resist automation and relay attacks.

1. [Tilt and Align (Mobile)](https://sahana1s.github.io/Tilt-and-align-captcha/)
2. [Tilt and Align (Web)](https://sahana1s.github.io/Tilt-and-align-captcha/align/)
3. [Multimodal](https://jdeep1234.github.io/multimodalcaptcha/)

## Flash-Lag CAPTCHA
This prototype CAPTCHA system leverages **human temporal perception** - specifically the flash-lag illusion - to distinguish humans from AI bots.
<br> Users are challenged to identify a briefly flashed cell within a 3×3 grid, with a 20-second time limit to complete the task. To ensure security and prevent tampering or replay attacks, the backend enforces one-time-use nonces, strict time-to-live (TTL) constraints, and HMAC-based request signing for validation.

### Features
- **Flash-Lag CAPTCHA**: One cell flashes for 400 ms, user must click it.
- **Security**:
  - One-time nonce per challenge
  - HMAC digest validation with ephemeral key
  - 20s TTL enforced server-side
- **Lightweight**: Runs on any standard web/mobile browser.
- **Privacy-preserving**: No personal data or biometrics collected.

### Running the MVP

#### 1. Install dependencies
```
python -m venv venv
pip install -r requirements.txt
```

#### 2. Start the Backend
```
cd backend
uvicorn main:app --reload --port 8000
```
> Backend API runs at: ```http://localhost:8000```

#### 3. Start the Frontend
```
cd frontend
streamlit run app.py --server.port 8501
```
> Frontend UI runs at: ```http://localhost:8501```
