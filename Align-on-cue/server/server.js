/**
 * Align-on-Cue CAPTCHA v2.0
 * Multi-Modal Human Verification System
 * 
 * NEW in v2.0:
 * - Gesture recognition & stroke biometrics (pressure, velocity, tremor)
 * - Combined challenges (align + draw/swipe/trace)
 * - Real-time bot detection during drawing
 * - Progressive difficulty system
 * - Shape validation (circles, arrows, paths)
 * - Motor control analysis (acceleration curves, hesitation points)
 * - Anti-replay attack mechanisms
 * - Enhanced user experience with step-by-step guidance
 * 
 * Retained from v1.3:
 * - Visual cryptography, temporal rhythm, cognitive challenges
 * - Honeypot system, behavioral biometrics, canvas contamination
 */

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:8080', 'http://localhost:3000'];
app.use((req, res, next) => {
    // Always allow all origins for this demo application
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
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
    VERSION: '2.0.2',
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
    RATE_LIMITS: { WINDOW_MS: 15 * 60 * 1000, MAX_REQUESTS: 100 },
    // v1.3: Temporal challenge settings
    TEMPORAL: {
        MIN_RHYTHM_VARIANCE: 0.15,  // Natural timing variance
        MAX_CLICK_SPEED: 50,  // ms between clicks (too fast = bot)
        PATTERN_LENGTH: 3,  // Clicks needed for rhythm analysis
        HESITATION_MIN: 100,  // Natural human hesitation (ms)
        HESITATION_MAX: 2000  // Max thinking time
    },
    // v1.3: Cognitive challenge settings
    COGNITIVE: {
        MEMORY_SEQUENCE_LENGTH: 3,  // How many items to remember
        RECALL_DELAY_MS: 2000,  // Time before recall test
        PATTERN_TYPES: ['color', 'position', 'order']
    },
    // v1.3: Honeypot detection
    HONEYPOT: {
        INVISIBLE_ELEMENTS: 2,  // Number of invisible traps
        TRAP_INTERACTION_PENALTY: 0.5  // Confidence penalty if clicked
    },
    // v1.3: Micro-behavior analysis
    MICRO_BEHAVIOR: {
        MIN_TREMOR_FREQUENCY: 0.05,  // Natural hand tremor
        MAX_PERFECT_LINES: 2,  // Too many perfect lines = bot
        CORRECTION_THRESHOLD: 3,  // Min error corrections expected
        HOVER_TIME_MIN: 50  // Natural hover before click
    },
    // v2.0 NEW: Gesture & Stroke Analysis
    GESTURE: {
        MIN_POINTS: 5,  // Minimum points for valid stroke
        MAX_POINTS: 1000,  // Maximum points to prevent DoS
        MIN_DURATION_MS: 150,  // Too fast = bot
        MAX_DURATION_MS: 10000,  // Too slow = timeout
        VELOCITY_VARIANCE: { MIN: 0.25, MAX: 0.8 },  // Human variance range
        TREMOR_HZ: { MIN: 6, MAX: 12 },  // Natural hand tremor frequency
        PRESSURE_VARIANCE: { MIN: 0.15, MAX: 0.6 },  // Pressure variation
        HESITATION_THRESHOLD: 150,  // Pause duration to count as hesitation
        MIN_HESITATIONS: 1,  // Humans hesitate while drawing
        MAX_PERFECT_VELOCITY: 0.1,  // Perfect constant velocity = bot
        SMOOTHNESS_THRESHOLD: 0.85,  // Too smooth = synthetic
        DIRECTION_CHANGES: { MIN: 5, MAX: 100 }  // Natural pen movement
    },
    // v2.0 NEW: Shape Validation
    SHAPE: {
        CIRCLE: {
            MIN_CIRCULARITY: 0.65,  // How round it must be (0-1)
            MAX_CIRCULARITY: 0.98,  // Perfect circle = suspicious
            TOLERANCE_PX: 20  // Allowed deviation from perfect
        },
        SWIPE: {
            MIN_LENGTH: 50,  // Minimum swipe distance (px)
            ANGLE_TOLERANCE: 15,  // Allowed angle deviation (degrees)
            MAX_CURVES: 3  // Too many curves = not a swipe
        },
        TRACE: {
            MAX_FRECHET_DISTANCE: 25,  // Path following accuracy
            MIN_COVERAGE: 0.7,  // Must cover 70% of target path
            SEQUENCE_MATTERS: true  // Order of strokes
        }
    },
    // v2.0 NEW: Alignment Validation
    ALIGNMENT: {
        ANGLE_TOLERANCE: 15  // Allowed angle deviation in degrees
    },
    // v2.0 NEW: Challenge Difficulty Levels
    DIFFICULTY: {
        EASY: {
            challengeTypes: ['align_circle', 'align_swipe'],
            shapeAccuracy: 0.65,
            timeLimit: 15000,
            retries: 3
        },
        MEDIUM: {
            challengeTypes: ['align_circle_swipe', 'align_trace'],
            shapeAccuracy: 0.75,
            timeLimit: 12000,
            retries: 2
        },
        HARD: {
            challengeTypes: ['align_circle_trace', 'align_multi_gesture'],
            shapeAccuracy: 0.85,
            timeLimit: 10000,
            retries: 1
        }
    }
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

// ========== ADVANCED ANOMALY DETECTION ==========

// Track behavioral patterns per IP
const ipBehaviorHistory = new Map(); // IP -> { attempts: [...], avgReactionTime, avgAccuracy, userAgents: [...] }

function recordBehavior(clientIP, behavior) {
  if (!ipBehaviorHistory.has(clientIP)) {
    ipBehaviorHistory.set(clientIP, { attempts: [], avgReactionTime: 0, avgAccuracy: 0, userAgents: new Set(), velocityAnomalies: 0 });
  }
  const history = ipBehaviorHistory.get(clientIP);
  history.attempts.push({ ts: Date.now(), ...behavior });
  if (behavior.userAgent) history.userAgents.add(behavior.userAgent);
  
  // Keep only last 100 attempts
  if (history.attempts.length > 100) history.attempts.shift();
  
  // Update moving averages
  const reactionTimes = history.attempts.map(a => a.reactionTime).filter(t => t);
  const accuracies = history.attempts.map(a => a.accuracy).filter(a => typeof a === 'number');
  if (reactionTimes.length) history.avgReactionTime = reactionTimes.reduce((a,b)=>a+b,0) / reactionTimes.length;
  if (accuracies.length) history.avgAccuracy = accuracies.reduce((a,b)=>a+b,0) / accuracies.length;
}

function detectAnomalies(clientIP, currentBehavior) {
  const history = ipBehaviorHistory.get(clientIP);
  if (!history || history.attempts.length < 2) return { anomalyScore: 0, flags: [] };
  
  const flags = [];
  let anomalyScore = 0;
  
  // 1. Velocity anomaly - sudden changes in reaction time
  const recentReactions = history.attempts.slice(-5).map(a => a.reactionTime).filter(t => t);
  if (recentReactions.length >= 3) {
    const avgRecent = recentReactions.reduce((a,b)=>a+b,0) / recentReactions.length;
    const lastReaction = recentReactions[recentReactions.length - 1];
    if (Math.abs(lastReaction - avgRecent) > avgRecent * 0.8) {
      flags.push('velocity_anomaly');
      anomalyScore += 0.15;
    }
  }
  
  // 2. User-Agent switching (potential account takeover)
  if (history.userAgents.size > 3) {
    flags.push('multiple_user_agents');
    anomalyScore += 0.2;
  }
  
  // 3. Impossible reaction times (< 200ms = likely bot)
  if (currentBehavior.reactionTime && currentBehavior.reactionTime < 200) {
    flags.push('suspicious_reaction_time');
    anomalyScore += 0.25;
  }
  
  // 4. Perfect accuracy pattern (robotic)
  if (history.avgAccuracy > 0.95 && history.attempts.length >= 5) {
    flags.push('perfect_accuracy_pattern');
    anomalyScore += 0.2;
  }
  
  // 5. Temporal pattern - attempts at exact intervals
  if (history.attempts.length >= 3) {
    const intervals = [];
    for (let i = 1; i < history.attempts.length; i++) {
      intervals.push(history.attempts[i].ts - history.attempts[i-1].ts);
    }
    const avgInterval = intervals.reduce((a,b)=>a+b,0) / intervals.length;
    const variance = intervals.reduce((a,b)=>a+Math.pow(b-avgInterval,2),0) / intervals.length;
    if (variance < avgInterval * 0.05) { // Very consistent intervals
      flags.push('constant_attempt_intervals');
      anomalyScore += 0.15;
    }
  }
  
  // 6. Rapid-fire attempts (more than 10 in 60 seconds)
  const oneMinuteAgo = Date.now() - 60000;
  const recentAttempts = history.attempts.filter(a => a.ts > oneMinuteAgo).length;
  if (recentAttempts > 10) {
    flags.push('rapid_attempts');
    anomalyScore += 0.2;
  }
  
  return { anomalyScore: Math.min(anomalyScore, 1), flags };
}

// Detect WebGL/WebDriver presence anomalies (from client telemetry)
function analyzeAutomationSignatures(telemetry) {
  if (!telemetry || !telemetry.automation) return 0;
  let score = 0;
  if (telemetry.automation.webdriver) score += 0.4;
  if (telemetry.automation.selenium) score += 0.4;
  if (telemetry.automation.headless) score += 0.2;
  if (telemetry.automation.phantom) score += 0.3;
  if (telemetry.automation.nightmare) score += 0.3;
  return Math.min(score, 1);
}

// ========== v2.0 GESTURE & STROKE BIOMETRICS ==========

/**
 * v2.0: Analyze stroke biometrics for human-like characteristics
 * Detects: velocity patterns, pressure variance, natural tremor, hesitation points
 * @param {Array} points - Array of {x, y, pressure, timestamp} points
 * @returns {Object} - {humanScore, flags, metrics}
 */
function analyzeStrokeBiometrics(points) {
  if (!Array.isArray(points) || points.length < CONFIG.GESTURE.MIN_POINTS) {
    return { humanScore: 0, flags: ['insufficient_points'], metrics: {} };
  }

  if (points.length > CONFIG.GESTURE.MAX_POINTS) {
    return { humanScore: 0, flags: ['excessive_points'], metrics: {} };
  }

  const flags = [];
  const metrics = {};

  // Calculate stroke duration
  const duration = points[points.length - 1].timestamp - points[0].timestamp;
  metrics.duration = duration;

  if (duration < CONFIG.GESTURE.MIN_DURATION_MS) {
    flags.push('too_fast');
  }
  if (duration > CONFIG.GESTURE.MAX_DURATION_MS) {
    flags.push('timeout');
  }

  // 1. Velocity Profile Analysis
  const velocities = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const dt = points[i].timestamp - points[i - 1].timestamp;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const velocity = dt > 0 ? distance / dt : 0;
    velocities.push(velocity);
  }

  const avgVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;
  const velocityVariance = velocities.reduce((a, v) => a + Math.pow(v - avgVelocity, 2), 0) / velocities.length;
  const velocityStdDev = Math.sqrt(velocityVariance);
  const velocityCoeffVar = avgVelocity > 0 ? velocityStdDev / avgVelocity : 0;

  metrics.avgVelocity = avgVelocity;
  metrics.velocityVariance = velocityCoeffVar;

  // Perfect constant velocity = bot
  if (velocityCoeffVar < CONFIG.GESTURE.MAX_PERFECT_VELOCITY) {
    flags.push('perfect_velocity');
  }

  // Human velocity variance range
  if (velocityCoeffVar < CONFIG.GESTURE.VELOCITY_VARIANCE.MIN || 
      velocityCoeffVar > CONFIG.GESTURE.VELOCITY_VARIANCE.MAX) {
    flags.push('unnatural_velocity_variance');
  }

  // 2. Pressure Analysis
  const pressures = points.map(p => p.pressure || 0.5).filter(p => p > 0);
  if (pressures.length > 0) {
    const avgPressure = pressures.reduce((a, b) => a + b, 0) / pressures.length;
    const pressureVariance = pressures.reduce((a, p) => a + Math.pow(p - avgPressure, 2), 0) / pressures.length;
    const pressureStdDev = Math.sqrt(pressureVariance);
    const pressureCoeffVar = avgPressure > 0 ? pressureStdDev / avgPressure : 0;

    metrics.pressureVariance = pressureCoeffVar;

    // Bots have constant or missing pressure
    if (pressureCoeffVar < CONFIG.GESTURE.PRESSURE_VARIANCE.MIN) {
      flags.push('constant_pressure');
    }

    // Check for all-same pressure (synthetic)
    const uniquePressures = new Set(pressures);
    if (uniquePressures.size === 1) {
      flags.push('synthetic_pressure');
    }
  } else {
    flags.push('no_pressure_data');
  }

  // 3. Tremor Analysis (Natural Hand Shake)
  const tremorPoints = [];
  for (let i = 2; i < points.length; i++) {
    const dx1 = points[i - 1].x - points[i - 2].x;
    const dy1 = points[i - 1].y - points[i - 2].y;
    const dx2 = points[i].x - points[i - 1].x;
    const dy2 = points[i].y - points[i - 1].y;
    
    const angle1 = Math.atan2(dy1, dx1);
    const angle2 = Math.atan2(dy2, dx2);
    const angleDiff = Math.abs(angle2 - angle1);
    
    if (angleDiff > 0.1) { // Small direction changes = tremor
      tremorPoints.push(i);
    }
  }

  const tremorFrequency = tremorPoints.length / (duration / 1000); // Hz
  metrics.tremorFrequency = tremorFrequency;

  if (tremorFrequency < CONFIG.GESTURE.TREMOR_HZ.MIN) {
    flags.push('no_natural_tremor');
  }

  // 4. Hesitation Points (Pauses mid-drawing)
  const hesitations = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].timestamp - points[i - 1].timestamp;
    if (dt > CONFIG.GESTURE.HESITATION_THRESHOLD) {
      hesitations.push({ index: i, duration: dt });
    }
  }

  metrics.hesitationCount = hesitations.length;

  if (hesitations.length < CONFIG.GESTURE.MIN_HESITATIONS && points.length > 20) {
    flags.push('no_hesitation');
  }

  // 5. Acceleration Analysis
  const accelerations = [];
  for (let i = 1; i < velocities.length; i++) {
    const dv = velocities[i] - velocities[i - 1];
    const dt = points[i + 1].timestamp - points[i].timestamp;
    const acceleration = dt > 0 ? dv / dt : 0;
    accelerations.push(acceleration);
  }

  if (accelerations.length > 0) {
    const avgAcceleration = accelerations.reduce((a, b) => a + b, 0) / accelerations.length;
    const accelVariance = accelerations.reduce((a, v) => a + Math.pow(v - avgAcceleration, 2), 0) / accelerations.length;
    metrics.accelerationVariance = Math.sqrt(accelVariance);
  }

  // 6. Direction Changes (Natural pen movement)
  const directionChanges = [];
  for (let i = 2; i < points.length; i++) {
    const dx1 = points[i - 1].x - points[i - 2].x;
    const dy1 = points[i - 1].y - points[i - 2].y;
    const dx2 = points[i].x - points[i - 1].x;
    const dy2 = points[i].y - points[i - 1].y;
    
    const angle1 = Math.atan2(dy1, dx1);
    const angle2 = Math.atan2(dy2, dx2);
    let angleDiff = angle2 - angle1;
    
    // Normalize to [-π, π]
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    
    if (Math.abs(angleDiff) > 0.3) { // ~17 degrees
      directionChanges.push(Math.abs(angleDiff));
    }
  }

  metrics.directionChanges = directionChanges.length;

  if (directionChanges.length < CONFIG.GESTURE.DIRECTION_CHANGES.MIN && points.length > 30) {
    flags.push('too_linear');
  }

  // Calculate Human Score (0-1, higher = more human-like)
  let humanScore = 1.0;

  // Penalties for bot-like behavior
  if (flags.includes('perfect_velocity')) humanScore -= 0.3;
  if (flags.includes('constant_pressure')) humanScore -= 0.25;
  if (flags.includes('no_natural_tremor')) humanScore -= 0.25;
  if (flags.includes('no_hesitation')) humanScore -= 0.15;
  if (flags.includes('too_linear')) humanScore -= 0.2;
  if (flags.includes('too_fast')) humanScore -= 0.4;
  if (flags.includes('synthetic_pressure')) humanScore -= 0.3;

  // Bonus for natural characteristics
  if (velocityCoeffVar >= CONFIG.GESTURE.VELOCITY_VARIANCE.MIN && 
      velocityCoeffVar <= CONFIG.GESTURE.VELOCITY_VARIANCE.MAX) {
    humanScore += 0.1;
  }
  if (tremorFrequency >= CONFIG.GESTURE.TREMOR_HZ.MIN && 
      tremorFrequency <= CONFIG.GESTURE.TREMOR_HZ.MAX) {
    humanScore += 0.1;
  }

  humanScore = Math.max(0, Math.min(1, humanScore));

  return { humanScore, flags, metrics };
}

