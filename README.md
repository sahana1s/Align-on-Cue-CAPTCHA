# Align-on-Cue CAPTCHA

A direction-agnostic alignment CAPTCHA that tests human reaction time and motor control while being resistant to automated attacks.

## How It Works 

1. **Challenge Generation**
   - Server generates a random target angle and challenge token
   - Challenge includes:
     - Random seed for angle generation
     - HMAC signature for security
     - Configurable tolerance (default 8°)
     - Expiration time (90 seconds)

2. **User Interaction**
   - User waits for a random-timed beep 🔔
   - Aligns a green bar with a semi-transparent red target bar
   - Can use mouse drag or keyboard arrows
   - Must submit within the beep duration
   - Bars are considered aligned even if 180° apart (parallel/anti-parallel)

3. **Anti-Bot Measures**
   - Collects natural movement patterns
   - Browser fingerprinting
   - Rate limiting per IP
   - Progressive difficulty based on risk level
   - Validates:
     - Movement naturalness
     - Reaction timing (60ms - 3000ms)
     - Challenge signatures
     - IP reputation

## Technical Implementation

### Server (`server.js`)
- Express.js server
- In-memory challenge storage
- HMAC-based challenge verification
- Movement pattern validation
- Risk-based difficulty adjustment
- IP-based rate limiting
- Detailed debug logging

### Client (`align_on_cue.html`)
- HTML5 Canvas for visualization
- Mouse and keyboard controls
- Audio feedback (beep)
- Movement tracking
- Browser fingerprinting
- Real-time angle normalization

## Security Features

1. **Challenge Security**
   - HMAC signature verification
   - Single-use challenges
   - 90-second expiration
   - Rate limiting

2. **Bot Detection**
   - Movement pattern analysis
   - Speed variance checking
   - Linear movement detection
   - Browser fingerprinting
   - Automation detection

3. **Risk Assessment**
   - IP-based tracking
   - Progressive difficulty
   - Suspicious behavior monitoring
   - Multiple validation layers

## Configuration

Key server settings:
```javascript
{
  TOLERANCE: 8,              // Degrees
  MIN_REACTION_MS: 60,      // Minimum reaction time
  MAX_REACTION_MS: 3000,    // Maximum reaction time
  CHALLENGE_TTL: 90         // Seconds
}
```

## Setup

1. Generate a secure CAPTCHA secret key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the generated key to your `.env` file:
```env
CAPTCHA_SECRET=your-generated-key-here
```

2. Install dependencies:
```bash
cd Align-on-cue
npm install
```

3. Start server:
```bash
cd Align-on-cue/server
node server.js
```
You should see: `Server running on http://localhost:3000`

4. In a new terminal, serve the client, from the root:
```bash
cd Align-on-cue
npx serve client -p 8080
```
Open your browser and navigate to: `http://localhost:8080/align_on_cue.html`

## Notes

- Direction-agnostic alignment (0° = 180°)
- Natural movement validation
- Progressive security measures
- Debug logging for monitoring
- CORS enabled for development
