// server.js
"use strict";
require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const zlib = require("zlib");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const NodeCache = require("node-cache");
const queue = require("./src/queue-manager");
const aiAnalyst = require("./src/ai-analyst");
const s3Helpers = require("./src/s3-helpers");
const { generateTimeline } = require("./timeline-react-aware");

// ----- Session Playback Cache -----
// TTL: 10 minutes, check for expired keys every 2 minutes, max 100 sessions cached
const sessionCache = new NodeCache({
  stdTTL: 600,
  checkperiod: 120,
  maxKeys: 100,
  useClones: false  // Don't clone on get (faster, we're read-only)
});

// ----- Auth Configuration -----
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
let adminUsers = [];
try {
  adminUsers = JSON.parse(process.env.ADMIN_USERS || "[]");
} catch (err) {
  console.error("Error parsing ADMIN_USERS:", err);
}

// Hash passwords on startup if not already hashed
adminUsers = adminUsers.map(user => {
  if (!user.password.startsWith("$2")) {
    return { ...user, password: bcrypt.hashSync(user.password, 10) };
  }
  return user;
});

// Import rrdom packages (for potential server‑side DOM processing)
const rrdom = require("rrdom");
const rrdomNodejs = require("rrdom-nodejs");

// ----- SQLite Database Setup -----
const Database = require("better-sqlite3");
// Use /app/data in Docker, local directory otherwise
const dbDir = process.env.NODE_ENV === "production" ? "/app/data" : __dirname;
const dbPath = path.join(dbDir, "db.sqlite");
const db = new Database(dbPath);

// Enable WAL mode for concurrent read/write (Worker + Server)
db.pragma('journal_mode = WAL');
console.log("✅ SQLite WAL mode enabled");

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    distinct_id TEXT NOT NULL,
    campaign_id INTEGER,
    s3_key TEXT UNIQUE NOT NULL,
    s3_bucket TEXT NOT NULL,
    page_url TEXT,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS aliases (
    distinct_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    status TEXT DEFAULT NULL,
    watched INTEGER DEFAULT 0,
    watched_at INTEGER,
    updated_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_session_chunks_session_id ON session_chunks(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  CREATE INDEX IF NOT EXISTS idx_session_chunks_distinct_id ON session_chunks(distinct_id);
  CREATE INDEX IF NOT EXISTS idx_session_chunks_campaign_id ON session_chunks(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_aliases_user_id ON aliases(user_id);
  CREATE INDEX IF NOT EXISTS idx_campaigns_name ON campaigns(name);
`);

// Migration: Add s3_bucket column if it doesn't exist (for existing databases)
try {
  db.exec(`ALTER TABLE session_chunks ADD COLUMN s3_bucket TEXT`);
  console.log("✅ Migration: Added s3_bucket column to session_chunks");
} catch (e) {
  // Column already exists, ignore
}

// Migration: Remove local_key column by recreating table (if upgrading from old schema)
// We just ignore local_key going forward - SQLite doesn't support DROP COLUMN easily

// Migration: Add assets_status column for video/timeline processing state
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN assets_status TEXT DEFAULT 'raw'`);
  console.log("✅ Migration: Added assets_status column to sessions");
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add video_s3_key column for processed video location
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN video_s3_key TEXT`);
  console.log("✅ Migration: Added video_s3_key column to sessions");
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add timeline_s3_key column for processed timeline location
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN timeline_s3_key TEXT`);
  console.log("✅ Migration: Added timeline_s3_key column to sessions");
} catch (e) {
  // Column already exists, ignore
}

// Create index for assets_status queries
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_assets_status ON sessions(assets_status)`);
} catch (e) {
  // Index already exists, ignore
}

// Migration: Add ai_report column to campaigns for storing AI analysis reports
try {
  db.exec(`ALTER TABLE campaigns ADD COLUMN ai_report TEXT`);
  console.log("✅ Migration: Added ai_report column to campaigns");
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add ai_analysis_status column to campaigns for tracking analysis state
try {
  db.exec(`ALTER TABLE campaigns ADD COLUMN ai_analysis_status TEXT DEFAULT 'pending'`);
  console.log("✅ Migration: Added ai_analysis_status column to campaigns");
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add mission_brief column for free-text funnel description
// The AI will dynamically generate analysis categories from this
try {
  db.exec(`ALTER TABLE campaigns ADD COLUMN mission_brief TEXT`);
  console.log("✅ Migration: Added mission_brief column to campaigns");
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add generated_rubric column to store the AI-generated analysis config
try {
  db.exec(`ALTER TABLE campaigns ADD COLUMN generated_rubric TEXT`);
  console.log("✅ Migration: Added generated_rubric column to campaigns");
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add per-session AI diagnosis fields
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN ai_diagnosis TEXT`);
  console.log("✅ Migration: Added ai_diagnosis column to sessions");
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE sessions ADD COLUMN ai_evidence TEXT`);
  console.log("✅ Migration: Added ai_evidence column to sessions");
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE sessions ADD COLUMN ai_last_step TEXT`);
  console.log("✅ Migration: Added ai_last_step column to sessions");
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE sessions ADD COLUMN ai_progress INTEGER`);
  console.log("✅ Migration: Added ai_progress column to sessions");
} catch (e) {
  // Column already exists, ignore
}

console.log("✅ SQLite database initialized at:", dbPath);

// Prepare statements for better performance
// insertCampaign removed - using inline prepare with analysis_config

const getCampaignByName = db.prepare(`
  SELECT id, name, created_at FROM campaigns WHERE name = ?
`);

const getCampaignById = db.prepare(`
  SELECT id, name, created_at FROM campaigns WHERE id = ?
