const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// --- CORS fix ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});


// Configuration
const CONFIG = {
  SECRET_KEY: process.env.CAPTCHA_SECRET || 'your-256-bit-secret-key-here',
  CHALLENGE_TTL: 90, // seconds
  TOLERANCE: 8, // degrees
  MIN_REACTION_MS: 60,
  MAX_REACTION_MS: 3000,
  PORT: process.env.PORT || 3000,
  RISK_LEVELS: {
    LOW: { tolerance: 8, minMoves: 5 },
    MEDIUM: { tolerance: 6, minMoves: 10 },
    HIGH: { tolerance: 4, minMoves: 15 }
  },
  MOVEMENT_VALIDATION: {
    MIN_SPEED_VARIANCE: 0.3,
    MAX_LINEAR_MOVEMENTS: 0.4,
    MIN_NATURAL_JITTER: 0.1
  },
  RATE_LIMITS: {
    WINDOW_MS: 15 * 60 * 1000,
    MAX_REQUESTS: 100
  }
};

const ENABLE_DEBUG_LOGGING = true;

const ipAttempts = new Map();
const suspiciousIPs = new Set();

// In-memory store
const challenges = new Map();

// Utility functions
function generateHMAC(data) {
  return crypto
    .createHmac('sha256', CONFIG.SECRET_KEY)
    .update(JSON.stringify(data))
    .digest('base64');
}

function verifyHMAC(data, signature) {
  const expectedSig = generateHMAC(data);
  return expectedSig === signature;
}

function computeTargetAngle(seed) {
    const array = new Uint8Array(32);
    for (let i = 0; i < seed.toString().length; i++) {
        array[i] = seed.toString().charCodeAt(i);
    }
    const hashArray = new Uint32Array(array.buffer);
    return hashArray[0] % 360;  // Match client-side calculation
}

function normalizeAngle(angle) {
    // First normalize to [0, 360)
    angle = angle % 360;
    if (angle < 0) angle += 360;
    // Then normalize to [0, 180) by folding over at 180°
    return angle % 180;
}

function angleDiffAbs(a, b) {
    // Normalize both angles to [0, 180) range first
    a = normalizeAngle(a);
    b = normalizeAngle(b);
    // Calculate smallest difference in either direction
    const diff = Math.abs(a - b);
    return Math.min(diff, 180 - diff);
}

function debugLog(title, data) {
    if (!ENABLE_DEBUG_LOGGING) return;
    console.log('\n=== ' + title + ' ===');
    console.dir(data, { depth: null, colors: true });
    console.log('='.repeat(40) + '\n');
}

// --- Challenge API ---
app.post('/api/v1/challenge', (req, res) => {
  const { client_id } = req.body;
  const nonce = uuidv4();
  const seed = crypto.randomInt(0, 2147483647);
  const targetAngle = computeTargetAngle(seed);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + CONFIG.CHALLENGE_TTL;

  const challengeBlob = {
    nonce,
    seed,
    tolerance: CONFIG.TOLERANCE,
    issued_at: issuedAt,
    expires_at: expiresAt
  };
  const sig = generateHMAC(challengeBlob);

  challenges.set(nonce, { targetAngle, used: false, expiresAt });
  setTimeout(() => challenges.delete(nonce), CONFIG.CHALLENGE_TTL * 1000);

  res.json({
    challenge: Buffer.from(JSON.stringify(challengeBlob)).toString('base64'),
    sig
  });
});

