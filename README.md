# Align-on-Cue CAPTCHA v1.2

A modern, secure, and user-friendly human verification system hardened against automation tools.

**Version:** 1.2.0

---

## Quick Start

```bash
# 1. Install dependencies
cd Align-on-Cue-CAPTCHA/Align-on-cue
npm install
cd server && npm install
cd ../client && npm install

# 2. Start server (Terminal 1)
cd server
$env:CAPTCHA_SECRET='d771471e8f76ef7d37594f223e056f1c2b775454ac81a2099f291ba9170e4e9f'
node server.js

# 3. Start client (Terminal 2)
cd ../client
npx http-server . -p 8080 -c-1

# 4. Open browser
# http://localhost:8080/align_on_cue.html
```

---

## Overview

A defense-in-depth CAPTCHA system combining client-side obfuscation and telemetry with server-side verification.

### Features

- HMAC-signed single-use challenges
- Device fingerprint binding
- Movement telemetry analysis
- Optional Proof-of-Work (POW)
- WebGL noise obfuscation
- Rate-limiting and behavioral tracking
- Dark mode with accessibility features
- Interactive tutorial

---

## Prerequisites

- Node.js 18+ ([Download](https://nodejs.org/))
- npm (bundled with Node.js)
- Optional: Docker for Redis

---

## Installation

### Step 1: Generate CAPTCHA_SECRET

**PowerShell:**
```powershell
$bytes = [byte[]]::new(32)
$rng = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
$rng.GetBytes($bytes)
$secret = ($bytes | ForEach-Object { "{0:x2}" -f $_ }) -join ""
Write-Host $secret
```

**Node.js:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Linux/Mac:**
```bash
openssl rand -hex 32
```

### Step 2: Configure Environment

Create `.env` in `Align-on-cue/server/`:

```
DEBUG=0
POW_DIFFICULTY=0
CAPTCHA_SECRET=<your-generated-secret>
PORT=3000
STRICT_ORIGIN=0
ALLOWED_ORIGINS=http://localhost:8080,http://localhost:3000
ADMIN_TOKEN=admin-secret-key
CHALLENGE_TTL_MS=90000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```

### Step 3: Start Server

**PowerShell:**
```powershell
cd Align-on-cue\server
$env:CAPTCHA_SECRET='<your-secret>'
node server.js
```

**Bash:**
```bash
cd Align-on-cue/server
CAPTCHA_SECRET='<your-secret>' node server.js
```

Expected: `Server running on http://localhost:3000`

### Step 4: Start Client

```bash
cd Align-on-cue/client
npx http-server . -p 8080 -c-1
```

Open: `http://localhost:8080/align_on_cue.html`

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG` | `0` | Enable verbose logging |
| `POW_DIFFICULTY` | `0` | Proof-of-Work difficulty (0-8, 0=disabled) |
| `CAPTCHA_SECRET` | Required | 64-char hex HMAC key |
| `PORT` | `3000` | Server port |
| `STRICT_ORIGIN` | `0` | Enforce CORS (0=dev, 1=prod) |
| `ALLOWED_ORIGINS` | `*` | CORS whitelist |
| `REDIS_URL` | Unset | Redis connection (optional) |
| `ADMIN_TOKEN` | `secret` | Admin authentication |
| `CHALLENGE_TTL_MS` | `90000` | Challenge expiry (ms) |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | `100` | Max attempts per window |

---

## Proof-of-Work Configuration

| Difficulty | Time | Use Case |
|-----------|------|----------|
| 0 | — | Development |
| 1 | ~50ms | Light protection |
| 2 | ~100ms | Production (recommended) |
| 3 | ~300ms | Standard protection |
| 4+ | ~1s+ | High-traffic sites |

---

## API Reference

### POST /api/v1/challenge

Generate a challenge.

**Request:**
```json
{
  "clientIP": "optional",
  "userAgent": "browser user agent"
}
```

**Response:**
```json
{
  "id": "challenge-uuid",
  "challenges": [{"index": 0, "x": 125, "y": 200}],
  "signature": "hmac-sha256-hex",
  "ttl": 90,
  "powDifficulty": 2
}
```

### POST /api/v1/verify

Verify submission.

**Request:**
```json
{
  "challengeID": "uuid",
  "submission": [0, 2, 4],
  "signature": "hmac-signature",
  "deviceFingerprint": "hash",
  "telemetry": {"movements": [...], "timestamps": [...]}
}
```

**Response:**
```json
{
  "success": true,
  "token": "session-token",
  "confidence": 0.92
}
```

### GET /admin/stats

Retrieve statistics (requires `ADMIN_TOKEN`).

---

## Security Features

### Defense Layers

1. HMAC cryptographic signing
2. Device fingerprint binding
3. Canvas fingerprint caching
4. Movement heuristics analysis
5. Temporal pattern detection
6. Behavioral tracking per IP
7. Automation signature detection
8. Rate limiting (100/15min)
9. Optional Proof-of-Work

### Anomaly Detection

- Velocity anomalies (reaction time changes)
- User-agent switching (account takeover)
- Suspicious reaction times (too fast)
- Perfect accuracy (robotic consistency)
- Constant intervals (bot patterns)
- Rapid attempts (brute force)

### Automation Signatures

- Webdriver API
- Selenium markers
- Headless browser indicators
- PhantomJS signatures
- Nightmare.js markers

---

## User Experience

### Accessibility

- WCAG 2.1 Level AA compliant
- Keyboard navigation (Tab, Enter, Space, Escape)
- Screen reader support
- High contrast mode
- Large text mode
- Motion-free option

### Customization

- Dark/light theme toggle
- Settings panel
- Interactive 5-step tutorial
- Persistent preferences

---

## Testing

```bash
# Test 1: Verify server
curl http://localhost:3000/api/v1/challenge -X POST -H "Content-Type: application/json"

# Test 2: Load client
# Open http://localhost:8080/align_on_cue.html

# Test 3: Dark mode
# Click settings (gear icon) and toggle dark mode

# Test 4: Accessibility
# Press Tab to navigate, Space to activate
```

---

## Troubleshooting

### Port already in use
```powershell
netstat -ano | findstr :3000
taskkill /PID <pid> /F
```

### CAPTCHA_SECRET not set
```powershell
$env:CAPTCHA_SECRET='your-64-char-hex-key'
node server.js
```

### CORS error
```powershell
$env:ALLOWED_ORIGINS='http://localhost:8080,http://localhost:3000'
```

### Dark mode not working
Clear browser cache: `Ctrl+Shift+R`

### Redis connection failed
Leave `REDIS_URL` unset for in-memory fallback.

### Verification fails
- Check CAPTCHA_SECRET is consistent
- Verify server URL in client
- Check browser console (F12)
- Enable `DEBUG=1` in server

---

## Production Checklist

- [ ] Generate strong `CAPTCHA_SECRET` (64-char hex)
- [ ] Set `DEBUG=0`
- [ ] Set `STRICT_ORIGIN=1`
- [ ] Use HTTPS only
- [ ] Configure `ALLOWED_ORIGINS`
- [ ] Set `POW_DIFFICULTY=2`
- [ ] Deploy Redis instance
- [ ] Rotate secrets every 90 days
- [ ] Monitor verification failures
- [ ] Set up rate limit alerts

---

## Performance

| Metric | Value |
|--------|-------|
| Challenge generation | <100ms |
| Verification | <500ms |
| Client rendering | <200ms |
| Theme transition | 0.8s |
| False positive rate | <2% |
| Success rate | >80% |

---

## What's New in v1.2

- Dark mode with smooth transitions
- Enhanced UI theme and styling
- Behavioral anomaly detection (6 methods)
- Automation signature detection (5 types)
- Interactive tutorial system
- Full WCAG 2.1 AA accessibility
- Performance optimizations
- Improved documentation

---

**Version:** 1.2.0 |**Last Updated:** October 16, 2025