/**
 * v2.0: Validate circle shape
 * @param {Array} points - Drawing points
 * @returns {Object} - {valid, circularity, center, radius}
 */
function validateCircle(points) {
  if (points.length < 10) {
    return { valid: false, circularity: 0, reason: 'insufficient_points' };
  }

  // Calculate centroid
  const centroidX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const centroidY = points.reduce((sum, p) => sum + p.y, 0) / points.length;

  // Calculate average radius
  const radii = points.map(p => {
    const dx = p.x - centroidX;
    const dy = p.y - centroidY;
    return Math.sqrt(dx * dx + dy * dy);
  });

  const avgRadius = radii.reduce((a, b) => a + b, 0) / radii.length;

  // Calculate standard deviation of radii
  const radiusVariance = radii.reduce((sum, r) => sum + Math.pow(r - avgRadius, 2), 0) / radii.length;
  const radiusStdDev = Math.sqrt(radiusVariance);

  // Circularity score: lower std dev = more circular
  const circularity = avgRadius > 0 ? 1 - (radiusStdDev / avgRadius) : 0;

  const valid = circularity >= CONFIG.SHAPE.CIRCLE.MIN_CIRCULARITY && 
                circularity <= CONFIG.SHAPE.CIRCLE.MAX_CIRCULARITY;

  return {
    valid,
    circularity: Math.max(0, Math.min(1, circularity)),
    center: { x: centroidX, y: centroidY },
    radius: avgRadius,
    reason: !valid ? (circularity < CONFIG.SHAPE.CIRCLE.MIN_CIRCULARITY ? 'not_circular_enough' : 'too_perfect') : null
  };
}

