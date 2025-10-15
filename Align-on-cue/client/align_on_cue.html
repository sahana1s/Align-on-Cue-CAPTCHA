const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:8080', 'http://localhost:3000'];
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) res.header('Access-Control-Allow-Origin', origin);
    else res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

if (process.env.STRICT_ORIGIN === '1') {
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (req.path === '/health') return next();
        if (!origin || !allowedOrigins.includes(origin)) return res.status(403).json({ ok: false, message: 'Origin not allowed' });
        next();
    });
}

const CONFIG = {
    SECRET_KEY: process.env.CAPTCHA_SECRET || 'your-256-bit-secret-key-here',
    CHALLENGE_TTL: 90,
    MIN_REACTION_MS: 60,
    MAX_REACTION_MS: 3000,
    PORT: process.env.PORT || 3000,
    DEFAULT_POW_DIFFICULTY: parseInt(process.env.POW_DIFFICULTY || '1', 10),
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
    RATE_LIMITS: { WINDOW_MS: 15 * 60 * 1000, MAX_REQUESTS: 100 }
};

const ENABLE_DEBUG_LOGGING = process.env.DEBUG === '1';

const ipAttempts = new Map();
const ipFailures = new Map();
const lockouts = new Map();
const suspiciousIPs = new Set();
const challenges = new Map();

let redisClient = null;
if (process.env.REDIS_URL) {
    try {
        const { createClient } = require('redis');
        redisClient = createClient({ url: process.env.REDIS_URL });
        redisClient.connect().catch(e => console.error('redis connect failed', e));
    } catch (e) { console.error('redis not available', e.message || e); }
}

async function incrRateKey(key, windowMs) {
    if (!redisClient) {
        const arr = ipAttempts.get(key) || [];
        const now = Date.now();
        const windowStart = now - windowMs;
        const recent = arr.filter(t => t >= windowStart);
        recent.push(now);
        ipAttempts.set(key, recent);
        return recent.length;
    }
    const count = await redisClient.incr(key);
    if (count === 1) await redisClient.pexpire(key, windowMs);
    return parseInt(count, 10);
}

async function setLockout(key, ms) {
    if (!redisClient) {
        lockouts.set(key, Date.now() + ms);
        return;
    }
    await redisClient.set(`lockout:${key}`, '1', { PX: ms });
}

async function isLocked(key) {
    if (!redisClient) return (lockouts.get(key) || 0) > Date.now();
    const v = await redisClient.get(`lockout:${key}`);
    return !!v;
}

function debugLog(title, data) { if (!ENABLE_DEBUG_LOGGING) return; console.log('\n=== ' + title + ' ==='); console.dir(data, { depth: null, colors: true }); console.log('='.repeat(40) + '\n'); }

function generateHMAC(data) { return crypto.createHmac('sha256', CONFIG.SECRET_KEY).update(JSON.stringify(data)).digest('base64'); }
function verifyHMAC(data, signature) { return generateHMAC(data) === signature; }

function computeTargetAngle(seed) { const array = new Uint8Array(32); for (let i = 0; i < seed.toString().length; i++) array[i] = seed.toString().charCodeAt(i); const hashArray = new Uint32Array(array.buffer); return hashArray[0] % 360; }
function normalizeAngle(angle) { angle = angle % 360; if (angle < 0) angle += 360; return angle % 180; }
function angleDiffAbs(a, b) { a = normalizeAngle(a); b = normalizeAngle(b); const diff = Math.abs(a - b); return Math.min(diff, 180 - diff); }