// --- Verify API ---
app.post('/api/v1/verify', (req, res) => {
    debugLog('RECEIVED VERIFICATION REQUEST', {
        fingerprint: req.body.fingerprint,
        timing: req.body.timing,
        movements: req.body.movements,
        user_angle: req.body.user_angle,
        reaction_time: req.body.reaction_client_ms,
        ip: req.ip,
        headers: req.headers
    });

    const { movements, fingerprint, timing } = req.body;
    const clientIP = req.ip;

    // Check rate limits
    const attempts = ipAttempts.get(clientIP) || [];
    const recentAttempts = attempts.filter(a => Date.now() - a < CONFIG.RATE_LIMITS.WINDOW_MS);
    
    if (recentAttempts.length >= CONFIG.RATE_LIMITS.MAX_REQUESTS) {
        return res.status(429).json({ ok: false, message: 'Too many attempts' });
    }

    // Determine risk level
    const riskLevel = suspiciousIPs.has(clientIP) ? 'HIGH' : 
                     recentAttempts.length > 50 ? 'MEDIUM' : 'LOW';

    // Validate movements
    const movementAnalysis = validateMovements(movements, riskLevel);
    if (!movementAnalysis.valid) {
        suspiciousIPs.add(clientIP);
        return res.status(400).json({ ok: false, message: 'Verification failed' });
    }

    // Update rate limiting
    recentAttempts.push(Date.now());
    ipAttempts.set(clientIP, recentAttempts);

    const { challenge: challengeB64, sig, user_angle, reaction_client_ms } = req.body;

    // Validation checks
    if (!challengeB64 || !sig || typeof user_angle !== 'number' || typeof reaction_client_ms !== 'number') {
        return res.status(400).json({ 
            ok: false, 
            message: 'Missing or invalid parameters',
            debug: { received: req.body }
        });
    }

    // Add debug logging
    console.log('Verify attempt:', {
        user_angle,
        reaction_client_ms,
        challenge: challengeB64?.substring(0, 20) + '...',
        sig: sig?.substring(0, 20) + '...'
    });

    let challengeBlob;
    try {
        challengeBlob = JSON.parse(Buffer.from(challengeB64, 'base64').toString());
    } catch {
        return res.status(400).json({ ok: false, message: 'Invalid challenge format' });
    }

    if (!verifyHMAC(challengeBlob, sig)) {
        return res.status(400).json({ ok: false, message: 'Invalid signature' });
    }

    const data = challenges.get(challengeBlob.nonce);
    if (!data) return res.status(400).json({ ok: false, message: 'Challenge expired or missing' });
    if (data.used) return res.status(400).json({ ok: false, message: 'Already used' });

    // Normalize angles and calculate difference
    const userAngle = normalizeAngle(user_angle);
    const targetAngle = normalizeAngle(data.targetAngle);
    const error = angleDiffAbs(userAngle, targetAngle);
    
    debugLog('MOVEMENT ANALYSIS', {
        riskLevel,
        totalMovements: req.body.movements?.length,
        validationResult: movementAnalysis,
        recentAttempts: recentAttempts.length
    });

    const angleOk = error <= challengeBlob.tolerance;
    const reactionOk = reaction_client_ms >= CONFIG.MIN_REACTION_MS && 
                      reaction_client_ms <= CONFIG.MAX_REACTION_MS;

    debugLog('ANGLE COMPARISON', {
        raw_user_angle: req.body.user_angle,
        normalized_user: userAngle,
        raw_target: data.targetAngle,
        normalized_target: targetAngle,
        difference: error,
        tolerance: challengeBlob.tolerance,
        angleOk,
        reactionOk
    });

    if (!angleOk || !reactionOk) {
        return res.status(400).json({ 
            ok: false, 
            message: 'Verification failed',
            debug: { 
                error,
                tolerance: challengeBlob.tolerance,
                userAngle,
                targetAngle,
                reaction_client_ms 
            }
        });
    }

    data.used = true;
    res.json({ ok: true, message: 'Verified successfully' });
});

// Update the validateMovements function
function validateMovements(movements, riskLevel) {
    // Allow verification without movements for keyboard input
    if (!Array.isArray(movements)) {
        return { valid: false, confidence: 0 };
    }

    // For keyboard input or single movement
    if (movements.length === 1 && movements[0].keyboard) {
        return { valid: true, confidence: 0.5 };
    }

    // For mouse/touch input
    if (movements.length < CONFIG.RISK_LEVELS[riskLevel].minMoves) {
        return { valid: false, confidence: 0 };
    }

    let linearMovements = 0;
    const speeds = [];
    
    for (let i = 2; i < movements.length; i++) {
        const p1 = movements[i-2];
        const p2 = movements[i-1];
        const p3 = movements[i];

        // Check for linear movement (bot-like)
        const linearity = Math.abs(
            (p2.y - p1.y) * (p3.x - p1.x) - 
            (p3.y - p1.y) * (p2.x - p1.x)
        );

        if (linearity < CONFIG.MOVEMENT_VALIDATION.MIN_NATURAL_JITTER) {
            linearMovements++;
        }

        speeds.push(movements[i].speed);
    }

    // Calculate speed variance
    const avgSpeed = speeds.reduce((a,b) => a + b, 0) / speeds.length;
    const speedVariance = speeds.reduce((a,b) => a + Math.pow(b - avgSpeed, 2), 0) / speeds.length;

    return {
        valid: movements.length > 0 && (
            linearMovements / movements.length < CONFIG.MOVEMENT_VALIDATION.MAX_LINEAR_MOVEMENTS ||
            speedVariance > CONFIG.MOVEMENT_VALIDATION.MIN_SPEED_VARIANCE
        ),
        confidence: movements.length > 0 ? 1 - (linearMovements / movements.length) : 0.5
    };
}

// --- Health ---
app.get('/health', (req, res) => res.json({ status: 'healthy', ts: new Date() }));

// --- Start server ---
app.listen(CONFIG.PORT, () => {
  console.log(`Server running on http://localhost:${CONFIG.PORT}`);
});