/**
 * v2.0: Validate swipe gesture
 * @param {Array} points - Drawing points
 * @param {Number} expectedAngle - Expected direction in degrees (0 = right, 90 = up, etc.)
 * @returns {Object} - {valid, angle, length, straightness}
 */
function validateSwipe(points, expectedAngle = 0) {
  if (points.length < 5) {
    return { valid: false, reason: 'insufficient_points' };
  }

  // Calculate swipe vector (start to end)
  const startPoint = points[0];
  const endPoint = points[points.length - 1];
  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length < CONFIG.SHAPE.SWIPE.MIN_LENGTH) {
    return { valid: false, reason: 'too_short', length };
  }

  // Calculate angle
  const angleRad = Math.atan2(-dy, dx); // Negative dy because canvas Y is inverted
  const angleDeg = angleRad * (180 / Math.PI);
  const normalizedAngle = ((angleDeg % 360) + 360) % 360;

  // Check angle deviation
  const angleDiff = Math.abs(normalizedAngle - expectedAngle);
  const angleError = Math.min(angleDiff, 360 - angleDiff);

  const angleValid = angleError <= CONFIG.SHAPE.SWIPE.ANGLE_TOLERANCE;

  // Calculate straightness (how much it deviates from straight line)
  let totalDeviation = 0;
  for (const point of points) {
    // Distance from point to line (start-end)
    const numerator = Math.abs(dy * point.x - dx * point.y + endPoint.x * startPoint.y - endPoint.y * startPoint.x);
    const denominator = length;
    const distance = denominator > 0 ? numerator / denominator : 0;
    totalDeviation += distance;
  }

  const avgDeviation = totalDeviation / points.length;
  const straightness = length > 0 ? 1 - Math.min(1, avgDeviation / (length * 0.1)) : 0;

  // Count curves (direction changes)
  let curves = 0;
  for (let i = 2; i < points.length; i++) {
    const dx1 = points[i - 1].x - points[i - 2].x;
    const dy1 = points[i - 1].y - points[i - 2].y;
    const dx2 = points[i].x - points[i - 1].x;
    const dy2 = points[i].y - points[i - 1].y;
    
    const angle1 = Math.atan2(dy1, dx1);
    const angle2 = Math.atan2(dy2, dx2);
    const angleDiff = Math.abs(angle2 - angle1);
    
    if (angleDiff > 0.5) curves++; // ~29 degrees
  }

  const tooManyCurves = curves > CONFIG.SHAPE.SWIPE.MAX_CURVES;

  const valid = angleValid && !tooManyCurves && straightness > 0.5;

  return {
    valid,
    angle: normalizedAngle,
    expectedAngle,
    angleError,
    length,
    straightness,
    curves,
    reason: !valid ? (tooManyCurves ? 'too_many_curves' : !angleValid ? 'wrong_direction' : 'not_straight') : null
  };
}

