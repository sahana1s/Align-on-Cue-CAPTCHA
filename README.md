# Align-on-Cue-CAPTCHA

Branch: `updated` — this branch contains the integrated hardening and feature work (server- and client-side anti-automation defenses). It includes HMAC-signed single-use challenges, optional proof-of-work (POW), movement telemetry and heuristics, WebGL/CSS obfuscation, Redis scaffolding for rate-limiting, and admin endpoints. Use this branch for development and local testing of the hardened implementation.


The goal is defense-in-depth: combine client-side obfuscation and telemetry with server-side signed challenges, rate-limiting, optional proof-of-work (POW), and movement heuristics to make automated attacks (OpenCV template matching, headless browsers, scripted input) harder to execute reliably.

## Features

- HMAC-signed single-use challenges with TTL
- Client fingerprint binding (challenge requested per fingerprint hash)
- Movement telemetry capture (pointer timestamps, x/y, pressure) and heuristic checks (speed/accel/jerk, timestamp entropy, pressure variance)
- Optional Proof-of-Work (POW) to add CPU cost for automated clients
- WebGL noise overlay + CSS rotating noise + encoded angular cue to frustrate CV/template attacks
- Redis-aware rate-limiting and lockouts with in-memory fallback for single-node runs
- Admin endpoints protected with an `ADMIN_TOKEN`

## Repo layout

- `Align-on-cue/client/align_on_cue.html` — single-file client UI, WebGL shader, telemetry
- `Align-on-cue/server/server.js` — Express server with challenge and verification endpoints
- `Align-on-cue/.env` — example environment variables (local testing)

## Prerequisites

- Node.js 18+ (Node 20 recommended)
- npm (bundled with Node)
- (Optional) Docker (for running Redis locally)

## Environment (.env)

Create a `.env` in `Align-on-cue/server` (or set environment variables in your shell). Example values (replace placeholders):

```text
CAPTCHA_SECRET=REPLACE_WITH_STRONG_RANDOM_64_HEX
PORT=3000
ALLOWED_ORIGINS=http://localhost:8080,http://localhost:3000
STRICT_ORIGIN=false
REDIS_URL=redis://localhost:6379   # optional
POW_DIFFICULTY=1                   # integer 0..8, 0 disables POW
ADMIN_TOKEN=replace-with-admin-token
CHALLENGE_TTL_MS=60000             # challenge expiry in ms
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=30
```

Important notes:
- `CAPTCHA_SECRET`: required for production; use a strong random 32-byte (256-bit) secret expressed as hex. Keep it out of source control.
- `REDIS_URL`: configure to enable Redis-backed counters/lockouts (recommended for production multi-instance deployments).
- `POW_DIFFICULTY`: lower while testing. Higher increases client CPU work.

Generate a secret (PowerShell):

```powershell
[System.BitConverter]::ToString((New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes(32)) -replace '-', ''
```

Or using Node (cross-platform):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Quick setup and run (Windows PowerShell)

1) Install server dependencies

```powershell
cd 'C:\Users\<you>\Desktop\Captcha\Align-on-Cue-CAPTCHA\Align-on-cue\server'
npm install
```

2) (Optional) Start Redis with Docker

```powershell
docker run -p 6379:6379 --name local-redis -d redis:7
```

3) Export environment variables in the same PowerShell session

```powershell
$env:CAPTCHA_SECRET = 'your_generated_secret_here'
$env:REDIS_URL = 'redis://localhost:6379'    # optional
$env:ADMIN_TOKEN = 'a-secure-admin-token'
$env:POW_DIFFICULTY = '1'
$env:PORT = '3000'
$env:ALLOWED_ORIGINS = 'http://localhost:8080'
```

4) Start the server

```powershell
cd 'C:\Users\<you>\Desktop\Captcha\Align-on-Cue-CAPTCHA\Align-on-cue\server'
node .\server.js
# or `npm start` if package.json includes a start script
```

5) Serve the client (from `Align-on-cue` folder)

```powershell
cd 'C:\Users\<you>\Desktop\Captcha\Align-on-Cue-CAPTCHA\Align-on-cue'
# option A: http-server
npx http-server .\client -p 8080

# option B: serve
npx serve .\client -p 8080
```

6) Open the client page

Open: http://localhost:8080/align_on_cue.html

## End-to-end test

- Open the client. The page requests a signed challenge and renders the obfuscated stage.
- When the beep sounds, align the green bar with the target and submit (or press Space).
- The client posts movement telemetry to `/api/v1/verify`. The server verifies HMAC signature, POW (if required), movement heuristics, and returns success/failure and a confidence score.

## Admin endpoints

- `GET /admin/ips` — list currently flagged/suspicious IPs (requires `ADMIN_TOKEN` header or `?token=` query param)
- `POST /admin/ips/clear` — clears the flagged IPs (protected by same token)

## Troubleshooting

- CORS errors: confirm `ALLOWED_ORIGINS` includes the client origin and `STRICT_ORIGIN` is set correctly.
- WebGL unavailable: the client falls back to a CSS noise overlay, but obfuscation is weaker. Use a modern browser with WebGL for best effect.
- Verification always fails: check server logs for signature/POW errors. Ensure `CAPTCHA_SECRET` is identical between server restarts and that the client includes fingerprint_hash when requesting a challenge.


- Provide a `docker-compose.yml` to start server + redis + static server