app.post('/api/v1/challenge', (req, res) => {
    try {
        const { client_id, fingerprint_hash } = req.body || {};
        if (client_id && typeof client_id !== 'string') return res.status(400).json({ ok: false, message: 'client_id must be a string' });
        if (!fingerprint_hash || typeof fingerprint_hash !== 'string') return res.status(400).json({ ok: false, message: 'fingerprint_hash required' });

        const nonce = uuidv4();
        const seed = crypto.randomInt(0, 2147483647);
        const targetAngle = computeTargetAngle(seed);
        const issuedAt = Math.floor(Date.now() / 1000);
        const expiresAt = issuedAt + CONFIG.CHALLENGE_TTL;

        const challengeBlob = { nonce, seed, pow_difficulty: CONFIG.DEFAULT_POW_DIFFICULTY, tolerance: CONFIG.RISK_LEVELS.LOW.tolerance, issued_at: issuedAt, expires_at: expiresAt };
        const sig = generateHMAC(challengeBlob);
        challenges.set(nonce, { targetAngle, used: false, expiresAt, fingerprint_hash });
        setTimeout(() => challenges.delete(nonce), CONFIG.CHALLENGE_TTL * 1000);

        return res.json({ challenge: Buffer.from(JSON.stringify(challengeBlob)).toString('base64'), sig });
    } catch (e) {
        console.error('challenge error', e);
        return res.status(500).json({ ok: false, message: 'internal error' });
    }
});

function validateMovements(movements, riskLevel) {
    if (!Array.isArray(movements)) return { valid: false, confidence: 0 };
    if (movements.length === 1 && movements[0].keyboard) return { valid: true, confidence: 0.5 };
    if (movements.length < CONFIG.RISK_LEVELS[riskLevel].minMoves) return { valid: false, confidence: 0 };

    let linearMovements = 0; const speeds = []; const accs = []; const jerks = []; const pressures = []; const intervals = [];
    for (let i = 2; i < movements.length; i++) {
        const p1 = movements[i-2], p2 = movements[i-1], p3 = movements[i];
        const linearity = Math.abs((p2.y - p1.y) * (p3.x - p1.x) - (p3.y - p1.y) * (p2.x - p1.x));
        if (linearity < CONFIG.MOVEMENT_VALIDATION.MIN_NATURAL_JITTER) linearMovements++;
        const s = movements[i].speed || 0; speeds.push(s);
        const dt1 = (p2.timestamp || 0) - (p1.timestamp || 0) || 1; const dt2 = (p3.timestamp || 0) - (p2.timestamp || 0) || 1;
        const v1 = s, v0 = movements[i-1].speed || 0; const a = (v1 - v0) / (dt2/1000 || 0.001); accs.push(a);
        const j = (a - ((v0 - (movements[i-2].speed||0)) / (dt1/1000 || 0.001))) / (dt2/1000 || 0.001); jerks.push(j);
        pressures.push(p3.pressure || 0); intervals.push(dt2);
    }
    const avgSpeed = speeds.length ? speeds.reduce((a,b)=>a+b,0)/speeds.length : 0;
    const speedVariance = speeds.length ? speeds.reduce((a,b)=>a+Math.pow(b-avgSpeed,2),0)/speeds.length : 0;
    const accVar = accs.length ? accs.reduce((a,b)=>a+Math.pow(b-(accs.reduce((x,y)=>x+y,0)/accs.length),2),0)/accs.length : 0;
    const jerkVar = jerks.length ? jerks.reduce((a,b)=>a+Math.pow(b-(jerks.reduce((x,y)=>x+y,0)/jerks.length),2),0)/jerks.length : 0;
    const pressureVar = pressures.length ? pressures.reduce((a,b)=>a+Math.pow(b-(pressures.reduce((x,y)=>x+y,0)/pressures.length),2),0)/pressures.length : 0;
    const linearRatio = movements.length ? linearMovements / movements.length : 1;
    const valid = movements.length > 0 && (linearRatio < CONFIG.MOVEMENT_VALIDATION.MAX_LINEAR_MOVEMENTS || speedVariance > CONFIG.MOVEMENT_VALIDATION.MIN_SPEED_VARIANCE || accVar > 0.05 || jerkVar > 0.1);
    const confidence = Math.max(0, Math.min(1, 1 - linearRatio + Math.min(1, speedVariance) * 0.3 + Math.min(1, accVar) * 0.2));
    return { valid, confidence, stats: { avgSpeed, speedVariance, accVar, jerkVar, pressureVar, linearRatio, intervalsCount: intervals.length } };
}