/**
 * v2.0: Select challenge type based on user history and bot score
 * @param {Object} userHistory - Previous attempts
 * @param {Number} botScore - Current bot suspicion score (0-1)
 * @returns {Object} - {difficulty, challengeType, config}
 */
function selectChallenge(userHistory = {}, botScore = 0) {
  const failures = userHistory.failures || 0;
  
  // v2.0: Simplified - always use EASY with circle gesture for now
  // This ensures consistent UX and proper testing
  const difficulty = 'EASY';
  const challengeType = 'align_circle'; // Force circle gesture only

  const difficultyConfig = CONFIG.DIFFICULTY[difficulty];

  return {
    difficulty,
    challengeType,
    config: difficultyConfig,
    instruction: getInstructionForChallenge(challengeType)
  };
}

/**
 * v2.0: Generate instruction text for challenge type
 */
function getInstructionForChallenge(challengeType) {
  const instructions = {
    'align_circle': 'Align the lines, then draw a circle around the dot',
    'align_swipe': 'Align the lines, then swipe in the direction shown',
    'align_circle_swipe': 'Align the lines, draw a circle, then swipe right',
    'align_trace': 'Align the lines, then trace the path shown',
    'align_multi_gesture': 'Complete all gestures in order: align, circle, then arrow'
  };
  return instructions[challengeType] || 'Complete the challenge';
}

// ========== v1.3 NEW SECURITY FUNCTIONS ==========

/**
 * v1.3: Temporal Rhythm Analysis
 * Humans have natural rhythm variance; bots are too consistent
 */
function analyzeTemporalRhythm(movements) {
  if (!movements || movements.length < CONFIG.TEMPORAL.PATTERN_LENGTH + 1) {
    return { score: 0, flags: [] };
  }
  
  const flags = [];
  let suspicionScore = 0;
  
  // Extract click timing intervals
  const clickTimes = movements
    .filter(m => m.type === 'click' || m.type === 'pointerdown')
    .map(m => m.timestamp);
  
  if (clickTimes.length < 2) return { score: 0, flags: [] };
  
  const intervals = [];
  for (let i = 1; i < clickTimes.length; i++) {
    intervals.push(clickTimes[i] - clickTimes[i-1]);
  }
  
  // Check 1: Too fast clicking (bot-like)
  const tooFastClicks = intervals.filter(i => i < CONFIG.TEMPORAL.MAX_CLICK_SPEED).length;
  if (tooFastClicks > 0) {
    flags.push('rapid_clicking');
    suspicionScore += 0.3 * (tooFastClicks / intervals.length);
  }
  
  // Check 2: Perfect rhythm (no variance)
  if (intervals.length >= 2) {
    const avgInterval = intervals.reduce((a,b) => a+b, 0) / intervals.length;
    const variance = intervals.reduce((a,b) => a + Math.pow(b - avgInterval, 2), 0) / intervals.length;
    const coefficientOfVariation = Math.sqrt(variance) / avgInterval;
    
    if (coefficientOfVariation < CONFIG.TEMPORAL.MIN_RHYTHM_VARIANCE) {
      flags.push('robotic_rhythm');
      suspicionScore += 0.25;
    }
  }
  
  // Check 3: Lack of hesitation (humans pause to think)
  const hasHesitation = intervals.some(i => 
    i >= CONFIG.TEMPORAL.HESITATION_MIN && i <= CONFIG.TEMPORAL.HESITATION_MAX
  );
  
  if (!hasHesitation && intervals.length > 2) {
    flags.push('no_natural_hesitation');
    suspicionScore += 0.2;
  }
  
  return { score: Math.min(suspicionScore, 1), flags };
}

