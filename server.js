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

// Import rrdom packages (for potential server‑side DOM processing)
const rrdom = require("rrdom");
const rrdomNodejs = require("rrdom-nodejs");

// ----- SQLite Database Setup -----
const Database = require("better-sqlite3");
const dbPath = path.join(__dirname, "db.sqlite");
const db = new Database(dbPath);

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS session_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    distinct_id TEXT NOT NULL,
    s3_key TEXT UNIQUE NOT NULL,
    timestamp INTEGER NOT NULL
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
  CREATE INDEX IF NOT EXISTS idx_aliases_user_id ON aliases(user_id);
`);

console.log("✅ SQLite database initialized at:", dbPath);

// Prepare statements for better performance
const insertSessionChunk = db.prepare(`
  INSERT OR IGNORE INTO session_chunks (session_id, distinct_id, s3_key, timestamp)
  VALUES (?, ?, ?, ?)
`);

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (email)
  VALUES (?)
`);

const getUserByEmail = db.prepare(`
  SELECT id FROM users WHERE email = ?
`);

const insertAlias = db.prepare(`
  INSERT OR REPLACE INTO aliases (distinct_id, user_id)
  VALUES (?, ?)
`);

// Create local sessions directory for testing
const sessionsDir = path.join(__dirname, "public", "sessions");
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

const app = express();

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
app.use(express.json({ limit: "1mb" })); // Limit payload size

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // Limit each IP to 60 requests per minute
});
app.use(limiter);

// ----- Configuration Endpoint -----
// Clients can query this endpoint to know if console plugins should be enabled.
app.get("/config", (req, res) => {
  res.json({
    enableConsolePlugin: process.env.ENABLE_CONSOLE_PLUGIN === "true"
  });
});

// ----- Allowed Domains Configuration -----
// ALLOWED_DOMAINS is a JSON string from the .env file mapping allowed domains
// to their respective S3 buckets and pre‑shared tokens.
let allowedDomains = {};
try {
  allowedDomains = JSON.parse(process.env.ALLOWED_DOMAINS);
} catch (err) {
  console.error("Error parsing ALLOWED_DOMAINS environment variable:", err);
  process.exit(1);
}

// ----- AWS Configuration -----
AWS.config.update({
  region: process.env.AWS_REGION // e.g. "us-east-1"
  // AWS credentials are picked up from environment variables or IAM roles.
});
const s3 = new AWS.S3();

// ----- Endpoint: /upload-session -----
// Receives session data from the recorder and uploads it to S3.
app.post("/upload-session", (req, res) => {
  try {
    const { sessionId, events, pageUrl, host, timestamp, domainToken, distinctId } = req.body;
    if (!sessionId || !Array.isArray(events) || events.length === 0 || !pageUrl || !host || !domainToken || !distinctId) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    // ----- Domain Verification (Backend) -----
    if (!(allowedDomains[host] && allowedDomains[host].token === domainToken)) {
      return res.status(403).json({ error: "Domain not allowed or token invalid" });
    }
    const verifiedDomain = host; // Verified

    // Determine the correct S3 bucket for this domain.
    const bucketName = allowedDomains[verifiedDomain].bucket;
    if (!bucketName) {
      return res.status(500).json({ error: "S3 bucket not configured for domain" });
    }

    // ----- Save Session Data Locally (for testing) -----
    const fileName = `sessions/${sessionId}_${Date.now()}_${uuidv4()}.json`;
    const sessionData = JSON.stringify({ sessionId, events, pageUrl, host: verifiedDomain, timestamp }, null, 2);

    // Save locally in public/sessions directory
    const localFileName = `${sessionId}_${Date.now()}_${uuidv4()}.json`;
    const localFilePath = path.join(sessionsDir, localFileName);

    try {
      fs.writeFileSync(localFilePath, sessionData);
      console.log(`✅ Session saved locally: ${localFileName}`);
      console.log(`📊 Events captured: ${events.length}`);
      console.log(`🌐 Page URL: ${pageUrl}`);
      console.log(`🔗 Local playback URL: http://localhost:${process.env.PORT || 3000}/sessions/${localFileName}`);
    } catch (writeErr) {
      console.error("Error saving session locally:", writeErr);
    }

    // ----- Write to SQLite Index Database -----
    try {
      insertSessionChunk.run(sessionId, distinctId, fileName, timestamp);
      console.log(`📇 Indexed session chunk: ${sessionId} -> ${distinctId}`);
    } catch (dbErr) {
      console.error("Error writing to index database:", dbErr);
      // Continue with S3 upload even if indexing fails
    }

    // ----- Upload Session Data to S3 -----
    const params = {
      Bucket: bucketName,
      Key: fileName,
      Body: sessionData,
      ContentType: "application/json"
    };

    s3.upload(params, (err, data) => {
      if (err) {
        console.error("Error uploading to S3:", err);
        // Still return success if local save worked
        const localUrl = `http://localhost:${process.env.PORT || 3000}/sessions/${localFileName}`;
        return res.json({
          url: localUrl,
          localOnly: true,
          message: "Session saved locally (S3 upload failed)"
        });
      }
      // Generate a signed URL (expires in 1 hour) for secure playback.
      const signedUrl = s3.getSignedUrl("getObject", {
        Bucket: bucketName,
        Key: fileName,
        Expires: 3600
      });
      const localUrl = `http://localhost:${process.env.PORT || 3000}/sessions/${localFileName}`;
      console.log(`☁️  S3 URL: ${signedUrl}`);
      res.json({
        url: signedUrl,
        localUrl: localUrl
      });
    });
  } catch (err) {
    console.error("Error in /upload-session:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Endpoint: /identify -----
// Links a distinct_id to an email address for session retrieval.
app.post("/identify", (req, res) => {
  try {
    const { email, distinctId } = req.body;
    if (!email || !distinctId) {
      return res.status(400).json({ error: "Missing email or distinctId" });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Insert user (ignore if already exists)
    insertUser.run(email);

    // Get user ID
    const user = getUserByEmail.get(email);
    if (!user) {
      return res.status(500).json({ error: "Failed to retrieve user ID" });
    }

    // Link distinct_id to user_id
    insertAlias.run(distinctId, user.id);

    console.log(`🔗 Identity linked: ${distinctId} -> ${email}`);
    res.json({ success: true, message: "Identity linked successfully" });
  } catch (err) {
    console.error("Error in /identify:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Endpoint: /api/sessions -----
// Retrieves sessions for a given email address (grouped by session_id).
app.get("/api/sessions", (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "Missing email parameter" });
    }

    // Query sessions with JOIN
    const query = `
      SELECT
        sc.session_id,
        sc.distinct_id,
        GROUP_CONCAT(sc.s3_key, '|') as s3_keys,
        MIN(sc.timestamp) as first_timestamp,
        MAX(sc.timestamp) as last_timestamp,
        COUNT(sc.id) as chunk_count
      FROM session_chunks sc
      JOIN aliases a ON sc.distinct_id = a.distinct_id
      JOIN users u ON a.user_id = u.id
      WHERE u.email = ?
      GROUP BY sc.session_id
      ORDER BY first_timestamp DESC
    `;

    const sessions = db.prepare(query).all(email);

    // Transform s3_keys from pipe-delimited string to array
    const transformedSessions = sessions.map(session => ({
      ...session,
      s3_keys: session.s3_keys.split('|')
    }));

    console.log(`🔍 Found ${transformedSessions.length} sessions for ${email}`);
    res.json({ sessions: transformedSessions });
  } catch (err) {
    console.error("Error in /api/sessions:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Serve Static Files (e.g. Recorder & Playback Pages) -----
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