`);

const getAllCampaigns = db.prepare(`
  SELECT c.id, c.name, c.created_at,
    (SELECT COUNT(DISTINCT sc.session_id) FROM session_chunks sc WHERE sc.campaign_id = c.id) as session_count,
    (SELECT COUNT(DISTINCT sc2.session_id) FROM session_chunks sc2
     LEFT JOIN sessions s ON sc2.session_id = s.session_id
     WHERE sc2.campaign_id = c.id AND s.status = 'completed') as completed_count,
    (SELECT COUNT(DISTINCT sc3.session_id) FROM session_chunks sc3
     LEFT JOIN sessions s2 ON sc3.session_id = s2.session_id
     WHERE sc3.campaign_id = c.id AND (s2.status IS NULL OR s2.status = 'dropped_off')) as dropped_off_count
  FROM campaigns c
  ORDER BY c.created_at DESC
`);

const deleteCampaignById = db.prepare(`
  DELETE FROM campaigns WHERE id = ?
`);

const deleteSessionChunksByCampaignId = db.prepare(`
  DELETE FROM session_chunks WHERE campaign_id = ?
`);

const getSessionCountByCampaignId = db.prepare(`
  SELECT COUNT(DISTINCT session_id) as count FROM session_chunks WHERE campaign_id = ?
`);

const insertSessionChunk = db.prepare(`
  INSERT OR IGNORE INTO session_chunks (session_id, distinct_id, campaign_id, s3_key, s3_bucket, page_url, timestamp)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (email) VALUES (?)
`);

const getUserByEmail = db.prepare(`
  SELECT id FROM users WHERE email = ?
`);

const insertAlias = db.prepare(`
  INSERT OR REPLACE INTO aliases (distinct_id, user_id) VALUES (?, ?)