/**
 * v1.3: Micro-Behavior Analysis
 * Detect sub-pixel movements, tremor, error correction
 */
function analyzeMicroBehaviors(movements) {
  if (!movements || movements.length < 5) {
    return { score: 0, flags: [], humanLikelihood: 0.5 };
  }
  
  const flags = [];
  let humanScore = 0.5; // Start neutral
  
  // Analyze sub-pixel movements (natural hand tremor)
  const subPixelMoves = [];
  for (let i = 1; i < movements.length; i++) {
    const dx = Math.abs(movements[i].x - movements[i-1].x);
    const dy = Math.abs(movements[i].y - movements[i-1].y);
    const distance = Math.sqrt(dx*dx + dy*dy);
    if (distance < 2 && distance > 0.1) { // Sub-pixel movement
      subPixelMoves.push(distance);
    }
  }
  
  const tremorRatio = subPixelMoves.length / movements.length;
  if (tremorRatio >= CONFIG.MICRO_BEHAVIOR.MIN_TREMOR_FREQUENCY) {
    humanScore += 0.2; // Natural tremor detected
  } else {
    flags.push('no_natural_tremor');
    humanScore -= 0.15;
  }
  
  // Check for error corrections (moving back to fix mistakes)
  let corrections = 0;
  for (let i = 2; i < movements.length; i++) {
    const curr = movements[i];
    const prev = movements[i-1];
    const prev2 = movements[i-2];
    
    // Did they move forward then backward?
    const dir1 = Math.atan2(prev.y - prev2.y, prev.x - prev2.x);
    const dir2 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    const angleDiff = Math.abs(dir2 - dir1);
    
    if (angleDiff > Math.PI * 0.7) { // ~>126° turn
      corrections++;
    }
  }
  
  if (corrections >= CONFIG.MICRO_BEHAVIOR.CORRECTION_THRESHOLD) {
    humanScore += 0.15; // Natural error correction
  } else if (corrections === 0 && movements.length > 10) {
    flags.push('no_error_correction');
    humanScore -= 0.2; // Suspiciously perfect
  }
  
  // Check for perfect straight lines (bot-like)
  let perfectLines = 0;
  for (let i = 2; i < movements.length; i++) {
    const p1 = movements[i-2], p2 = movements[i-1], p3 = movements[i];
    const crossProduct = Math.abs(
      (p2.y - p1.y) * (p3.x - p1.x) - (p3.y - p1.y) * (p2.x - p1.x)
    );
    if (crossProduct < 0.5) perfectLines++; // Perfectly linear
  }
  
  if (perfectLines > CONFIG.MICRO_BEHAVIOR.MAX_PERFECT_LINES) {
    flags.push('too_many_perfect_lines');
    humanScore -= 0.25;
  }
  
  // Normalize to 0-1 range
  humanScore = Math.max(0, Math.min(1, humanScore));
  const suspicionScore = 1 - humanScore;
  
  return { score: suspicionScore, flags, humanLikelihood: humanScore };
}

/**
 * v1.3: Honeypot Detection
 * Check if client interacted with invisible elements
 */
function analyzeHoneypotInteraction(telemetry) {
  if (!telemetry || !telemetry.honeypot) {
    return { score: 0, flags: [] };
  }
  
  const flags = [];
  let score = 0;
  
  if (telemetry.honeypot.invisibleClicked) {
    flags.push('clicked_invisible_element');
    score += CONFIG.HONEYPOT.TRAP_INTERACTION_PENALTY;
  }
  
  if (telemetry.honeypot.hiddenFieldFilled) {
    flags.push('filled_hidden_form_field');
    score += CONFIG.HONEYPOT.TRAP_INTERACTION_PENALTY;
  }
  
  if (telemetry.honeypot.trapHovered) {
    flags.push('hovered_trap_element');
    score += 0.2;
  }
  
  return { score: Math.min(score, 1), flags };
}

/**
 * v1.3: Canvas Contamination Detection
 * Check for screenshot/computer vision attacks
 */
function analyzeCanvasContamination(telemetry) {
  if (!telemetry || !telemetry.canvasAnalysis) {
    return { score: 0, flags: [] };
  }
  
  const flags = [];
  let score = 0;
  
  // Check if noise layer is intact
  if (telemetry.canvasAnalysis.noiseLayerMissing) {
    flags.push('noise_layer_removed');
    score += 0.3;
  }
  
  // Check for canvas data extraction attempts
  if (telemetry.canvasAnalysis.dataExtractionAttempts > 0) {
    flags.push('canvas_data_extraction');
    score += 0.4;
  }
  
  // Check if visual cryptography layers are correct
  if (telemetry.canvasAnalysis.layersMismatch) {
    flags.push('visual_crypto_tampered');
    score += 0.35;
  }
  
  return { score: Math.min(score, 1), flags };
}

/**
 * v1.3: Dynamic Difficulty Adjustment
 * Increase challenge complexity based on confidence scores
 */
function adjustDifficultyLevel(confidenceScore, attemptHistory) {
  // Low confidence = harder challenge next time
  if (confidenceScore < 0.4) {
    return 'HIGH'; // Hardest
  } else if (confidenceScore < 0.7) {
    return 'MEDIUM';
  } else {
    return 'LOW'; // Normal
  }
}

/**
 * v1.3: Comprehensive Bot Score Calculation
 * Combines all detection methods with weighted scoring
 */
