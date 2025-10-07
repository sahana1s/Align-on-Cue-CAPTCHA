// server.js - Node.js/Express server implementation
const express = require('express');
const crypto = require('crypto');
const redis = require('redis');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// Configuration
const CONFIG = {
  SECRET_KEY: process.env.CAPTCHA_SECRET || 'your-256-bit-secret-key-here',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  CHALLENGE_TTL: 90, // seconds
  TOLERANCE: 8, // degrees
  MIN_REACTION_MS: 60,
  MAX_REACTION_MS: 3000,
  PORT: process.env.PORT || 3000
};

// Redis client
const redisClient = redis.createClient({ url: CONFIG.REDIS_URL });
redisClient.connect().catch(console.error);

// Utility functions
function generateHMAC(data) {
  return crypto
    .createHmac('sha256', CONFIG.SECRET_KEY)
    .update(JSON.stringify(data))
    .digest('base64');
}

function verifyHMAC(data, signature) {
  const expectedSig = generateHMAC(data);
  return crypto.timingSafeEqual(
    Buffer.from(expectedSig),
    Buffer.from(signature)
  );
}

// Deterministic angle generation from seed (matching client logic)
function computeTargetAngle(seed) {
  // Use seed to generate deterministic pseudo-random angle
  const hash = crypto.createHash('sha256');
  hash.update(seed.toString());
  const hashBytes = hash.digest();
  // Use first 4 bytes as integer, mod 360 for angle
  const angle = (hashBytes.readUInt32BE(0) % 360);
  return angle;
}

// Calculate minimum angular difference (handles wrap-around)
function angleDiffAbs(a, b) {
  let diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  // If difference is greater than 90, bars are parallel
  if (diff > 90) {
    diff = Math.abs(180 - diff);
  }
  return diff;
}

function normalizeAngle(angle) {
  angle = angle % 360;
  if (angle > 180) angle -= 360;
  if (angle <= -180) angle += 360;
  return angle;
}

// Heuristic scoring for bot detection
function calculateSuspicionScore(data) {
  const {
    reaction_client_ms,
    trace_summary = {},
    client_info = {},
    error_degrees
  } = data;

  let score = 0;

  // Perfect alignment is suspicious
  if (error_degrees < 0.5) score += 0.3;
  
  // Very fast reaction is suspicious
  if (reaction_client_ms < 150) score += 0.4;
  
  // No trace data is suspicious
  if (!trace_summary.samples || trace_summary.samples < 5) {
    score += 0.3;
  }
  
  // Low entropy in movement is suspicious
  if (trace_summary.entropy && trace_summary.entropy < 0.3) {
    score += 0.2;
  }
  
  // Unusually smooth velocity is suspicious
  if (trace_summary.avg_velocity && trace_summary.avg_velocity > 50) {
    score += 0.2;
  }
  
  // Missing or suspicious user agent
  if (!client_info.ua || client_info.ua.includes('bot')) {
    score += 0.3;
  }

  return Math.min(score, 1.0);
}

// API Endpoints