function computeMovementHeuristics(movements) {
    if (!Array.isArray(movements) || movements.length < 2) return { timestampEntropy: 0, pressureVariance: 0, constantIntervals: false };
    const intervals = [], pressures = [];
    for (let i = 1; i < movements.length; i++) { const dt = (movements[i].timestamp || 0) - (movements[i-1].timestamp || 0); intervals.push(dt); pressures.push(movements[i].pressure || 0); }
    const counts = {}; for (const v of intervals) { const k = Math.round(v/16) * 16; counts[k] = (counts[k] || 0) + 1; }
    const total = intervals.length; let entropy = 0; for (const k in counts) { const p = counts[k] / total; entropy -= p * Math.log2(p); }
    const pressureMean = pressures.reduce((a,b)=>a+b,0)/pressures.length; const pressureVar = pressures.reduce((a,b)=>a+Math.pow(b-pressureMean,2),0)/pressures.length;
    const buckets = Object.keys(counts).length; const constantIntervals = buckets < Math.max(2, total * 0.2);
    return { timestampEntropy: entropy, pressureVariance: pressureVar, constantIntervals };
}

app.post('/api/v1/verify', async (req, res) => {
    try {
        debugLog('RECEIVED VERIFICATION REQUEST', { fingerprint: req.body.fingerprint, timing: req.body.timing, movements: Array.isArray(req.body.movements) ? req.body.movements.length : req.body.movements, user_angle: req.body.user_angle, reaction_time: req.body.reaction_client_ms, ip: req.ip, headers: req.headers });
        const { movements, fingerprint, timing, pow_nonce } = req.body || {};
        const clientIP = req.ip;

            if (await isLocked(clientIP)) return res.status(429).json({ ok: false, message: 'Too many failed attempts, try later' });

            const attemptsCount = await incrRateKey(`rl:${clientIP}`, CONFIG.RATE_LIMITS.WINDOW_MS);
            if (attemptsCount >= CONFIG.RATE_LIMITS.MAX_REQUESTS) {
                ipFailures.set(clientIP, (ipFailures.get(clientIP) || 0) + 1);
                if ((ipFailures.get(clientIP) || 0) > 5) await setLockout(clientIP, 5 * 60 * 1000);
                return res.status(429).json({ ok: false, message: 'Too many attempts' });
            }

        const riskLevel = suspiciousIPs.has(clientIP) ? 'HIGH' : (attemptsCount && attemptsCount > 50) ? 'MEDIUM' : 'LOW';
        const fingerprint_hash = req.body.fingerprint_hash || req.body.fingerprint?.hash; if (!fingerprint_hash || typeof fingerprint_hash !== 'string') return res.status(400).json({ ok: false, message: 'fingerprint_hash required' });

        const { challenge: challengeB64, sig, user_angle, reaction_client_ms } = req.body || {};
        if (!challengeB64 || !sig || typeof user_angle !== 'number' || typeof reaction_client_ms !== 'number') return res.status(400).json({ ok: false, message: 'Missing or invalid parameters' });

        if (Array.isArray(movements) && movements.length > 1000) return res.status(400).json({ ok: false, message: 'Too many movement samples' });
        if (movements && !Array.isArray(movements)) return res.status(400).json({ ok: false, message: 'movements must be an array' });

    const movementAnalysis = validateMovements(movements, riskLevel);
    const heuristics = computeMovementHeuristics(movements || []);
    const automationScore = ((heuristics.timestampEntropy < 2 ? 0.4 : 0) + (heuristics.pressureVariance < 0.01 ? 0.2 : 0) + (heuristics.constantIntervals ? 0.3 : 0) + (movementAnalysis.confidence < 0.2 ? 0.3 : 0));
    // Use a slightly higher threshold to avoid rejecting on floating-point noise or minimal input samples
    const AUTOMATION_THRESHOLD = 0.65;
    if (!movementAnalysis.valid || automationScore >= AUTOMATION_THRESHOLD) { ipFailures.set(clientIP, (ipFailures.get(clientIP) || 0) + 1); if (ipFailures.get(clientIP) > 3) suspiciousIPs.add(clientIP); return res.status(400).json({ ok: false, message: 'Verification failed', heuristics, automationScore }); }

        const attempts = ipAttempts.get(clientIP) || [];
        attempts.push(Date.now());
        ipAttempts.set(clientIP, attempts);

        let challengeBlob; try { challengeBlob = JSON.parse(Buffer.from(challengeB64, 'base64').toString()); } catch (e) { return res.status(400).json({ ok: false, message: 'Invalid challenge format' }); }
        if (!verifyHMAC(challengeBlob, sig)) { ipFailures.set(clientIP, (ipFailures.get(clientIP) || 0) + 1); return res.status(400).json({ ok: false, message: 'Invalid signature' }); }

        const data = challenges.get(challengeBlob.nonce); if (!data) return res.status(400).json({ ok: false, message: 'Challenge expired or missing' }); if (data.used) return res.status(400).json({ ok: false, message: 'Already used' }); if (data.fingerprint_hash && data.fingerprint_hash !== fingerprint_hash) return res.status(400).json({ ok: false, message: 'Fingerprint mismatch' });

        if (challengeBlob.pow_difficulty && challengeBlob.pow_difficulty > 0) {
            if (!pow_nonce || typeof pow_nonce !== 'string') return res.status(400).json({ ok: false, message: 'pow_nonce required' });
            try { const hash = crypto.createHash('sha256').update(challengeB64 + ':' + pow_nonce).digest('hex'); const prefix = '0'.repeat(Math.max(0, Math.min(8, challengeBlob.pow_difficulty))); if (!hash.startsWith(prefix)) return res.status(400).json({ ok: false, message: 'Invalid proof-of-work' }); } catch (e) { return res.status(400).json({ ok: false, message: 'POW verification error' }); }
        }

        const userAngle = normalizeAngle(user_angle); const targetAngle = normalizeAngle(data.targetAngle); const error = angleDiffAbs(userAngle, targetAngle);
    debugLog('MOVEMENT ANALYSIS', { riskLevel, totalMovements: Array.isArray(movements) ? movements.length : 0, validationResult: movementAnalysis, recentAttempts: attemptsCount });
        const angleOk = error <= challengeBlob.tolerance; const reactionOk = reaction_client_ms >= CONFIG.MIN_REACTION_MS && reaction_client_ms <= CONFIG.MAX_REACTION_MS;
        debugLog('ANGLE COMPARISON', { raw_user_angle: req.body.user_angle, normalized_user: userAngle, raw_target: data.targetAngle, normalized_target: targetAngle, difference: error, tolerance: challengeBlob.tolerance, angleOk, reactionOk });
        if (!angleOk || !reactionOk) { ipFailures.set(clientIP, (ipFailures.get(clientIP) || 0) + 1); return res.status(400).json({ ok: false, message: 'Verification failed', debug: { error, tolerance: challengeBlob.tolerance, userAngle, targetAngle, reaction_client_ms } }); }

        data.used = true; ipFailures.set(clientIP, 0);
        const angleScore = Math.max(0, 1 - (error / challengeBlob.tolerance));
        const confidence = Math.round(Math.max(0, Math.min(1, angleScore * 0.7 + movementAnalysis.confidence * 0.3 - automationScore * 0.2)) * 100);
        return res.json({ ok: true, message: 'Verified successfully', confidence });
    } catch (e) {
        console.error('verify error', e); return res.status(500).json({ ok: false, message: 'internal error' });
    }
});

app.get('/health', (req, res) => res.json({ status: 'healthy', ts: new Date() }));

// respond to favicon requests to avoid noisy 404s from browsers
app.get('/favicon.ico', (req, res) => res.sendStatus(204));

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
function checkAdmin(req, res) {
    if (!ADMIN_TOKEN) return res.status(403).json({ ok: false, message: 'Admin API not enabled' });
    const t = req.headers['x-admin-token'] || req.query.token;
    if (!t || t !== ADMIN_TOKEN) return res.status(401).json({ ok: false, message: 'Unauthorized' });
    return null;
}

app.get('/admin/ips', (req, res) => {
    const err = checkAdmin(req, res); if (err) return;
    const list = Array.from(suspiciousIPs.values ? suspiciousIPs.values() : suspiciousIPs);
    return res.json({ ok: true, suspicious: list });
});

app.post('/admin/ips/clear', (req, res) => {
    const err = checkAdmin(req, res); if (err) return;
    suspiciousIPs.clear();
    return res.json({ ok: true, message: 'cleared' });
});

app.listen(CONFIG.PORT, () => console.log(`Server running on http://localhost:${CONFIG.PORT}`));