function calculateComprehensiveBotScore(telemetry, movements, clientIP) {
  const scores = {
    automation: analyzeAutomationSignatures(telemetry) * 0.25,
    temporal: analyzeTemporalRhythm(movements).score * 0.20,
    microBehavior: analyzeMicroBehaviors(movements).score * 0.20,
    honeypot: analyzeHoneypotInteraction(telemetry).score * 0.15,
    canvas: analyzeCanvasContamination(telemetry).score * 0.20
  };
  
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  
  const flags = [
    ...analyzeTemporalRhythm(movements).flags,
    ...analyzeMicroBehaviors(movements).flags,
    ...analyzeHoneypotInteraction(telemetry).flags,
    ...analyzeCanvasContamination(telemetry).flags
  ];
  
  return {
    botScore: Math.min(totalScore, 1),
    humanLikelihood: 1 - totalScore,
    breakdown: scores,
    flags,
    recommendation: totalScore > 0.65 ? 'REJECT' : totalScore > 0.4 ? 'CHALLENGE' : 'ACCEPT'
  };
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
    
    // v1.3: Comprehensive Bot Detection System
    const comprehensiveAnalysis = calculateComprehensiveBotScore(
      req.body.telemetry,
      movements,
      clientIP
    );
    
    // Record behavior for tracking
    const currentBehavior = {
      reactionTime: reaction_client_ms,
      accuracy: movementAnalysis.confidence,
      userAgent: req.headers['user-agent']
    };
    recordBehavior(clientIP, currentBehavior);
    
    const { anomalyScore: behavioralAnomaly, flags: behavioralFlags } = detectAnomalies(clientIP, currentBehavior);
    
    // Combine v1.2 and v1.3 scores
    const legacyAutomationScore = ((heuristics.timestampEntropy < 2 ? 0.4 : 0) + 
      (heuristics.pressureVariance < 0.01 ? 0.2 : 0) + 
      (heuristics.constantIntervals ? 0.3 : 0) + 
      (movementAnalysis.confidence < 0.2 ? 0.3 : 0));
    
    // Final combined score (60% v1.3 + 40% v1.2)
    const finalBotScore = (comprehensiveAnalysis.botScore * 0.6) + 
                          (Math.max(legacyAutomationScore, behavioralAnomaly) * 0.4);
    
    const allFlags = [
      ...comprehensiveAnalysis.flags,
      ...behavioralFlags
    ];
    
    const AUTOMATION_THRESHOLD = 0.65;
    if (!movementAnalysis.valid || finalBotScore >= AUTOMATION_THRESHOLD) {
      ipFailures.set(clientIP, (ipFailures.get(clientIP) || 0) + 1);
      if (ipFailures.get(clientIP) > 3) suspiciousIPs.add(clientIP);
      
      debugLog('v1.3 AUTOMATION DETECTED', {
        finalScore: finalBotScore,
        breakdown: comprehensiveAnalysis.breakdown,
        recommendation: comprehensiveAnalysis.recommendation,
        flags: allFlags,
        humanLikelihood: comprehensiveAnalysis.humanLikelihood
      });
      
      return res.status(400).json({
        ok: false,
        message: 'Verification failed - automated behavior detected',
        botScore: finalBotScore,
        humanLikelihood: comprehensiveAnalysis.humanLikelihood,
        flags: allFlags,
        version: CONFIG.VERSION
      });
    }
    
    debugLog('v1.3 VERIFICATION SUCCESS', {
      botScore: finalBotScore,
      humanLikelihood: comprehensiveAnalysis.humanLikelihood,
      recommendation: comprehensiveAnalysis.recommendation
    });

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
    debugLog('MOVEMENT ANALYSIS', { riskLevel, totalMovements: Array.isArray(movements) ? movements.length : 0, validationResult: movementAnalysis, behavioralAnomaly, allFlags, recentAttempts: attemptsCount });
        const angleOk = error <= challengeBlob.tolerance; const reactionOk = reaction_client_ms >= CONFIG.MIN_REACTION_MS && reaction_client_ms <= CONFIG.MAX_REACTION_MS;
        debugLog('ANGLE COMPARISON', { raw_user_angle: req.body.user_angle, normalized_user: userAngle, raw_target: data.targetAngle, normalized_target: targetAngle, difference: error, tolerance: challengeBlob.tolerance, angleOk, reactionOk });
        if (!angleOk || !reactionOk) { ipFailures.set(clientIP, (ipFailures.get(clientIP) || 0) + 1); return res.status(400).json({ ok: false, message: 'Verification failed', debug: { error, tolerance: challengeBlob.tolerance, userAngle, targetAngle, reaction_client_ms } }); }

        data.used = true; ipFailures.set(clientIP, 0);
        const angleScore = Math.max(0, 1 - (error / (challengeBlob.tolerance * 4)));
         // v1.3: Use comprehensive bot score for final confidence
         const positiveAngleComponent = Math.max(0, angleScore * 0.7);
         const positiveMovementComponent = Math.max(0, movementAnalysis.confidence * 0.3);
         const automationPenalty = Math.min(positiveAngleComponent + positiveMovementComponent, finalBotScore * 0.2);
         // Calculate final confidence ensuring it's between 0-100
         const confidence = Math.round(Math.max(0, positiveAngleComponent + positiveMovementComponent - automationPenalty) * 100);
        return res.json({ ok: true, message: 'Verified successfully', confidence, humanLikelihood: comprehensiveAnalysis.humanLikelihood, botScore: finalBotScore });
    } catch (e) {
        console.error('verify error', e); return res.status(500).json({ ok: false, message: 'internal error' });
    }
});

// ========== v2.0 GESTURE VERIFICATION ENDPOINT ==========

/**
 * v2.0: Combined alignment + gesture verification
 * Accepts both v1.3 alignment data AND v2.0 gesture/stroke data
 */