// 1. Challenge Generation
app.post('/api/v1/challenge', async (req, res) => {
  try {
    const { client_id, preferences = {} } = req.body;
    
    // Generate challenge components
    const nonce = uuidv4();
    const seed = crypto.randomInt(0, 2147483647);
    const targetAngle = computeTargetAngle(seed);
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + CONFIG.CHALLENGE_TTL;
    
    // Visual parameters for client (don't reveal target)
    const visualParams = {
      offset: Math.random() * 360, // Visual offset to obscure actual target
      appearance: 'v1'
    };
    
    // Challenge blob (signed and sent to client)
    const challengeBlob = {
      nonce,
      seed,
      tolerance: CONFIG.TOLERANCE,
      issued_at: issuedAt,
      expires_at: expiresAt,
      visual_params: visualParams
    };
    
    // Generate signature
    const signature = generateHMAC(challengeBlob);
    
    // Store in Redis
    const redisKey = `captcha:${nonce}`;
    const redisData = {
      seed,
      target_angle: targetAngle,
      expires_at: expiresAt,
      used: false,
      client_id,
      ip: req.ip
    };
    
    await redisClient.setEx(
      redisKey,
      CONFIG.CHALLENGE_TTL,
      JSON.stringify(redisData)
    );
    
    // Send to client
    res.json({
      challenge: Buffer.from(JSON.stringify(challengeBlob)).toString('base64'),
      sig: signature
    });
    
  } catch (error) {
    console.error('Challenge generation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. Solution Verification
app.post('/api/v1/verify', async (req, res) => {
  try {
    const {
      challenge: challengeB64,
      sig,
      user_angle,
      reaction_client_ms,
      trace_summary,
      trace_hash,
      client_info
    } = req.body;
    
    // Decode challenge
    let challengeBlob;
    try {
      challengeBlob = JSON.parse(
        Buffer.from(challengeB64, 'base64').toString()
      );
    } catch (e) {
      return res.status(400).json({
        ok: false,
        message: 'Invalid challenge format',
        reason_code: 'INVALID_FORMAT'
      });
    }
    
    // 1. Verify signature
    if (!verifyHMAC(challengeBlob, sig)) {
      return res.status(400).json({
        ok: false,
        message: 'Invalid signature',
        reason_code: 'INVALID_SIGNATURE'
      });
    }
    
    // 2. Fetch from Redis
    const redisKey = `captcha:${challengeBlob.nonce}`;
    const storedData = await redisClient.get(redisKey);
    
    if (!storedData) {
      return res.status(400).json({
        ok: false,
        message: 'Challenge not found or expired',
        reason_code: 'NOT_FOUND'
      });
    }
    
    const challengeData = JSON.parse(storedData);
    
    // 3. Check if already used
    if (challengeData.used) {
      return res.status(400).json({
        ok: false,
        message: 'Challenge already used',
        reason_code: 'ALREADY_USED'
      });
    }
    
    // 4. Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (now > challengeBlob.expires_at) {
      await redisClient.del(redisKey);
      return res.status(400).json({
        ok: false,
        message: 'Challenge expired',
        reason_code: 'EXPIRED'
      });
    }
    
    // 5. Verify angle alignment
    const targetAngle = challengeData.target_angle;
    const errorDegrees = angleDiffAbs(user_angle, targetAngle);
    const angleOk = errorDegrees <= challengeBlob.tolerance;
    
    if (!angleOk) {
      return res.status(400).json({
        ok: false,
        message: 'Alignment verification failed',
        reason_code: 'ANGLE'
      });
    }
    
    // 6. Verify reaction time
    const reactionServerMs = (now - challengeBlob.issued_at) * 1000;
    const reactionOk = reaction_client_ms >= CONFIG.MIN_REACTION_MS && 
                       reaction_client_ms <= CONFIG.MAX_REACTION_MS &&
                       reactionServerMs <= CONFIG.MAX_REACTION_MS + 1000; // Allow 1s network delay
    
    if (!reactionOk) {
      return res.status(400).json({
        ok: false,
        message: 'Invalid reaction time',
        reason_code: 'TIMING'
      });
    }
    
    // 7. Calculate suspicion score
    const suspicionScore = calculateSuspicionScore({
      reaction_client_ms,
      trace_summary,
      client_info,
      error_degrees: errorDegrees
    });
    
    // 8. Bot detection threshold
    if (suspicionScore > 0.7) {
      return res.status(400).json({
        ok: false,
        message: 'Verification failed',
        reason_code: 'SUSPICIOUS'
      });
    }
    
    // 9. Mark as used
    challengeData.used = true;
    await redisClient.setEx(
      redisKey,
      60, // Keep for 1 minute for duplicate detection
      JSON.stringify(challengeData)
    );
    
    // 10. Store audit log (optional - could use separate DB)
    const auditLog = {
      nonce: challengeBlob.nonce,
      ip: req.ip,
      user_agent: client_info?.ua,
      error_degrees: errorDegrees,
      reaction_client_ms,
      reaction_server_ms: reactionServerMs,
      suspicion_score: suspicionScore,
      result: 'SUCCESS',
      timestamp: new Date()
    };
    console.log('Audit:', auditLog);
    
    // Success response
    res.json({
      ok: true,
      message: 'Verified successfully'
    });
    
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      ok: false,
      message: 'Internal server error',
      reason_code: 'SERVER_ERROR'
    });
  }
});

// 3. Optional: Telemetry endpoint
app.post('/api/v1/telemetry', async (req, res) => {
  try {
    const { trace_hash, trace_data } = req.body;
    
    // Store telemetry for analysis (implement based on your needs)
    // This could go to a time-series DB, S3, or analytics pipeline
    console.log(`Telemetry received: hash=${trace_hash}, points=${trace_data?.length}`);
    
    // You could:
    // - Store in ClickHouse/TimescaleDB for analysis
    // - Send to ML pipeline for bot pattern detection
    // - Update heuristic models
    
    res.json({ ok: true });
    
  } catch (error) {
    console.error('Telemetry error:', error);
    res.status(500).json({ error: 'Failed to store telemetry' });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await redisClient.ping();
    res.json({ status: 'healthy', timestamp: new Date() });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

// CORS headers (configure based on your needs)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Start server
app.listen(CONFIG.PORT, () => {
  console.log(`Anti-bot CAPTCHA server running on port ${CONFIG.PORT}`);
  console.log(`Redis: ${CONFIG.REDIS_URL}`);
  console.log(`Challenge TTL: ${CONFIG.CHALLENGE_TTL}s`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing connections...');
  await redisClient.quit();
  process.exit(0);
});

