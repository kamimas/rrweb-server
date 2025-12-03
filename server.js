// server.js
"use strict";
require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const AWS = require("aws-sdk");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");

// Import rrdom packages (for potential server‑side DOM processing)
const rrdom = require("rrdom");
const rrdomNodejs = require("rrdom-nodejs");

// ----- SQLite Database Setup -----
const Database = require("better-sqlite3");
const dbPath = path.join(__dirname, "db.sqlite");
const db = new Database(dbPath);

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
    local_key TEXT,
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

  CREATE INDEX IF NOT EXISTS idx_session_chunks_session_id ON session_chunks(session_id);
  CREATE INDEX IF NOT EXISTS idx_session_chunks_distinct_id ON session_chunks(distinct_id);
  CREATE INDEX IF NOT EXISTS idx_session_chunks_campaign_id ON session_chunks(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_aliases_user_id ON aliases(user_id);
  CREATE INDEX IF NOT EXISTS idx_campaigns_name ON campaigns(name);
`);

console.log("✅ SQLite database initialized at:", dbPath);

// Prepare statements for better performance
const insertCampaign = db.prepare(`
  INSERT INTO campaigns (name, created_at) VALUES (?, ?)
`);

const getCampaignByName = db.prepare(`
  SELECT id, name, created_at FROM campaigns WHERE name = ?
`);

const getCampaignById = db.prepare(`
  SELECT id, name, created_at FROM campaigns WHERE id = ?
`);

const getAllCampaigns = db.prepare(`
  SELECT c.id, c.name, c.created_at,
    (SELECT COUNT(DISTINCT sc.session_id) FROM session_chunks sc WHERE sc.campaign_id = c.id) as session_count
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
  INSERT OR IGNORE INTO session_chunks (session_id, distinct_id, campaign_id, s3_key, local_key, page_url, timestamp)
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

// Create local sessions directory for testing
const sessionsDir = path.join(__dirname, "public", "sessions");
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

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

// Create campaign
app.post("/api/campaigns", (req, res) => {
  try {
    const { name } = req.body;
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
    const result = insertCampaign.run(trimmedName, createdAt);

    console.log(`📋 Campaign created: ${trimmedName}`);
    res.status(201).json({
      id: result.lastInsertRowid,
      name: trimmedName,
      created_at: createdAt
    });
  } catch (err) {
    console.error("Error in POST /api/campaigns:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List campaigns
app.get("/api/campaigns", (req, res) => {
  try {
    const campaigns = getAllCampaigns.all();
    res.json({ campaigns });
  } catch (err) {
    console.error("Error in GET /api/campaigns:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get campaign by ID
app.get("/api/campaigns/:id", (req, res) => {
  try {
    const { id } = req.params;
    const campaign = getCampaignById.get(id);

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const sessionCount = getSessionCountByCampaignId.get(id);
    res.json({
      ...campaign,
      session_count: sessionCount?.count || 0
    });
  } catch (err) {
    console.error("Error in GET /api/campaigns/:id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete campaign (and all sessions)
app.delete("/api/campaigns/:id", (req, res) => {
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

// List sessions (by campaign or email)
app.get("/api/sessions", (req, res) => {
  try {
    const { campaign_id, campaign, email } = req.query;

    if (!campaign_id && !campaign && !email) {
      return res.status(400).json({ error: "Missing filter: campaign_id, campaign, or email required" });
    }

    let sessions = [];

    if (campaign_id || campaign) {
      // Get campaign ID
      let cid = campaign_id;
      if (campaign && !campaign_id) {
        const c = getCampaignByName.get(campaign);
        if (!c) {
          return res.status(404).json({ error: "Campaign not found" });
        }
        cid = c.id;
      }

      const query = `
        SELECT
          sc.session_id,
          sc.distinct_id,
          sc.campaign_id,
          c.name as campaign_name,
          MIN(sc.timestamp) as first_timestamp,
          MAX(sc.timestamp) as last_timestamp,
          (MAX(sc.timestamp) - MIN(sc.timestamp)) as duration_ms,
          COUNT(sc.id) as chunk_count
        FROM session_chunks sc
        LEFT JOIN campaigns c ON sc.campaign_id = c.id
        WHERE sc.campaign_id = ?
        GROUP BY sc.session_id
        ORDER BY first_timestamp DESC
      `;
      sessions = db.prepare(query).all(cid);
    } else if (email) {
      const query = `
        SELECT
          sc.session_id,
          sc.distinct_id,
          sc.campaign_id,
          c.name as campaign_name,
          MIN(sc.timestamp) as first_timestamp,
          MAX(sc.timestamp) as last_timestamp,
          (MAX(sc.timestamp) - MIN(sc.timestamp)) as duration_ms,
          COUNT(sc.id) as chunk_count
        FROM session_chunks sc
        LEFT JOIN campaigns c ON sc.campaign_id = c.id
        JOIN aliases a ON sc.distinct_id = a.distinct_id
        JOIN users u ON a.user_id = u.id
        WHERE u.email = ?
        GROUP BY sc.session_id
        ORDER BY first_timestamp DESC
      `;
      sessions = db.prepare(query).all(email);
    }

    // Add playback_url to each session
    const transformedSessions = sessions.map(session => ({
      ...session,
      playback_url: `/api/sessions/${session.session_id}/playback`
    }));

    res.json({ sessions: transformedSessions });
  } catch (err) {
    console.error("Error in GET /api/sessions:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get session playback data (merged events from all chunks)
app.get("/api/sessions/:session_id/playback", (req, res) => {
  try {
    const { session_id } = req.params;

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

    // Merge events from all chunk files
    let allEvents = [];
    const pageUrls = [];

    for (const chunk of chunks) {
      // Try local file first
      if (chunk.local_key) {
        const localPath = path.join(sessionsDir, chunk.local_key);
        if (fs.existsSync(localPath)) {
          try {
            const data = JSON.parse(fs.readFileSync(localPath, "utf8"));
            if (data.events && Array.isArray(data.events)) {
              allEvents = allEvents.concat(data.events);
            }
            if (data.pageUrl && !pageUrls.includes(data.pageUrl)) {
              pageUrls.push(data.pageUrl);
            }
          } catch (readErr) {
            console.error(`Error reading chunk file ${chunk.local_key}:`, readErr);
          }
        }
      }
    }

    // Sort events by timestamp
    allEvents.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const firstChunk = chunks[0];
    const lastChunk = chunks[chunks.length - 1];

    res.json({
      session_id,
      events: allEvents,
      metadata: {
        campaign_id: firstChunk.campaign_id,
        campaign_name: firstChunk.campaign_name,
        distinct_id: firstChunk.distinct_id,
        duration_ms: lastChunk.timestamp - firstChunk.timestamp,
        page_urls: pageUrls,
        chunk_count: chunks.length
      }
    });
  } catch (err) {
    console.error("Error in GET /api/sessions/:session_id/playback:", err);
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

    // Save session data
    const fileName = `sessions/${sessionId}_${Date.now()}_${uuidv4()}.json`;
    const sessionData = JSON.stringify({
      sessionId,
      events,
      pageUrl,
      host: verifiedDomain,
      timestamp,
      campaign: campaign
    });

    // Save locally
    const localFileName = `${sessionId}_${Date.now()}_${uuidv4()}.json`;
    const localFilePath = path.join(sessionsDir, localFileName);

    try {
      fs.writeFileSync(localFilePath, sessionData);
      console.log(`✅ Session saved locally: ${localFileName}`);
      console.log(`📋 Campaign: ${campaign}`);
      console.log(`📊 Events captured: ${events.length}`);
      console.log(`🌐 Page URL: ${pageUrl}`);
    } catch (writeErr) {
      console.error("Error saving session locally:", writeErr);
    }

    // Write to SQLite
    try {
      insertSessionChunk.run(
        sessionId,
        distinctId,
        campaignRecord.id,
        fileName,
        localFileName,
        pageUrl,
        timestamp
      );
      console.log(`📇 Indexed session chunk: ${sessionId} -> campaign:${campaign}`);
    } catch (dbErr) {
      console.error("Error writing to index database:", dbErr);
    }

    // Upload to S3
    const params = {
      Bucket: bucketName,
      Key: fileName,
      Body: sessionData,
      ContentType: "application/json"
    };

    s3.upload(params, (err, data) => {
      if (err) {
        console.error("Error uploading to S3:", err);
        return res.json({
          success: true,
          localOnly: true,
          message: "Session saved locally (S3 upload failed)"
        });
      }
      console.log(`☁️  Uploaded to S3: ${fileName}`);
      res.json({ success: true });
    });
  } catch (err) {
    console.error("Error in /upload-session:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =====================================================
// IDENTIFY ENDPOINT
// =====================================================

app.post("/identify", (req, res) => {
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

// ----- Serve Static Files -----
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