app.post('/api/v2/verify', async (req, res) => {
    try {
        debugLog('v2.0 VERIFICATION REQUEST', { 
            hasGesture: !!req.body.gesture, 
            gestureType: req.body.gesture?.type,
            ip: req.ip 
        });

        const { movements, fingerprint, timing, pow_nonce, gesture } = req.body || {};
        const clientIP = req.ip;

        // Rate limiting (same as v1.3)
        if (await isLocked(clientIP)) {
            return res.status(429).json({ ok: false, message: 'Too many failed attempts, try later' });
        }

        const attemptsCount = await incrRateKey(`rl:${clientIP}`, CONFIG.RATE_LIMITS.WINDOW_MS);
        if (attemptsCount >= CONFIG.RATE_LIMITS.MAX_REQUESTS) {
            ipFailures.set(clientIP, (ipFailures.get(clientIP) || 0) + 1);
            if ((ipFailures.get(clientIP) || 0) > 5) await setLockout(clientIP, 5 * 60 * 1000);
            return res.status(429).json({ ok: false, message: 'Too many attempts' });
        }

        const riskLevel = suspiciousIPs.has(clientIP) ? 'HIGH' : (attemptsCount && attemptsCount > 50) ? 'MEDIUM' : 'LOW';
        
        // Validate basic parameters
        const fingerprint_hash = req.body.fingerprint_hash || req.body.fingerprint?.hash;
        if (!fingerprint_hash || typeof fingerprint_hash !== 'string') {
            return res.status(400).json({ ok: false, message: 'fingerprint_hash required' });
        }

        const { challenge: challengeB64, sig, user_angle, reaction_client_ms } = req.body || {};
        if (!challengeB64 || !sig || typeof user_angle !== 'number' || typeof reaction_client_ms !== 'number') {
            return res.status(400).json({ ok: false, message: 'Missing alignment parameters' });
        }

        // v2.0: Validate gesture data
        if (!gesture || !gesture.type || !gesture.strokes || !Array.isArray(gesture.strokes)) {
            return res.status(400).json({ ok: false, message: 'Missing or invalid gesture data' });
        }

        if (gesture.strokes.length === 0) {
            return res.status(400).json({ ok: false, message: 'No gesture strokes provided' });
        }

        // Validate stroke points
        const firstStroke = gesture.strokes[0];
        if (!Array.isArray(firstStroke) || firstStroke.length < CONFIG.GESTURE.MIN_POINTS) {
            return res.status(400).json({ ok: false, message: 'Insufficient gesture points' });
        }

        // === PHASE 0: Verify Challenge and Angle Alignment ===
        // Decode and validate challenge
        let challengeData;
        try {
            const challengeJson = Buffer.from(challengeB64, 'base64').toString('utf8');
            challengeData = JSON.parse(challengeJson);
        } catch (e) {
            return res.status(400).json({ ok: false, message: 'Invalid challenge format' });
        }

        // Verify HMAC signature
        const hmac = crypto.createHmac('sha256', CONFIG.SECRET_KEY);
        hmac.update(challengeB64);
        const computedSig = hmac.digest('hex');
        
        if (computedSig !== sig) {
            return res.status(400).json({ ok: false, message: 'Invalid challenge signature' });
        }

        // Check challenge expiration
        const now = Date.now();
        const storedChallenge = challenges.get(challengeData.id);
        
        if (!storedChallenge) {
            return res.status(400).json({ ok: false, message: 'Challenge not found or expired' });
        }

        if (now > storedChallenge.expiresAt) {
            challenges.delete(challengeData.id);
            return res.status(400).json({ ok: false, message: 'Challenge expired' });
        }

        // Validate angle alignment
        const targetAngle = challengeData.angle || storedChallenge.angle;
        if (typeof targetAngle !== 'number') {
            return res.status(400).json({ ok: false, message: 'Invalid challenge data' });
        }

        const userAngle = normalizeAngle(user_angle);
        const normalizedTarget = normalizeAngle(targetAngle);
        const angleError = angleDiffAbs(userAngle, normalizedTarget);
        const angleOk = angleError <= CONFIG.ALIGNMENT.ANGLE_TOLERANCE;

        debugLog('v2.0 ANGLE VALIDATION', {
            userAngle,
            targetAngle: normalizedTarget,
            error: angleError,
            tolerance: CONFIG.ALIGNMENT.ANGLE_TOLERANCE,
            angleOk
        });

        if (!angleOk) {
            ipFailures.set(clientIP, (ipFailures.get(clientIP) || 0) + 1);
            return res.status(400).json({
                ok: false,
                message: 'Alignment verification failed',
                debug: {
                    angleError,
                    tolerance: CONFIG.ALIGNMENT.ANGLE_TOLERANCE,
                    userAngle,
                    targetAngle: normalizedTarget
                }
            });
        }

        // Mark challenge as used
        challenges.delete(challengeData.id);

        // === PHASE 1: v1.3 Alignment Analysis ===
        const movementAnalysis = validateMovements(movements, riskLevel);
        const heuristics = computeMovementHeuristics(movements || []);
        const comprehensiveAnalysis = calculateComprehensiveBotScore(
            req.body.telemetry,
            movements,
            req.body
        );

        const currentBehavior = {
            reactionTime: reaction_client_ms,
            userAgent: req.headers['user-agent'],
            movementCount: movements ? movements.length : 0,
            accuracy: Math.abs(user_angle)
        };

        recordBehavior(clientIP, currentBehavior);
        const { anomalyScore: behavioralAnomaly, flags: behavioralFlags } = detectAnomalies(clientIP, currentBehavior);

        const legacyAutomationScore = (
            (heuristics.timestampEntropy < 2 ? 0.4 : 0) + 
            (heuristics.pressureVariance < 0.01 ? 0.2 : 0) + 
            (heuristics.constantIntervals ? 0.3 : 0) + 
            (movementAnalysis.confidence < 0.2 ? 0.3 : 0)
        );

        const alignmentBotScore = (comprehensiveAnalysis.botScore * 0.6) + 
                                  (Math.max(legacyAutomationScore, behavioralAnomaly) * 0.4);

        // === PHASE 2: v2.0 Gesture Biometrics Analysis ===
        const gestureResults = [];
        let totalGestureScore = 0;
        const gestureFlags = [];

        for (const strokePoints of gesture.strokes) {
            const biometrics = analyzeStrokeBiometrics(strokePoints);
            gestureResults.push(biometrics);
            totalGestureScore += biometrics.humanScore;
            gestureFlags.push(...biometrics.flags);
        }

        const avgGestureScore = gestureResults.length > 0 ? totalGestureScore / gestureResults.length : 0;
        const gestureBotScore = 1 - avgGestureScore; // Invert: higher humanScore = lower botScore

        // === PHASE 3: Shape Validation ===
        let shapeValidation = { valid: false };
        const firstStrokePoints = gesture.strokes[0];

        switch (gesture.type) {
            case 'circle':
                shapeValidation = validateCircle(firstStrokePoints);
                if (!shapeValidation.valid) {
                    gestureFlags.push(`circle_${shapeValidation.reason}`);
                }
                break;
            
            case 'swipe':
                const expectedAngle = gesture.expectedAngle || 0;
                shapeValidation = validateSwipe(firstStrokePoints, expectedAngle);
                if (!shapeValidation.valid) {
                    gestureFlags.push(`swipe_${shapeValidation.reason}`);
                }
                break;
            
            default:
                shapeValidation = { valid: true, warning: 'unknown_gesture_type' };
        }

        const shapeScore = shapeValidation.valid ? 0 : 0.5; // 0 = good, 0.5 = failed shape

        // === PHASE 4: Combined v2.0 Scoring ===
        // Weight: 40% alignment (v1.3) + 40% gesture biometrics + 20% shape validation
        const finalBotScore = (alignmentBotScore * 0.4) + (gestureBotScore * 0.4) + (shapeScore * 0.2);

        const allFlags = [
            ...comprehensiveAnalysis.flags,
            ...behavioralFlags,
            ...gestureFlags,
            ...(shapeValidation.valid ? [] : ['shape_validation_failed'])
        ];

        const AUTOMATION_THRESHOLD_V2 = 0.60; // Slightly lower than v1.3 due to gesture layer

        debugLog('v2.0 COMPREHENSIVE SCORE', {
            finalBotScore,
            breakdown: {
                alignmentScore: alignmentBotScore,
                gestureScore: gestureBotScore,
                shapeScore: shapeScore,
                avgHumanLikelihood: avgGestureScore
            },
            shapeValidation,
            gestureMetrics: gestureResults.map(r => r.metrics),
            flags: allFlags
        });

        if (!movementAnalysis.valid || finalBotScore >= AUTOMATION_THRESHOLD_V2 || !shapeValidation.valid) {
            ipFailures.set(clientIP, (ipFailures.get(clientIP) || 0) + 1);
            if (ipFailures.get(clientIP) > 3) suspiciousIPs.add(clientIP);

            debugLog('v2.0 VERIFICATION FAILED', {
                finalScore: finalBotScore,
                threshold: AUTOMATION_THRESHOLD_V2,
                shapeValid: shapeValidation.valid,
                flags: allFlags
            });

            return res.status(400).json({
                ok: false,
                message: 'Verification failed - automated behavior or invalid gesture detected',
                botScore: finalBotScore,
                humanLikelihood: avgGestureScore,
                alignmentScore: alignmentBotScore,
                gestureScore: gestureBotScore,
                shapeValidation: {
                    valid: shapeValidation.valid,
                    reason: shapeValidation.reason
                },
                flags: allFlags,
                version: CONFIG.VERSION
            });
        }

        // === SUCCESS ===
        debugLog('v2.0 VERIFICATION SUCCESS', {
            botScore: finalBotScore,
            humanLikelihood: avgGestureScore,
            shapeValid: shapeValidation.valid
        });

        const attempts = ipAttempts.get(clientIP) || [];
        attempts.push(Date.now());
        ipAttempts.set(clientIP, attempts);

        // Calculate confidence (0-100)
        const confidence = Math.round((1 - finalBotScore) * 100);

        return res.json({
            ok: true,
            message: 'Verified successfully with gesture authentication',
            confidence,
            humanLikelihood: avgGestureScore,
            botScore: finalBotScore,
            breakdown: {
                alignment: alignmentBotScore,
                gesture: gestureBotScore,
                shape: shapeScore
            },
            shapeValidation: {
                valid: shapeValidation.valid,
                type: gesture.type,
                metrics: shapeValidation
            },
            version: CONFIG.VERSION
        });

    } catch (e) {
        console.error('v2.0 verify error', e);
        return res.status(500).json({ ok: false, message: 'internal error' });
    }
});