`);

const upsertSessionStatus = db.prepare(`
  INSERT INTO sessions (session_id, status, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
`);

const getSessionStatus = db.prepare(`
  SELECT status FROM sessions WHERE session_id = ?
`);

const app = express();

// ----- CORS Middleware -----
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Allow requests from allowed domains
  if (origin && allowedDomains[origin.replace(/^https?:\/\//, '')]) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ----- Security Middleware -----
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
// Raw body parser for gzipped requests
app.use(express.raw({ type: "text/plain", limit: "5mb" }));
app.use(express.json({ limit: "5mb" }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
});
app.use(limiter);

// ----- Configuration Endpoint -----
app.get("/config", (req, res) => {
  res.json({
    enableConsolePlugin: process.env.ENABLE_CONSOLE_PLUGIN === "true"
  });
});

// ----- JWT Middleware -----
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

// ----- Domain Token Middleware (for frontend recorder endpoints) -----
const validateDomainToken = (req, res, next) => {
  const { host, domainToken } = req.body;

  if (!host || !domainToken) {
    return res.status(400).json({ error: "Missing host or domainToken" });
  }

  if (!allowedDomains[host] || allowedDomains[host].token !== domainToken) {
    return res.status(403).json({ error: "Invalid domain or token" });
  }

  req.verifiedDomain = host;
  next();
};

// =====================================================
// AUTH ENDPOINTS
// =====================================================

// Login
app.post("/api/auth/login", (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = adminUsers.find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    console.log(`🔐 Admin login: ${email}`);
    res.json({ token, user: { email: user.email } });
  } catch (err) {
    console.error("Error in POST /api/auth/login:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get current user
app.get("/api/auth/me", authenticateJWT, (req, res) => {
  res.json({ email: req.user.email });
});

// ----- Allowed Domains Configuration -----
let allowedDomains = {};
try {
  allowedDomains = JSON.parse(process.env.ALLOWED_DOMAINS);
} catch (err) {
  console.error("Error parsing ALLOWED_DOMAINS environment variable:", err);
  process.exit(1);
}

// ----- AWS Configuration -----
AWS.config.update({
  region: process.env.AWS_REGION
});
const s3 = new AWS.S3();

// =====================================================
// CAMPAIGN ENDPOINTS
// =====================================================

// Create campaign (auth required)
app.post("/api/campaigns", authenticateJWT, (req, res) => {
  try {
    const { name, mission_brief } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Missing or invalid campaign name" });
    }

    const trimmedName = name.trim();

    // Check if campaign already exists
    const existing = getCampaignByName.get(trimmedName);
    if (existing) {
      return res.status(409).json({ error: "Campaign name already exists" });
    }

    const createdAt = Date.now();
    const result = db.prepare(`
      INSERT INTO campaigns (name, created_at, mission_brief) VALUES (?, ?, ?)
    `).run(trimmedName, createdAt, mission_brief || null);

    console.log(`📋 Campaign created: ${trimmedName}`);
    res.status(201).json({
      id: result.lastInsertRowid,
      name: trimmedName,
      created_at: createdAt,
      mission_brief: mission_brief || null
    });
  } catch (err) {
    console.error("Error in POST /api/campaigns:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List campaigns (auth required)
app.get("/api/campaigns", authenticateJWT, (req, res) => {
  try {
    const campaigns = getAllCampaigns.all();
    res.json({ campaigns });
  } catch (err) {
    console.error("Error in GET /api/campaigns:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get campaign by ID (auth required)
app.get("/api/campaigns/:id", authenticateJWT, (req, res) => {
  try {
    const { id } = req.params;
    const campaign = db.prepare(`
      SELECT id, name, created_at, mission_brief, generated_rubric, ai_report, ai_analysis_status
      FROM campaigns WHERE id = ?
    `).get(id);

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const sessionCount = getSessionCountByCampaignId.get(id);
    const completedCount = db.prepare(`
      SELECT COUNT(DISTINCT sc.session_id) as count
      FROM session_chunks sc
      LEFT JOIN sessions s ON sc.session_id = s.session_id
      WHERE sc.campaign_id = ? AND s.status = 'completed'
    `).get(id);
    const droppedOffCount = db.prepare(`
      SELECT COUNT(DISTINCT sc.session_id) as count
      FROM session_chunks sc
      LEFT JOIN sessions s ON sc.session_id = s.session_id
      WHERE sc.campaign_id = ? AND (s.status IS NULL OR s.status = 'dropped_off')
    `).get(id);

    res.json({
      ...campaign,
      generated_rubric: campaign.generated_rubric ? JSON.parse(campaign.generated_rubric) : null,
      session_count: sessionCount?.count || 0,
      completed_count: completedCount?.count || 0,
      dropped_off_count: droppedOffCount?.count || 0
    });
  } catch (err) {
    console.error("Error in GET /api/campaigns/:id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update campaign (auth required)
app.put("/api/campaigns/:id", authenticateJWT, (req, res) => {
  try {
    const { id } = req.params;
    const { name, mission_brief } = req.body;

    const campaign = db.prepare(`
      SELECT id, name, created_at, mission_brief FROM campaigns WHERE id = ?
    `).get(id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Handle name update
    let trimmedName = campaign.name;
    if (name && typeof name === "string" && name.trim().length > 0) {
      trimmedName = name.trim();
      // Check if new name already exists (excluding current campaign)
      const existing = getCampaignByName.get(trimmedName);
      if (existing && existing.id !== parseInt(id)) {
        return res.status(409).json({ error: "Campaign name already exists" });
      }
    }

    // Handle mission_brief update
    let newMissionBrief = campaign.mission_brief;
    if (mission_brief !== undefined) {
      newMissionBrief = mission_brief || null;
    }

    db.prepare(`
      UPDATE campaigns SET name = ?, mission_brief = ? WHERE id = ?
    `).run(trimmedName, newMissionBrief, id);

    console.log(`📝 Campaign updated: ${campaign.name} -> ${trimmedName}`);
    res.json({
      id: parseInt(id),
      name: trimmedName,
      created_at: campaign.created_at,
      mission_brief: newMissionBrief
    });
  } catch (err) {
    console.error("Error in PUT /api/campaigns/:id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete campaign (auth required)
app.delete("/api/campaigns/:id", authenticateJWT, (req, res) => {
  try {
    const { id } = req.params;
    const campaign = getCampaignById.get(id);

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Get session count before deletion
    const sessionCount = getSessionCountByCampaignId.get(id);

    // Delete session chunks first (foreign key)
    deleteSessionChunksByCampaignId.run(id);

    // Delete campaign
    deleteCampaignById.run(id);

    console.log(`🗑️  Campaign deleted: ${campaign.name} (${sessionCount?.count || 0} sessions)`);
    res.json({
      success: true,
      deleted_sessions: sessionCount?.count || 0
    });
  } catch (err) {
    console.error("Error in DELETE /api/campaigns/:id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =====================================================
// SESSION ENDPOINTS
// =====================================================

// Search sessions by email (auth required, MUST be before :session_id route)
app.get("/api/sessions/search", authenticateJWT, (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email query parameter required" });
    }

    const query = `
      SELECT
        sc.session_id,
        sc.distinct_id,
        sc.campaign_id,
        c.name as campaign_name,
        s.status,
        s.watched,
        s.watched_at,
        MIN(sc.timestamp) as first_timestamp,
        MAX(sc.timestamp) as last_timestamp,
        (MAX(sc.timestamp) - MIN(sc.timestamp)) as duration_ms,
        COUNT(sc.id) as chunk_count
      FROM session_chunks sc
      LEFT JOIN campaigns c ON sc.campaign_id = c.id
      LEFT JOIN sessions s ON sc.session_id = s.session_id
      JOIN aliases a ON sc.distinct_id = a.distinct_id
      JOIN users u ON a.user_id = u.id
      WHERE u.email LIKE ?
      GROUP BY sc.session_id
      ORDER BY first_timestamp DESC
    `;

    const sessions = db.prepare(query).all(`%${email}%`);

    const transformedSessions = sessions.map(session => ({
      ...session,
      status: session.status || "dropped_off",
      watched: session.watched === 1,
      playback_url: `/api/sessions/${session.session_id}/playback`
    }));

    res.json({ sessions: transformedSessions });
  } catch (err) {
    console.error("Error in GET /api/sessions/search:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List sessions (auth required)
app.get("/api/sessions", authenticateJWT, (req, res) => {
  try {
    const { campaign_id, campaign, email, status } = req.query;

    if (!campaign_id && !campaign && !email) {
      return res.status(400).json({ error: "Missing filter: campaign_id, campaign, or email required" });
    }

    // Validate status if provided
    if (status && !["completed", "dropped_off"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'completed' or 'dropped_off'" });
    }

    let sessions = [];
    let params = [];

    // Build query based on filters
    let baseQuery = `
      SELECT
        sc.session_id,
        sc.distinct_id,
        sc.campaign_id,
        c.name as campaign_name,
        s.status,
        s.watched,
        s.watched_at,
        s.assets_status,
        s.ai_diagnosis,
        MIN(sc.timestamp) as first_timestamp,
        MAX(sc.timestamp) as last_timestamp,
        (MAX(sc.timestamp) - MIN(sc.timestamp)) as duration_ms,
        COUNT(sc.id) as chunk_count
      FROM session_chunks sc
      LEFT JOIN campaigns c ON sc.campaign_id = c.id
      LEFT JOIN sessions s ON sc.session_id = s.session_id
    `;

    let whereClauses = [];

    if (email) {
      baseQuery += `
      JOIN aliases a ON sc.distinct_id = a.distinct_id
      JOIN users u ON a.user_id = u.id
      `;
      whereClauses.push("u.email = ?");
      params.push(email);
    }

    if (campaign_id || campaign) {
      let cid = campaign_id;
      if (campaign && !campaign_id) {
        const c = getCampaignByName.get(campaign);
        if (!c) {
          return res.status(404).json({ error: "Campaign not found" });
        }
        cid = c.id;
      }
      whereClauses.push("sc.campaign_id = ?");
      params.push(cid);
    }

    if (status) {
      if (status === "dropped_off") {
        // dropped_off = no status set OR explicitly set to dropped_off
        whereClauses.push("(s.status IS NULL OR s.status = 'dropped_off')");
      } else {
        whereClauses.push("s.status = ?");
        params.push(status);
      }
    }

    if (whereClauses.length > 0) {
      baseQuery += " WHERE " + whereClauses.join(" AND ");
    }

    baseQuery += `
      GROUP BY sc.session_id
      ORDER BY first_timestamp DESC
    `;

    sessions = db.prepare(baseQuery).all(...params);

    // Add playback_url, normalize status, and get email for each session
    const transformedSessions = sessions.map(session => {
      // Get email if linked
      const emailResult = db.prepare(`
        SELECT u.email FROM aliases a
        JOIN users u ON a.user_id = u.id
        WHERE a.distinct_id = ?
      `).get(session.distinct_id);

      return {
        ...session,
        status: session.status || "dropped_off",
        watched: session.watched === 1,
        email: emailResult?.email || null,
        playback_url: `/api/sessions/${session.session_id}/playback`
      };
    });

    res.json({ sessions: transformedSessions });
  } catch (err) {
    console.error("Error in GET /api/sessions:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get session playback data (auth required)
app.get("/api/sessions/:session_id/playback", authenticateJWT, async (req, res) => {
  try {
    const { session_id } = req.params;

    // Check cache first
    const cached = sessionCache.get(session_id);
    if (cached) {
      console.log(`⚡ Cache hit for session: ${session_id}`);
      return res.json(cached);
    }

    // Get all chunks for this session
    const query = `
      SELECT sc.*, c.name as campaign_name
      FROM session_chunks sc
      LEFT JOIN campaigns c ON sc.campaign_id = c.id
      WHERE sc.session_id = ?
      ORDER BY sc.timestamp ASC
    `;
    const chunks = db.prepare(query).all(session_id);

    if (chunks.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Filter valid chunks
    const validChunks = chunks.filter(chunk => chunk.s3_key && chunk.s3_bucket);
    if (validChunks.length === 0) {
      return res.status(404).json({ error: "No valid session data found" });
    }

    // Fetch all chunks from S3 in PARALLEL
    console.log(`📥 Fetching ${validChunks.length} chunks from S3 for session: ${session_id}`);
    const fetchStart = Date.now();

    const chunkPromises = validChunks.map(async (chunk) => {
      try {
        const s3Response = await s3.getObject({
          Bucket: chunk.s3_bucket,
          Key: chunk.s3_key
        }).promise();
        return JSON.parse(s3Response.Body.toString("utf8"));
      } catch (s3Err) {
        console.error(`Error fetching chunk from S3 (${chunk.s3_bucket}/${chunk.s3_key}):`, s3Err.message);
        return null;
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    const fetchDuration = Date.now() - fetchStart;
    console.log(`⏱️  Fetched ${validChunks.length} chunks in ${fetchDuration}ms`);

    // Merge events and collect page URLs
    let allEvents = [];
    const pageUrls = [];

    for (const data of chunkResults) {
      if (!data) continue;
      if (data.events && Array.isArray(data.events)) {
        allEvents = allEvents.concat(data.events);
      }
      if (data.pageUrl && !pageUrls.includes(data.pageUrl)) {
        pageUrls.push(data.pageUrl);
      }
    }

    // Sort events by timestamp
    allEvents.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const firstChunk = chunks[0];
    const lastChunk = chunks[chunks.length - 1];

    const result = {
      session_id,
      events: allEvents,
      metadata: {
        campaign_id: firstChunk.campaign_id,
        campaign_name: firstChunk.campaign_name,
        distinct_id: firstChunk.distinct_id,
        duration_ms: lastChunk.timestamp - firstChunk.timestamp,
        page_urls: pageUrls,
        chunk_count: chunks.length,
        cached: false
      }
    };

    // Cache the result
    sessionCache.set(session_id, result);
    console.log(`💾 Cached session: ${session_id} (${allEvents.length} events)`);

    res.json(result);
  } catch (err) {
    console.error("Error in GET /api/sessions/:session_id/playback:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get single session (auth required)
app.get("/api/sessions/:session_id", authenticateJWT, (req, res) => {
  try {
    const { session_id } = req.params;

    const query = `
      SELECT
        sc.session_id,
        sc.distinct_id,
        sc.campaign_id,
        c.name as campaign_name,
        s.status,
        s.watched,
        s.watched_at,
        s.assets_status,
        s.ai_diagnosis,
        s.ai_evidence,
        s.ai_last_step,
        s.ai_progress,
        MIN(sc.timestamp) as first_timestamp,
        MAX(sc.timestamp) as last_timestamp,
        (MAX(sc.timestamp) - MIN(sc.timestamp)) as duration_ms,
        COUNT(sc.id) as chunk_count
      FROM session_chunks sc
      LEFT JOIN campaigns c ON sc.campaign_id = c.id
      LEFT JOIN sessions s ON sc.session_id = s.session_id
      WHERE sc.session_id = ?
      GROUP BY sc.session_id
    `;

    const session = db.prepare(query).get(session_id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Get user email if linked
    const emailQuery = `
      SELECT u.email
      FROM aliases a
      JOIN users u ON a.user_id = u.id
      WHERE a.distinct_id = ?
    `;
    const emailResult = db.prepare(emailQuery).get(session.distinct_id);

    res.json({
      ...session,
      email: emailResult?.email || null,
      status: session.status || "dropped_off",
      assets_status: session.assets_status || "raw",
      watched: session.watched === 1,
      playback_url: `/api/sessions/${session.session_id}/playback`
    });
  } catch (err) {
    console.error("Error in GET /api/sessions/:session_id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete session (auth required)
app.delete("/api/sessions/:session_id", authenticateJWT, async (req, res) => {
  try {
    const { session_id } = req.params;

    // Check if session exists and get S3 info
    const chunks = db.prepare("SELECT s3_key, s3_bucket FROM session_chunks WHERE session_id = ?").all(session_id);
    if (chunks.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Delete from S3
    for (const chunk of chunks) {
      if (chunk.s3_key && chunk.s3_bucket) {
        try {
          await s3.deleteObject({
            Bucket: chunk.s3_bucket,
            Key: chunk.s3_key
          }).promise();
          console.log(`🗑️  Deleted from S3: ${chunk.s3_bucket}/${chunk.s3_key}`);
        } catch (s3Err) {
          console.error(`Error deleting from S3 (${chunk.s3_key}):`, s3Err.message);
        }
      }
    }

    // Delete from session_chunks
    db.prepare("DELETE FROM session_chunks WHERE session_id = ?").run(session_id);

    // Delete from sessions (status)
    db.prepare("DELETE FROM sessions WHERE session_id = ?").run(session_id);

    // Invalidate cache
    sessionCache.del(session_id);

    console.log(`🗑️  Session deleted: ${session_id}`);
    res.json({ success: true, deleted_chunks: chunks.length });
  } catch (err) {
    console.error("Error in DELETE /api/sessions/:session_id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Mark session as watched (auth required)
app.post("/api/sessions/:session_id/watched", authenticateJWT, (req, res) => {
  try {
    const { session_id } = req.params;

    // Check if session exists in chunks
    const chunk = db.prepare("SELECT 1 FROM session_chunks WHERE session_id = ? LIMIT 1").get(session_id);
    if (!chunk) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Upsert watched status
    db.prepare(`
      INSERT INTO sessions (session_id, watched, watched_at, updated_at)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET watched = 1, watched_at = excluded.watched_at, updated_at = excluded.updated_at
    `).run(session_id, Date.now(), Date.now());

    console.log(`👁️  Session marked as watched: ${session_id}`);
    res.json({ success: true, session_id, watched: true });
  } catch (err) {
    console.error("Error in POST /api/sessions/:session_id/watched:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Set session status (domain token required)
app.post("/api/sessions/:session_id/status", validateDomainToken, (req, res) => {
  try {
    const { session_id } = req.params;
    const { status } = req.body;

    if (!status || !["completed", "dropped_off"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'completed' or 'dropped_off'" });
    }

    // Upsert session status
    upsertSessionStatus.run(session_id, status, Date.now());

    // Handle assets based on status
    let assetsStatus;
    if (status === 'dropped_off') {
      // Auto-queue for video generation
      queue.addJob(session_id, db);
      assetsStatus = 'queued';
    } else {
      // Completed sessions stay raw (save cost)
      db.prepare("UPDATE sessions SET assets_status = 'raw' WHERE session_id = ?").run(session_id);
      assetsStatus = 'raw';
    }

    console.log(`🏷️  Session status: ${session_id} -> ${status} (assets: ${assetsStatus})`);
    res.json({ success: true, session_id, status, assets_status: assetsStatus });
  } catch (err) {
    console.error("Error in POST /api/sessions/:session_id/status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Manually trigger video generation for a session (auth required)
app.post("/api/sessions/:session_id/generate-assets", authenticateJWT, (req, res) => {
  try {
    const { session_id } = req.params;

    // Check if session exists
    const session = db.prepare("SELECT session_id, assets_status FROM sessions WHERE session_id = ?").get(session_id);
    if (!session) {
      // Check if chunks exist
      const chunk = db.prepare("SELECT 1 FROM session_chunks WHERE session_id = ? LIMIT 1").get(session_id);
      if (!chunk) {
        return res.status(404).json({ error: "Session not found" });
      }
    }

    // Check current status
    if (session && session.assets_status === 'ready') {
      return res.status(400).json({ error: "Assets already generated", assets_status: 'ready' });
    }
    if (session && session.assets_status === 'processing') {
      return res.status(400).json({ error: "Assets currently being generated", assets_status: 'processing' });
    }
    if (session && session.assets_status === 'queued') {
      return res.status(400).json({ error: "Assets already queued", assets_status: 'queued' });
    }

    // Queue for processing
    queue.addJob(session_id, db);
    console.log(`🎬 Manual video generation queued: ${session_id}`);
    res.json({ success: true, session_id, assets_status: 'queued' });
  } catch (err) {
    console.error("Error in POST /api/sessions/:session_id/generate-assets:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get session assets (video + timeline signed URLs) - auth required
app.get("/api/sessions/:session_id/assets", authenticateJWT, async (req, res) => {
  try {
    const { session_id } = req.params;

    // Get session with asset info
    const session = db.prepare(`
      SELECT s.session_id, s.assets_status, s.video_s3_key, s.timeline_s3_key, sc.s3_bucket
      FROM sessions s
      LEFT JOIN session_chunks sc ON s.session_id = sc.session_id
      WHERE s.session_id = ?
      LIMIT 1
    `).get(session_id);

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // If assets not ready, return status only
    if (session.assets_status !== 'ready') {
      return res.json({
        session_id,
        assets_status: session.assets_status || 'raw',
        video_url: null,
        timeline_url: null
      });
    }

    // Generate signed URLs (1 hour expiry)
    const signedUrlExpiry = 3600;
    let videoUrl = null;
    let timelineUrl = null;

    if (session.video_s3_key && session.s3_bucket) {
      videoUrl = s3.getSignedUrl('getObject', {
        Bucket: session.s3_bucket,
        Key: session.video_s3_key,
        Expires: signedUrlExpiry
      });
    }

    if (session.timeline_s3_key && session.s3_bucket) {
      timelineUrl = s3.getSignedUrl('getObject', {
        Bucket: session.s3_bucket,
        Key: session.timeline_s3_key,
        Expires: signedUrlExpiry
      });
    }

    res.json({
      session_id,
      assets_status: 'ready',
      video_url: videoUrl,
      timeline_url: timelineUrl,
      expires_in: signedUrlExpiry
    });
  } catch (err) {
    console.error("Error in GET /api/sessions/:session_id/assets:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get session AI analysis result (auth required)
app.get("/api/sessions/:session_id/ai-result", authenticateJWT, (req, res) => {
  try {
    const { session_id } = req.params;

    // Get session with AI diagnosis
    const session = db.prepare(`
      SELECT session_id, ai_diagnosis, ai_evidence, ai_last_step, ai_progress
      FROM sessions
      WHERE session_id = ?
    `).get(session_id);

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // If no AI analysis yet
    if (!session.ai_diagnosis) {
      return res.json({
        session_id,
        analyzed: false,
        diagnosis: null,
        evidence: null,
        last_step: null,
        progress_percentage: null
      });
    }

    res.json({
      session_id,
      analyzed: true,
      diagnosis: session.ai_diagnosis,
      evidence: session.ai_evidence,
      last_step: session.ai_last_step,
      progress_percentage: session.ai_progress
    });
  } catch (err) {
    console.error("Error in GET /api/sessions/:session_id/ai-result:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get AI analysis readiness for a campaign (auth required)
app.get("/api/campaigns/:id/ai-status", authenticateJWT, (req, res) => {
  try {
    const { id } = req.params;

    // Verify campaign exists
    const campaign = getCampaignById.get(id);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Count sessions by assets_status for this campaign
    const stats = db.prepare(`
      SELECT
        COUNT(DISTINCT s.session_id) as total,
        COUNT(DISTINCT CASE WHEN s.assets_status = 'ready' THEN s.session_id END) as ready,
        COUNT(DISTINCT CASE WHEN s.assets_status = 'queued' THEN s.session_id END) as queued,
        COUNT(DISTINCT CASE WHEN s.assets_status = 'processing' THEN s.session_id END) as processing,
        COUNT(DISTINCT CASE WHEN s.assets_status = 'raw' OR s.assets_status IS NULL THEN s.session_id END) as raw,
        COUNT(DISTINCT CASE WHEN s.assets_status = 'failed' THEN s.session_id END) as failed,
        COUNT(DISTINCT CASE WHEN s.status = 'dropped_off' THEN s.session_id END) as dropped_off,
        COUNT(DISTINCT CASE WHEN s.status = 'completed' THEN s.session_id END) as completed
      FROM sessions s
      JOIN session_chunks sc ON s.session_id = sc.session_id
      WHERE sc.campaign_id = ?
    `).get(id);

    res.json({
      campaign_id: parseInt(id),
      campaign_name: campaign.name,
      sessions: {
        total: stats.total || 0,
        dropped_off: stats.dropped_off || 0,
        completed: stats.completed || 0
      },
      assets: {
        ready: stats.ready || 0,
        queued: stats.queued || 0,
        processing: stats.processing || 0,
        raw: stats.raw || 0,
        failed: stats.failed || 0
      },
      ai_ready: stats.ready || 0
    });
  } catch (err) {
    console.error("Error in GET /api/campaigns/:id/ai-status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =====================================================
// AI ANALYSIS ENDPOINT - Trigger 3-Stage Analysis
// =====================================================

app.post("/api/campaigns/:id/analyze", authenticateJWT, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);

    // Check for Gemini API key
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
      return res.status(400).json({ error: "GEMINI_API_KEY not configured" });
    }

    // Verify campaign exists and get its mission brief
    const campaign = db.prepare(`
      SELECT id, name, created_at, mission_brief FROM campaigns WHERE id = ?
    `).get(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Mission brief is required for dynamic rubric generation
    if (!campaign.mission_brief) {
      return res.status(400).json({
        error: "Mission brief is required. Please update the campaign with a description of what this funnel is attempting to achieve."
      });
    }

    // Find ONE completed session to use as the Golden Path
    const goldenSession = db.prepare(`
      SELECT DISTINCT s.session_id
      FROM sessions s
      JOIN session_chunks sc ON s.session_id = sc.session_id
      WHERE sc.campaign_id = ?
        AND s.status = 'completed'
      ORDER BY s.updated_at DESC
      LIMIT 1
    `).get(campaignId);

    if (!goldenSession) {
      return res.status(400).json({
        error: "No completed sessions found to calibrate AI. Need at least one completed session as the Golden Path."
      });
    }

    // Find ALL drop-off sessions with ready assets
    const dropOffSessions = db.prepare(`
      SELECT DISTINCT s.session_id, s.timeline_s3_key, s.video_s3_key
      FROM sessions s
      JOIN session_chunks sc ON s.session_id = sc.session_id
      WHERE sc.campaign_id = ?
        AND s.status = 'dropped_off'
        AND s.assets_status = 'ready'
    `).all(campaignId);

    if (dropOffSessions.length === 0) {
      return res.status(400).json({
        error: "No processed drop-off sessions to analyze. Wait for video processing to complete."
      });
    }

    // Mark campaign as analyzing
    db.prepare("UPDATE campaigns SET ai_analysis_status = 'analyzing' WHERE id = ?").run(campaignId);

    // Respond immediately - analysis runs in background
    res.json({
      message: "Analysis started",
      golden_session: goldenSession.session_id,
      drop_off_count: dropOffSessions.length,
      status: "analyzing"
    });

    // Run analysis in background
    (async () => {
      try {
        console.log(`[AI] Starting analysis for campaign: ${campaign.name}`);

        // Step 1: Generate Golden Timeline from completed session
        console.log(`[AI] Generating Golden Timeline from: ${goldenSession.session_id}`);
        const goldenData = await s3Helpers.fetchMergedSession(goldenSession.session_id, db, s3);
        const goldenTimelineText = generateTimeline(goldenData.events);

        // Step 2: Prepare drop-off sessions (fetch timelines from S3)
        const preparedSessions = [];
        for (const session of dropOffSessions) {
          try {
            // Fetch timeline from S3
            const timelineResponse = await s3.getObject({
              Bucket: goldenData.bucket,
              Key: session.timeline_s3_key
            }).promise();
            const timelineText = timelineResponse.Body.toString('utf8');

            preparedSessions.push({
              sessionId: session.session_id,
              timelineText: timelineText
              // Note: Video analysis optional - can add videoPath if downloaded locally
            });
          } catch (err) {
            console.error(`[AI] Error preparing session ${session.session_id}:`, err.message);
          }
        }

        if (preparedSessions.length === 0) {
          throw new Error('No sessions could be prepared for analysis');
        }

        // Step 3: Run full AI analysis with dynamic rubric generation
        const { rubric, analyses, report } = await aiAnalyst.runCampaignAnalysis(
          campaignId,
          campaign.name,
          campaign.mission_brief,
          goldenTimelineText,
          preparedSessions,
          (stage, message) => console.log(`[AI] ${stage}: ${message}`)
        );

        // Step 4: Save per-session AI diagnoses
        const updateSessionDiagnosis = db.prepare(`
          UPDATE sessions
          SET ai_diagnosis = ?, ai_evidence = ?, ai_last_step = ?, ai_progress = ?
          WHERE session_id = ?
        `);

        for (const analysis of analyses) {
          if (analysis.session_id && !analysis.error) {
            updateSessionDiagnosis.run(
              analysis.category || null,
              analysis.evidence || null,
              analysis.last_step_name || null,
              analysis.progress_percentage || null,
              analysis.session_id
            );
            console.log(`[AI] Saved diagnosis for session: ${analysis.session_id} -> ${analysis.category}`);
          }
        }

        // Step 5: Save report and generated rubric to database
        db.prepare(`
          UPDATE campaigns
          SET ai_report = ?, generated_rubric = ?, ai_analysis_status = 'complete'
          WHERE id = ?
        `).run(report, JSON.stringify(rubric), campaignId);

        console.log(`[AI] Analysis complete for campaign: ${campaign.name} (${analyses.length} sessions diagnosed)`);

      } catch (err) {
        console.error(`[AI] Analysis failed for campaign ${campaignId}:`, err);
        db.prepare(`
          UPDATE campaigns
          SET ai_analysis_status = 'failed'
          WHERE id = ?
        `).run(campaignId);
      }
    })();

  } catch (err) {
    console.error("Error in POST /api/campaigns/:id/analyze:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// Get AI analysis report for a campaign
app.get("/api/campaigns/:id/report", authenticateJWT, (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);

    const result = db.prepare(`
      SELECT name, mission_brief, generated_rubric, ai_report, ai_analysis_status
      FROM campaigns
      WHERE id = ?
    `).get(campaignId);

    if (!result) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    res.json({
      campaign_id: campaignId,
      campaign_name: result.name,
      mission_brief: result.mission_brief || null,
      generated_rubric: result.generated_rubric ? JSON.parse(result.generated_rubric) : null,
      status: result.ai_analysis_status || 'pending',
      report: result.ai_report || null
    });

  } catch (err) {
    console.error("Error in GET /api/campaigns/:id/report:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =====================================================
// UPLOAD SESSION (Modified to require campaign)
// =====================================================

app.post("/upload-session", async (req, res) => {
  try {
    // Handle gzip-compressed requests
    let body = req.body;
    if (req.query.compression === "gzip" && Buffer.isBuffer(req.body)) {
      try {
        const decompressed = zlib.gunzipSync(req.body);
        body = JSON.parse(decompressed.toString("utf8"));
        console.log(`📦 Decompressed: ${req.body.length} -> ${decompressed.length} bytes (${((1 - req.body.length / decompressed.length) * 100).toFixed(1)}% saved)`);
      } catch (decompressErr) {
        console.error("Error decompressing request:", decompressErr);
        return res.status(400).json({ error: "Invalid compressed data" });
      }
    }

    const { sessionId, events, pageUrl, host, timestamp, domainToken, distinctId, campaign } = body;

    console.log(`📥 Upload received - Session: ${sessionId}, Host: ${host}, Campaign: ${campaign}, Events: ${events?.length || 0}`);

    // Validate required fields
    if (!sessionId || !Array.isArray(events) || events.length === 0 || !pageUrl || !host || !domainToken || !distinctId) {
      console.log(`❌ Validation failed - sessionId: ${!!sessionId}, events: ${Array.isArray(events) && events.length > 0}, pageUrl: ${!!pageUrl}, host: ${!!host}, token: ${!!domainToken}, distinctId: ${!!distinctId}`);
      return res.status(400).json({ error: "Invalid payload: missing required fields" });
    }

    // Validate campaign
    if (!campaign || typeof campaign !== "string") {
      console.log(`❌ Campaign validation failed: ${campaign}`);
      return res.status(400).json({ error: "Missing campaign name" });
    }

    const campaignRecord = getCampaignByName.get(campaign);
    if (!campaignRecord) {
      console.log(`❌ Campaign not found: ${campaign}`);
      return res.status(404).json({ error: `Campaign not found: ${campaign}` });
    }
    console.log(`✅ Campaign validated: ${campaign} (ID: ${campaignRecord.id})`);

    // Domain verification
    console.log(`🔍 Verifying domain: ${host}, Token provided: ${domainToken?.substring(0, 10)}...`);
    if (!(allowedDomains[host] && allowedDomains[host].token === domainToken)) {
      console.log(`❌ Domain verification failed for: ${host}`);
      console.log(`   Allowed domains:`, Object.keys(allowedDomains));
      return res.status(403).json({ error: "Domain not allowed or token invalid" });
    }
    console.log(`✅ Domain verified: ${host}`);
    const verifiedDomain = host;

    // Determine the correct S3 bucket for this domain
    const bucketName = allowedDomains[verifiedDomain].bucket;
    if (!bucketName) {
      return res.status(500).json({ error: "S3 bucket not configured for domain" });
    }

    // Prepare session data for S3
    const s3Key = `sessions/${sessionId}_${Date.now()}_${uuidv4()}.json`;
    const sessionData = JSON.stringify({
      sessionId,
      events,
      pageUrl,
      host: verifiedDomain,
      timestamp,
      campaign: campaign
    });

    // Upload to S3
    const params = {
      Bucket: bucketName,
      Key: s3Key,
      Body: sessionData,
      ContentType: "application/json"
    };

    try {
      await s3.upload(params).promise();
      console.log(`☁️  Uploaded to S3: s3://${bucketName}/${s3Key}`);
      console.log(`📋 Campaign: ${campaign}`);
      console.log(`📊 Events captured: ${events.length}`);
      console.log(`🌐 Page URL: ${pageUrl}`);

      // Write to SQLite after successful S3 upload
      insertSessionChunk.run(
        sessionId,
        distinctId,
        campaignRecord.id,
        s3Key,
        bucketName,
        pageUrl,
        timestamp
      );
      console.log(`📇 Indexed session chunk: ${sessionId} -> campaign:${campaign}`);

      res.json({ success: true, s3_key: s3Key });
    } catch (uploadErr) {
      console.error("Error uploading to S3:", uploadErr);
      return res.status(500).json({ error: "Failed to upload session to S3" });
    }
  } catch (err) {
    console.error("Error in /upload-session:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =====================================================
// IDENTIFY ENDPOINT
// =====================================================

app.post("/identify", validateDomainToken, (req, res) => {
  try {
    const { email, distinctId } = req.body;
    if (!email || !distinctId) {
      return res.status(400).json({ error: "Missing email or distinctId" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    insertUser.run(email);
    const user = getUserByEmail.get(email);
    if (!user) {
      return res.status(500).json({ error: "Failed to retrieve user ID" });
    }

    insertAlias.run(distinctId, user.id);

    console.log(`🔗 Identity linked: ${distinctId} -> ${email}`);
    res.json({ success: true, message: "Identity linked successfully" });
  } catch (err) {
    console.error("Error in /identify:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =====================================================
// STATS ENDPOINT
// =====================================================

app.get("/api/stats", authenticateJWT, (req, res) => {
  try {
    const totalCampaigns = db.prepare("SELECT COUNT(*) as count FROM campaigns").get().count;
    const totalSessions = db.prepare("SELECT COUNT(DISTINCT session_id) as count FROM session_chunks").get().count;
    const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get().count;

    const completedSessions = db.prepare(`
      SELECT COUNT(*) as count FROM sessions WHERE status = 'completed'
    `).get().count;

    const droppedSessions = db.prepare(`
      SELECT COUNT(DISTINCT sc.session_id) as count
      FROM session_chunks sc
      LEFT JOIN sessions s ON sc.session_id = s.session_id
      WHERE s.status IS NULL OR s.status = 'dropped_off'
    `).get().count;

    // Sessions in last 24 hours
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const sessionsLast24h = db.prepare(`
      SELECT COUNT(DISTINCT session_id) as count FROM session_chunks WHERE timestamp > ?
    `).get(oneDayAgo).count;

    // Sessions in last 7 days
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const sessionsLast7d = db.prepare(`
      SELECT COUNT(DISTINCT session_id) as count FROM session_chunks WHERE timestamp > ?
    `).get(sevenDaysAgo).count;

    // Completion rate
    const completionRate = totalSessions > 0 ? ((completedSessions / totalSessions) * 100).toFixed(1) : 0;

    res.json({
      total_campaigns: totalCampaigns,
      total_sessions: totalSessions,
      total_users: totalUsers,
      completed_sessions: completedSessions,
      dropped_sessions: droppedSessions,
      completion_rate: parseFloat(completionRate),
      sessions_last_24h: sessionsLast24h,
      sessions_last_7d: sessionsLast7d
    });
  } catch (err) {
    console.error("Error in GET /api/stats:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Serve Static Files -----
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