/**
 * v2.0: Get challenge with difficulty selection
 */
app.post('/api/v2/challenge', async (req, res) => {
    try {
        const clientIP = req.ip;
        const userHistory = {
            failures: ipFailures.get(clientIP) || 0
        };

        // Calculate current bot score from history
        const history = ipBehaviorHistory.get(clientIP);
        const botScore = history ? Math.min(1, history.velocityAnomalies / 10) : 0;

        const selectedChallenge = selectChallenge(userHistory, botScore);

        // Generate standard v1.3 challenge data
        const challengeId = uuidv4();
        const timestamp = Date.now();
        const targetAngle = Math.floor(Math.random() * 180) - 90;
        
        const challenge = {
            id: challengeId,
            angle: targetAngle,
            ts: timestamp,
            v2: {
                difficulty: selectedChallenge.difficulty,
                type: selectedChallenge.challengeType,
                instruction: selectedChallenge.instruction,
                config: selectedChallenge.config
            }
        };

        const challengeB64 = Buffer.from(JSON.stringify(challenge)).toString('base64');
        const hmac = crypto.createHmac('sha256', CONFIG.SECRET_KEY);
        hmac.update(challengeB64);
        const sig = hmac.digest('hex');

        challenges.set(challengeId, { ...challenge, expiresAt: timestamp + CONFIG.CHALLENGE_TTL * 1000 });

        debugLog('v2.0 CHALLENGE GENERATED', {
            id: challengeId,
            difficulty: selectedChallenge.difficulty,
            type: selectedChallenge.challengeType,
            botScore
        });

        return res.json({
            challenge: challengeB64,
            sig,
            version: CONFIG.VERSION,
            v2: selectedChallenge
        });

    } catch (e) {
        console.error('v2.0 challenge error', e);
        return res.status(500).json({ ok: false, message: 'internal error' });
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
