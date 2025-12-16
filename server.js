// server.js - v2.0.0 (PostgreSQL)
"use strict";
require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const AWS = require("aws-sdk");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const zlib = require("zlib");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const NodeCache = require("node-cache");
const db = require("./src/db");
const queue = require("./src/queue-manager");
const aiAnalyst = require("./src/ai-analyst");
const s3Helpers = require("./src/s3-helpers");
const { generateTimeline } = require("./timeline-react-aware");

// ----- Session Playback Cache -----
// TTL: 10 minutes, check for expired keys every 2 minutes
// maxKeys: 5000 allows caching many concurrent sessions without hitting limits
const sessionCache = new NodeCache({
  stdTTL: 600,
  checkperiod: 120,
  maxKeys: 5000,
  useClones: false  // Don't clone on get (faster, we're read-only)
});

// ----- Auth Configuration -----
// SECURITY: JWT_SECRET must be set via environment variable - no fallback allowed
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("❌ FATAL: JWT_SECRET environment variable is not defined.");
  console.error("   Generate one with: openssl rand -hex 32");
  process.exit(1);
}
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

// ----- PostgreSQL Database -----
// Database connection is managed by src/db.js
// All queries are ASYNC - always use await!
console.log("✅ Using PostgreSQL database");
// Schema is managed via docs/schema.sql - run it on your PostgreSQL instance
// All queries are now async - use await db.query() or db.queryOne()

const app = express();

// ----- CORS Middleware -----
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Public API routes (autopilot) - allow any origin
  if (req.path.startsWith('/api/projects/')) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    return next();
  }

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

// ----- Autopilot Config Endpoint (for SDK manifest) -----
// CORS preflight for this route
app.options("/api/projects/:token/config", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(200);
});

app.get("/api/projects/:token/config", async (req, res) => {
  // CORS: Allow any origin since SDK runs on client websites
  res.header("Access-Control-Allow-Origin", "*");

  const { token } = req.params;

  // Validate token against any configured domain
  const isValidToken = Object.values(allowedDomains).some(d => d.token === token);
  if (!isValidToken) {
    return res.status(403).json({ error: "Invalid token" });
  }

  try {
    // Get all ACTIVE rules joined with campaign names (SDK only uses published rules)
    const { rows: rules } = await db.query(`
      SELECT
        cr.id,
        cr.campaign_id,
        cr.trigger_type,
        cr.selector,
        cr.action_type,
        c.name as campaign_name,
        cr.step_key,
        cr.timeout_ms,
        cr.completion_status
      FROM campaign_rules cr
      JOIN campaigns c ON cr.campaign_id = c.id
      WHERE cr.is_active = TRUE
      ORDER BY c.id, cr.id
    `);

    res.json({ rules });
  } catch (err) {
    console.error("Error in GET /api/projects/:token/config:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Save Rule Endpoint (for Visual Editor) -----
// CORS preflight
app.options("/api/projects/:token/rules", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(200);
});

app.post("/api/projects/:token/rules", async (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");

  const { token } = req.params;

  // Validate token
  const isValidToken = Object.values(allowedDomains).some(d => d.token === token);
  if (!isValidToken) {
    return res.status(403).json({ error: "Invalid token" });
  }

  try {
    const { campaign_id, trigger_type, selector, action_type, step_key, timeout_ms, completion_status } = req.body;

    // Validate required fields
    if (!campaign_id || !trigger_type || !selector || !action_type) {
      return res.status(400).json({ error: "Missing required fields: campaign_id, trigger_type, selector, action_type" });
    }

    // Validate trigger_type
    const validTriggers = ["CLICK_ELEMENT", "URL_CONTAINS"];
    if (!validTriggers.includes(trigger_type)) {
      return res.status(400).json({ error: "Invalid trigger_type. Must be: " + validTriggers.join(", ") });
    }

    // Validate action_type
    const validActions = ["START_RECORDING", "STOP_RECORDING", "LOG_STEP"];
    if (!validActions.includes(action_type)) {
      return res.status(400).json({ error: "Invalid action_type. Must be: " + validActions.join(", ") });
    }

    // Validate step_key is provided for LOG_STEP
    if (action_type === "LOG_STEP" && !step_key) {
      return res.status(400).json({ error: "step_key is required when action_type is LOG_STEP" });
    }

    // Validate completion_status if provided
    if (completion_status && !['completed', 'dropped_off'].includes(completion_status)) {
      return res.status(400).json({ error: "completion_status must be 'completed' or 'dropped_off'" });
    }

    // Verify campaign exists
    const campaign = await db.queryOne("SELECT id FROM campaigns WHERE id = $1", [campaign_id]);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Insert rule
    const result = await db.insert(`
      INSERT INTO campaign_rules (campaign_id, trigger_type, selector, action_type, step_key, timeout_ms, completion_status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [campaign_id, trigger_type, selector, action_type, step_key || null, timeout_ms || null, completion_status || null, Date.now()]);

    console.log(`🤖 Rule created: ${action_type} on ${selector} for campaign ${campaign_id}`);

    // Write-time sync: Add LOG_STEP rules to funnel_config
    if (action_type === 'LOG_STEP' && step_key) {
      const campaignData = await db.queryOne("SELECT funnel_config FROM campaigns WHERE id = $1", [campaign_id]);
      let config = [];

      // Parse existing funnel_config
      if (campaignData && campaignData.funnel_config) {
        try {
          config = JSON.parse(campaignData.funnel_config);
          if (!Array.isArray(config)) config = [];
        } catch (e) {
          config = [];
        }
      }

      // Check if step already exists
      const exists = config.find(step => step.key === step_key);
      if (!exists) {
        config.push({ name: step_key, key: step_key });
        await db.query("UPDATE campaigns SET funnel_config = $1 WHERE id = $2",
          [JSON.stringify(config), campaign_id]);
        console.log(`📊 Synced step "${step_key}" to funnel_config for campaign ${campaign_id}`);
      }
    }

    res.status(201).json({
      id: result.id,
      campaign_id,
      trigger_type,
      selector,
      action_type,
      step_key: step_key || null,
      timeout_ms: timeout_ms || null,
      completion_status: completion_status || null
    });
  } catch (err) {
    console.error("Error in POST /api/projects/:token/rules:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Publish Rules Endpoint (Activate all draft rules for a campaign) -----
app.post("/api/projects/:token/campaigns/:campaign_id/publish", async (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");

  const { token, campaign_id } = req.params;

  // Validate token
  const isValidToken = Object.values(allowedDomains).some(d => d.token === token);
  if (!isValidToken) {
    return res.status(403).json({ error: "Invalid token" });
  }

  try {
    // Activate all draft rules for this campaign
    const result = await db.query(`
      UPDATE campaign_rules
      SET is_active = TRUE
      WHERE campaign_id = $1 AND is_active = FALSE
    `, [campaign_id]);

    console.log(`📢 Published ${result.rowCount} rules for campaign ${campaign_id}`);

    res.json({
      success: true,
      published_count: result.rowCount
    });
  } catch (err) {
    console.error("Error in POST /api/projects/:token/campaigns/:campaign_id/publish:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// CORS preflight for publish endpoint
app.options("/api/projects/:token/campaigns/:campaign_id/publish", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "POST");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(200);
});

// ----- Get ALL Rules for Visual Editor (including drafts) -----
app.get("/api/projects/:token/campaigns/:campaign_id/rules", async (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");

  const { token, campaign_id } = req.params;

  // Validate token
  const isValidToken = Object.values(allowedDomains).some(d => d.token === token);
  if (!isValidToken) {
    return res.status(403).json({ error: "Invalid token" });
  }

  try {
    // Get ALL rules (both active and drafts) for visual editor display
    const { rows: rules } = await db.query(`
      SELECT
        cr.id,
        cr.campaign_id,
        cr.trigger_type,
        cr.selector,
        cr.action_type,
        cr.step_key,
        cr.timeout_ms,
        cr.completion_status,
        cr.is_active
      FROM campaign_rules cr
      WHERE cr.campaign_id = $1
      ORDER BY cr.id
    `, [campaign_id]);

    res.json({ rules });
  } catch (err) {
    console.error("Error in GET /api/projects/:token/campaigns/:campaign_id/rules:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Delete Rule Endpoint (for Visual Editor) -----
app.delete("/api/projects/:token/rules/:rule_id", async (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");

  const { token, rule_id } = req.params;

  // Validate token
  const isValidToken = Object.values(allowedDomains).some(d => d.token === token);
  if (!isValidToken) {
    return res.status(403).json({ error: "Invalid token" });
  }

  try {
    const result = await db.query('DELETE FROM campaign_rules WHERE id = $1', [rule_id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Rule not found" });
    }

    console.log(`🗑️  Rule deleted: ${rule_id}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Error in DELETE /api/projects/:token/rules/:rule_id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// CORS preflight for delete rule
app.options("/api/projects/:token/rules/:rule_id", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Max-Age", "86400"); // Cache preflight for 24h
  res.sendStatus(204);
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

// AWS SDK v3 Client (for presigned URLs - more efficient)
const s3Client = new S3Client({
  region: process.env.AWS_REGION
});

// =====================================================
// CAMPAIGN ENDPOINTS
// =====================================================

// Create campaign (auth required)
app.post("/api/campaigns", authenticateJWT, async (req, res) => {
  try {
    const { name, mission_brief, funnel_config } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Missing or invalid campaign name" });
    }

    const trimmedName = name.trim();

    // Check if campaign already exists
    const existing = await db.queryOne(
      'SELECT id, name, created_at FROM campaigns WHERE name = $1',
      [trimmedName]
    );
    if (existing) {
      return res.status(409).json({ error: "Campaign name already exists" });
    }

    // Stringify funnel_config if provided
    const funnelConfigStr = funnel_config ? JSON.stringify(funnel_config) : null;

    const createdAt = Date.now();
    const result = await db.insert(
      `INSERT INTO campaigns (name, created_at, mission_brief, funnel_config)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [trimmedName, createdAt, mission_brief || null, funnelConfigStr]
    );

    console.log(`📋 Campaign created: ${trimmedName}`);
    res.status(201).json({
      id: result.id,
      name: trimmedName,
      created_at: createdAt,
      mission_brief: mission_brief || null,
      funnel_config: funnel_config || null
    });
  } catch (err) {
    console.error("Error in POST /api/campaigns:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List campaigns (auth required)
app.get("/api/campaigns", authenticateJWT, async (req, res) => {
  try {
    const { rows: campaigns } = await db.query(`
      SELECT c.id, c.name, c.created_at, c.is_paused,
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
    res.json({ campaigns });
  } catch (err) {
    console.error("Error in GET /api/campaigns:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Validate campaign exists (public - used by recorder to check before resuming)
// Returns 200 if campaign exists and is active, 404 if not found, 410 if paused
app.get("/api/campaigns/validate", async (req, res) => {
  try {
    const { name } = req.query;

    if (!name) {
      return res.status(400).json({ error: "Campaign name required" });
    }

    const campaign = await db.queryOne(
      "SELECT id, name, is_paused FROM campaigns WHERE name = $1",
      [name]
    );

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found", exists: false });
    }

    if (campaign.is_paused) {
      return res.status(410).json({ error: "Campaign is paused", exists: true, paused: true });
    }

    res.json({ exists: true, campaignId: campaign.id, name: campaign.name });
  } catch (err) {
    console.error("Error in GET /api/campaigns/validate:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get campaign by ID (auth required)
app.get("/api/campaigns/:id", authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const campaign = await db.queryOne(`
      SELECT id, name, created_at, mission_brief, funnel_config, generated_rubric, ai_report, ai_analysis_status, is_paused
      FROM campaigns WHERE id = $1
    `, [id]);

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const sessionCount = await db.queryOne(
      'SELECT COUNT(DISTINCT session_id) as count FROM session_chunks WHERE campaign_id = $1',
      [id]
    );
    const completedCount = await db.queryOne(`
      SELECT COUNT(DISTINCT sc.session_id) as count
      FROM session_chunks sc
      LEFT JOIN sessions s ON sc.session_id = s.session_id
      WHERE sc.campaign_id = $1 AND s.status = 'completed'
    `, [id]);
    const droppedOffCount = await db.queryOne(`
      SELECT COUNT(DISTINCT sc.session_id) as count
      FROM session_chunks sc
      LEFT JOIN sessions s ON sc.session_id = s.session_id
      WHERE sc.campaign_id = $1 AND (s.status IS NULL OR s.status = 'dropped_off')
    `, [id]);

    // Sync funnel_config with campaign_rules (LOG_STEP actions)
    const { rows: logStepRules } = await db.query(`
      SELECT step_key, created_at
      FROM campaign_rules
      WHERE campaign_id = $1 AND action_type = 'LOG_STEP' AND step_key IS NOT NULL
      ORDER BY created_at ASC
    `, [id]);

    // Build funnel_config from rules
    let funnelConfig = campaign.funnel_config ? JSON.parse(campaign.funnel_config) : [];

    if (logStepRules.length > 0) {
      const ruleSteps = logStepRules.map(rule => ({
        name: rule.step_key,
        key: rule.step_key
      }));
      const existingKeys = new Set(funnelConfig.map(step => step.key));
      ruleSteps.forEach(step => {
        if (!existingKeys.has(step.key)) {
          funnelConfig.push(step);
          existingKeys.add(step.key);
        }
      });
    }

    // Get all rules for this campaign (for admin UI)
    const { rows: rules } = await db.query(`
      SELECT id, trigger_type, selector, action_type, step_key, timeout_ms, completion_status, is_active, created_at
      FROM campaign_rules
      WHERE campaign_id = $1
      ORDER BY created_at ASC
    `, [id]);

    res.json({
      ...campaign,
      funnel_config: funnelConfig.length > 0 ? funnelConfig : null,
      generated_rubric: campaign.generated_rubric ? JSON.parse(campaign.generated_rubric) : null,
      session_count: sessionCount?.count || 0,
      completed_count: completedCount?.count || 0,
      dropped_off_count: droppedOffCount?.count || 0,
      rules: rules || []
    });
  } catch (err) {
    console.error("Error in GET /api/campaigns/:id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update campaign (auth required)
app.put("/api/campaigns/:id", authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, mission_brief, funnel_config } = req.body;

    const campaign = await db.queryOne(`
      SELECT id, name, created_at, mission_brief, funnel_config FROM campaigns WHERE id = $1
    `, [id]);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Handle name update
    let trimmedName = campaign.name;
    if (name && typeof name === "string" && name.trim().length > 0) {
      trimmedName = name.trim();
      const existing = await db.queryOne(
        'SELECT id, name FROM campaigns WHERE name = $1',
        [trimmedName]
      );
      if (existing && existing.id !== parseInt(id)) {
        return res.status(409).json({ error: "Campaign name already exists" });
      }
    }

    let newMissionBrief = campaign.mission_brief;
    if (mission_brief !== undefined) {
      newMissionBrief = mission_brief || null;
    }

    let newFunnelConfig = campaign.funnel_config;
    if (funnel_config !== undefined) {
      newFunnelConfig = funnel_config ? JSON.stringify(funnel_config) : null;
    }

    await db.query(`
      UPDATE campaigns SET name = $1, mission_brief = $2, funnel_config = $3 WHERE id = $4
    `, [trimmedName, newMissionBrief, newFunnelConfig, id]);

    console.log(`📝 Campaign updated: ${campaign.name} -> ${trimmedName}`);
    res.json({
      id: parseInt(id),
      name: trimmedName,
      created_at: campaign.created_at,
      mission_brief: newMissionBrief,
      funnel_config: newFunnelConfig ? JSON.parse(newFunnelConfig) : null
    });
  } catch (err) {
    console.error("Error in PUT /api/campaigns/:id:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Pause/unpause a campaign (auth required)
app.patch("/api/campaigns/:id/pause", authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_paused } = req.body;

    if (typeof is_paused !== "boolean") {
      return res.status(400).json({ error: "is_paused must be a boolean" });
    }

    const campaign = await db.queryOne(`SELECT id, name FROM campaigns WHERE id = $1`, [id]);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    await db.query(`UPDATE campaigns SET is_paused = $1 WHERE id = $2`, [is_paused, id]);

    console.log(`${is_paused ? "⏸️" : "▶️"} Campaign ${is_paused ? "paused" : "resumed"}: ${campaign.name}`);
    res.json({ id: parseInt(id), is_paused });
  } catch (err) {
    console.error("Error in PATCH /api/campaigns/:id/pause:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get funnel analytics for a campaign (auth required)
app.get("/api/campaigns/:id/funnel-stats", authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.query;

    // Validate status if provided
    if (status && !["completed", "dropped_off"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'completed' or 'dropped_off'" });
    }

    // Get campaign with funnel config
    const campaign = await db.queryOne(`
      SELECT id, name, funnel_config FROM campaigns WHERE id = $1
    `, [id]);

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    if (!campaign.funnel_config) {
      return res.json({ steps: [], total_sessions: 0, status: status || null });
    }

    const funnelConfig = JSON.parse(campaign.funnel_config);

    // Build status filter clause
    let statusFilter = "";
    if (status === "dropped_off") {
      statusFilter = "AND (s.status IS NULL OR s.status = 'dropped_off')";
    } else if (status === "completed") {
      statusFilter = "AND s.status = 'completed'";
    }

    // Get total sessions for this campaign (with optional status filter)
    const totalResult = await db.queryOne(`
      SELECT COUNT(DISTINCT sc.session_id) as count
      FROM session_chunks sc
      LEFT JOIN sessions s ON sc.session_id = s.session_id
      WHERE sc.campaign_id = $1 ${statusFilter}
    `, [id]);
    const totalSessions = parseInt(totalResult?.count || 0);

    // Get step counts from session_steps (with optional status filter)
    const { rows: stepCounts } = await db.query(`
      SELECT ss.step_key, COUNT(DISTINCT ss.session_id) as reached
      FROM session_steps ss
      LEFT JOIN sessions s ON ss.session_id = s.session_id
      WHERE ss.session_id IN (
        SELECT DISTINCT session_id FROM session_chunks WHERE campaign_id = $1
      ) ${statusFilter}
      GROUP BY ss.step_key
    `, [id]);

    // Build step count map
    const countMap = {};
    stepCounts.forEach(row => {
      countMap[row.step_key] = parseInt(row.reached);
    });

    // Build response with all steps from funnel_config
    const steps = funnelConfig.map((step, index) => {
      const reached = countMap[step.key] || 0;
      return {
        key: step.key,
        name: step.name,
        index,
        reached,
        percentage: totalSessions > 0 ? Math.round((reached / totalSessions) * 100) : 0
      };
    });

    res.json({
      campaign_id: parseInt(id),
      campaign_name: campaign.name,
      total_sessions: totalSessions,
      status: status || null,
      steps
    });
  } catch (err) {
    console.error("Error in GET /api/campaigns/:id/funnel-stats:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete campaign (auth required)
app.delete("/api/campaigns/:id", authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const campaign = await db.queryOne(
      'SELECT id, name, created_at FROM campaigns WHERE id = $1',
      [id]
    );

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const sessionCount = await db.queryOne(
      'SELECT COUNT(DISTINCT session_id) as count FROM session_chunks WHERE campaign_id = $1',
      [id]
    );

    // Delete session chunks first (foreign key)
    await db.query('DELETE FROM session_chunks WHERE campaign_id = $1', [id]);

    // Delete campaign
    await db.query('DELETE FROM campaigns WHERE id = $1', [id]);

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

// ----- Direct Upload: Get Presigned URL -----
// Client requests a presigned URL, then uploads directly to S3
// This keeps heavy payloads off the Node.js server
app.post("/api/sessions/:sessionId/upload-url", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { chunkTimestamp, campaign, distinctId, pageUrl, host, domainToken, sequenceId } = req.body;

    // Validate required fields
    if (!sessionId || !chunkTimestamp || !campaign || !distinctId || !host || !domainToken) {
      return res.status(400).json({
        error: "Missing required fields: sessionId, chunkTimestamp, campaign, distinctId, host, domainToken"
      });
    }

    // Parse sequence ID (optional for backward compatibility)
    const seqId = (sequenceId !== undefined && sequenceId !== null) ? parseInt(sequenceId, 10) : null;

    // Validate domain token
    if (!allowedDomains[host] || allowedDomains[host].token !== domainToken) {
      return res.status(403).json({ error: "Invalid domain or token" });
    }

    // Get bucket for this domain
    const bucketName = allowedDomains[host].bucket;
    if (!bucketName) {
      return res.status(500).json({ error: "S3 bucket not configured for domain" });
    }

    // Validate campaign exists
    const campaignRecord = await db.queryOne("SELECT id, name FROM campaigns WHERE name = $1", [campaign]);
    if (!campaignRecord) {
      return res.status(404).json({ error: `Campaign not found: ${campaign}` });
    }

    // Generate unique S3 key for this chunk
    // Format: recordings/{campaignId}/{sessionId}/{timestamp}_{uuid}.json.gz
    const randomSuffix = uuidv4().substring(0, 8);
    const s3Key = `recordings/${campaignRecord.id}/${sessionId}/${chunkTimestamp}_${randomSuffix}.json.gz`;

    // Generate presigned PUT URL (60 second expiry)
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      ContentType: "application/gzip"
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 });

    // NOTE: DB insert is now deferred to /confirm-chunk endpoint
    // This prevents "phantom chunks" where DB has record but S3 upload failed

    console.log(`🎫 Presigned URL issued: ${sessionId} -> s3://${bucketName}/${s3Key} (seq: ${seqId})`);

    res.json({
      uploadUrl,
      s3Key,
      s3Bucket: bucketName,
      campaignId: campaignRecord.id,
      expiresIn: 60
    });
  } catch (err) {
    console.error("Error in POST /api/sessions/:sessionId/upload-url:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Confirm Chunk: Called after successful S3 upload -----
// This ensures DB only has records for chunks that actually exist in S3
// Eliminates "phantom chunks" that cause playback failures
app.post("/api/sessions/:sessionId/confirm-chunk", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { s3Key, s3Bucket, campaignId, chunkTimestamp, distinctId, pageUrl, sequenceId, host, domainToken } = req.body;

    // Validate required fields
    if (!sessionId || !s3Key || !s3Bucket || !campaignId || !chunkTimestamp || !distinctId || !host || !domainToken) {
      return res.status(400).json({
        error: "Missing required fields: sessionId, s3Key, s3Bucket, campaignId, chunkTimestamp, distinctId, host, domainToken"
      });
    }

    // Validate domain token
    if (!allowedDomains[host] || allowedDomains[host].token !== domainToken) {
      return res.status(403).json({ error: "Invalid domain or token" });
    }

    const seqId = (sequenceId !== undefined && sequenceId !== null) ? parseInt(sequenceId, 10) : null;

    // CRITICAL: Verify the file actually exists in S3 before recording in DB
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: s3Key }));
    } catch (headErr) {
      if (headErr.name === 'NotFound' || headErr.$metadata?.httpStatusCode === 404) {
        console.error(`❌ Chunk confirmation failed - S3 object not found: ${s3Key}`);
        return res.status(400).json({ error: "S3 object not found - upload may have failed" });
      }
      throw headErr; // Re-throw other errors
    }

    // S3 object exists - safe to insert into DB
    await db.query(`
      INSERT INTO session_chunks (session_id, distinct_id, campaign_id, s3_key, s3_bucket, page_url, timestamp, sequence_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING
    `, [sessionId, distinctId, campaignId, s3Key, s3Bucket, pageUrl || null, chunkTimestamp, seqId]);

    console.log(`✅ Chunk confirmed: ${sessionId} -> s3://${s3Bucket}/${s3Key} (seq: ${seqId})`);

    res.json({ success: true });
  } catch (err) {
    console.error("Error in POST /api/sessions/:sessionId/confirm-chunk:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----- Final Flush: Lightweight endpoint for tab close -----
// Uses sendBeacon - accepts plain JSON, no gzip (small final chunks only)
// This is the ONLY endpoint that touches event data on the server (for reliability on tab close)
// Sequence ID passed via query string: /flush?seq=10 (since sendBeacon can't send custom JSON with Blob)
app.post("/api/sessions/:sessionId/flush", async (req, res) => {
  try {
    const { sessionId } = req.params;

    // Parse sequence ID from query string (fallback to high number for legacy clients)
    const seqId = req.query.seq !== undefined ? parseInt(req.query.seq, 10) : null;

    // sendBeacon sends as text/plain or application/json
    // Parse body if it's a string (sendBeacon with Blob)
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON" });
      }
    }
    // Handle raw buffer from text/plain
    if (Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(body.toString('utf8'));
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON" });
      }
    }

    const { events, campaign, distinctId, pageUrl, host, domainToken, timestamp } = body;

    // Validate required fields
    if (!sessionId || !events || !Array.isArray(events) || !campaign || !distinctId || !host || !domainToken) {
      console.log(`🚨 Flush validation failed for ${sessionId}`);
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Validate domain token
    if (!allowedDomains[host] || allowedDomains[host].token !== domainToken) {
      return res.status(403).json({ error: "Invalid domain or token" });
    }

    const bucketName = allowedDomains[host].bucket;
    if (!bucketName) {
      return res.status(500).json({ error: "S3 bucket not configured" });
    }

    // Validate campaign
    const campaignRecord = await db.queryOne("SELECT id, name FROM campaigns WHERE name = $1", [campaign]);
    if (!campaignRecord) {
      return res.status(404).json({ error: `Campaign not found: ${campaign}` });
    }

    // Generate S3 key for final flush chunk
    const chunkTimestamp = timestamp || Date.now();
    const randomSuffix = uuidv4().substring(0, 8);
    const s3Key = `recordings/${campaignRecord.id}/${sessionId}/${chunkTimestamp}_flush_${randomSuffix}.json`;

    // Prepare data (plain JSON, no gzip - keep it simple for final flush)
    const sessionData = JSON.stringify({
      sessionId,
      events,
      pageUrl,
      timestamp: chunkTimestamp,
      isFinalFlush: true
    });

    console.log(`🚪 Final flush received: ${sessionId} (${events.length} events, seq: ${seqId})`);

    // CRITICAL FIX: Await both S3 upload and DB insert before responding
    // This ensures data is persisted even if the process is killed after response
    try {
      // First upload to S3
      await s3.upload({
        Bucket: bucketName,
        Key: s3Key,
        Body: sessionData,
        ContentType: "application/json"
      }).promise();

      // Only insert to DB after S3 confirms (prevents phantom chunks)
      await db.query(`
        INSERT INTO session_chunks (session_id, distinct_id, campaign_id, s3_key, s3_bucket, page_url, timestamp, sequence_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING
      `, [sessionId, distinctId, campaignRecord.id, s3Key, bucketName, pageUrl || null, chunkTimestamp, seqId]);

      console.log(`🚪 Final flush uploaded: ${sessionId} (${events.length} events)`);
      res.status(200).json({ accepted: true, persisted: true });
    } catch (flushErr) {
      console.error(`🚨 Final flush failed for ${sessionId}:`, flushErr.message);
      // Return error so client knows flush failed (though sendBeacon may not read it)
      res.status(500).json({ error: "Flush failed", message: flushErr.message });
    }
  } catch (err) {
    console.error("Error in POST /api/sessions/:sessionId/flush:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Search sessions by email (auth required, MUST be before :session_id route)
app.get("/api/sessions/search", authenticateJWT, async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email query parameter required" });
    }

    const { rows: sessions } = await db.query(`
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
      WHERE u.email LIKE $1
      GROUP BY sc.session_id, sc.distinct_id, sc.campaign_id, c.name, s.status, s.watched, s.watched_at
      ORDER BY first_timestamp DESC
    `, [`%${email}%`]);

    const transformedSessions = sessions.map(session => ({
      ...session,
      status: session.status || "dropped_off",
      watched: session.watched === true,
      playback_url: `/api/sessions/${session.session_id}/playback`
    }));

    res.json({ sessions: transformedSessions });
  } catch (err) {
    console.error("Error in GET /api/sessions/search:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// List sessions (auth required)
app.get("/api/sessions", authenticateJWT, async (req, res) => {
  try {
    const { campaign_id, campaign, email, status } = req.query;

    if (!campaign_id && !campaign && !email) {
      return res.status(400).json({ error: "Missing filter: campaign_id, campaign, or email required" });
    }

    // Validate status if provided
    if (status && !["completed", "dropped_off"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'completed' or 'dropped_off'" });
    }

    let params = [];
    let paramIndex = 1;

    // Build query based on filters
    let baseQuery = `
      SELECT
        sc.session_id,
        sc.distinct_id,
        sc.campaign_id,
        c.name as campaign_name,
        c.funnel_config,
        s.status,
        s.watched,
        s.watched_at,
        s.assets_status,
        s.ai_diagnosis,
        s.furthest_step_index,
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
      whereClauses.push(`u.email = $${paramIndex++}`);
      params.push(email);
    }

    if (campaign_id || campaign) {
      let cid = campaign_id;
      if (campaign && !campaign_id) {
        const c = await db.queryOne("SELECT id, name FROM campaigns WHERE name = $1", [campaign]);
        if (!c) {
          return res.status(404).json({ error: "Campaign not found" });
        }
        cid = c.id;
      }
      whereClauses.push(`sc.campaign_id = $${paramIndex++}`);
      params.push(cid);
    }

    if (status) {
      if (status === "dropped_off") {
        // dropped_off = no status set OR explicitly set to dropped_off
        whereClauses.push("(s.status IS NULL OR s.status = 'dropped_off')");
      } else {
        whereClauses.push(`s.status = $${paramIndex++}`);
        params.push(status);
      }
    }

    if (whereClauses.length > 0) {
      baseQuery += " WHERE " + whereClauses.join(" AND ");
    }

    baseQuery += `
      GROUP BY sc.session_id, sc.distinct_id, sc.campaign_id, c.name, c.funnel_config, s.status, s.watched, s.watched_at, s.assets_status, s.ai_diagnosis, s.furthest_step_index
      ORDER BY first_timestamp DESC
    `;

    const { rows: sessions } = await db.query(baseQuery, params);

    // Add playback_url, normalize status, and get email for each session
    const transformedSessions = await Promise.all(sessions.map(async (session) => {
      // Get email if linked
      const emailResult = await db.queryOne(`
        SELECT u.email FROM aliases a
        JOIN users u ON a.user_id = u.id
        WHERE a.distinct_id = $1
      `, [session.distinct_id]);

      // Resolve furthest_step_index to key string
      let furthest_step_key = null;
      if (session.funnel_config && session.furthest_step_index >= 0) {
        try {
          const funnelSteps = JSON.parse(session.funnel_config);
          furthest_step_key = funnelSteps[session.furthest_step_index]?.key || null;
        } catch (e) {
          // Invalid JSON, leave as null
        }
      }

      // Exclude funnel_config from response (internal detail)
      const { funnel_config, ...sessionData } = session;

      return {
        ...sessionData,
        status: session.status || "dropped_off",
        watched: session.watched === true,
        email: emailResult?.email || null,
        playback_url: `/api/sessions/${session.session_id}/playback`,
        furthest_step_key
      };
    }));

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

    // Get all chunks for this session, ordered by sequence_id (with timestamp fallback)
    const { rows: chunks } = await db.query(`
      SELECT sc.*, c.name as campaign_name
      FROM session_chunks sc
      LEFT JOIN campaigns c ON sc.campaign_id = c.id
      WHERE sc.session_id = $1
      ORDER BY
        CASE WHEN sc.sequence_id IS NULL THEN 1 ELSE 0 END,
        sc.sequence_id ASC,
        sc.timestamp ASC
    `, [session_id]);

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

        // Handle both gzipped (.json.gz) and plain JSON files
        let jsonString;
        if (chunk.s3_key.endsWith('.gz')) {
          // Decompress gzipped content (async)
          const decompressed = await new Promise((resolve, reject) => {
            zlib.gunzip(s3Response.Body, (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
          jsonString = decompressed.toString("utf8");
        } else {
          // Legacy plain JSON
          jsonString = s3Response.Body.toString("utf8");
        }

        return JSON.parse(jsonString);
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
app.get("/api/sessions/:session_id", authenticateJWT, async (req, res) => {
  try {
    const { session_id } = req.params;

    const session = await db.queryOne(`
      SELECT
        sc.session_id,
        sc.distinct_id,
        sc.campaign_id,
        c.name as campaign_name,
        c.funnel_config,
        s.status,
        s.watched,
        s.watched_at,
        s.assets_status,
        s.ai_diagnosis,
        s.ai_evidence,
        s.ai_last_step,
        s.ai_progress,
        s.furthest_step_index,
        MIN(sc.timestamp) as first_timestamp,
        MAX(sc.timestamp) as last_timestamp,
        (MAX(sc.timestamp) - MIN(sc.timestamp)) as duration_ms,
        COUNT(sc.id) as chunk_count
      FROM session_chunks sc
      LEFT JOIN campaigns c ON sc.campaign_id = c.id
      LEFT JOIN sessions s ON sc.session_id = s.session_id
      WHERE sc.session_id = $1
      GROUP BY sc.session_id, sc.distinct_id, sc.campaign_id, c.name, c.funnel_config, s.status, s.watched, s.watched_at, s.assets_status, s.ai_diagnosis, s.ai_evidence, s.ai_last_step, s.ai_progress, s.furthest_step_index
    `, [session_id]);

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Get user email if linked
    const emailResult = await db.queryOne(`
      SELECT u.email
      FROM aliases a
      JOIN users u ON a.user_id = u.id
      WHERE a.distinct_id = $1
    `, [session.distinct_id]);

    // Get journey (step visits) for this session
    const { rows: stepVisits } = await db.query(`
      SELECT step_key, step_index, visited_at
      FROM session_steps
      WHERE session_id = $1
      ORDER BY step_index ASC
    `, [session_id]);
    const journey = stepVisits.map(s => s.step_key);

    // Resolve furthest_step_index to key string
    let furthest_step_key = null;
    if (session.funnel_config && session.furthest_step_index >= 0) {
      try {
        const funnelSteps = JSON.parse(session.funnel_config);
        furthest_step_key = funnelSteps[session.furthest_step_index]?.key || null;
      } catch (e) {
        // Invalid JSON, leave as null
      }
    }

    // Exclude funnel_config from response (internal detail)
    const { funnel_config, ...sessionData } = session;

    res.json({
      ...sessionData,
      email: emailResult?.email || null,
      status: session.status || "dropped_off",
      assets_status: session.assets_status || "raw",
      watched: session.watched === true,
      playback_url: `/api/sessions/${session.session_id}/playback`,
      furthest_step_key,
      journey
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
    const { rows: chunks } = await db.query(
      "SELECT s3_key, s3_bucket FROM session_chunks WHERE session_id = $1",
      [session_id]
    );
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
    await db.query("DELETE FROM session_chunks WHERE session_id = $1", [session_id]);

    // Delete from sessions (status)
    await db.query("DELETE FROM sessions WHERE session_id = $1", [session_id]);

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
app.post("/api/sessions/:session_id/watched", authenticateJWT, async (req, res) => {
  try {
    const { session_id } = req.params;

    // Check if session exists in chunks
    const chunk = await db.queryOne("SELECT 1 FROM session_chunks WHERE session_id = $1 LIMIT 1", [session_id]);
    if (!chunk) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Upsert watched status
    const now = Date.now();
    await db.query(`
      INSERT INTO sessions (session_id, watched, watched_at, updated_at)
      VALUES ($1, true, $2, $3)
      ON CONFLICT(session_id) DO UPDATE SET watched = true, watched_at = EXCLUDED.watched_at, updated_at = EXCLUDED.updated_at
    `, [session_id, now, now]);

    console.log(`👁️  Session marked as watched: ${session_id}`);
    res.json({ success: true, session_id, watched: true });
  } catch (err) {
    console.error("Error in POST /api/sessions/:session_id/watched:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Set session status (domain token required)
app.post("/api/sessions/:session_id/status", validateDomainToken, async (req, res) => {
  try {
    const { session_id } = req.params;
    const { status } = req.body;

    if (!status || !["completed", "dropped_off"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'completed' or 'dropped_off'" });
    }

    // Upsert session status
    const now = Date.now();
    await db.query(`
      INSERT INTO sessions (session_id, status, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT(session_id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
    `, [session_id, status, now]);

    // Handle assets based on status
    let assetsStatus;
    if (status === 'dropped_off') {
      // Auto-queue for video generation
      await queue.addJob(session_id);
      assetsStatus = 'queued';
    } else {
      // Completed sessions stay raw (save cost)
      await db.query("UPDATE sessions SET assets_status = 'raw' WHERE session_id = $1", [session_id]);
      assetsStatus = 'raw';
    }

    console.log(`🏷️  Session status: ${session_id} -> ${status} (assets: ${assetsStatus})`);
    res.json({ success: true, session_id, status, assets_status: assetsStatus });
  } catch (err) {
    console.error("Error in POST /api/sessions/:session_id/status:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Track funnel checkpoint (domain token required)
// Called by frontend SDK when user reaches a funnel step
app.post("/api/sessions/:session_id/checkpoint", validateDomainToken, async (req, res) => {
  try {
    const { session_id } = req.params;
    const { key } = req.body;

    if (!key) {
      return res.sendStatus(200); // Silently ignore missing key
    }

    // 1. Find campaign via first chunk (efficient)
    const chunk = await db.queryOne(`
      SELECT campaign_id FROM session_chunks
      WHERE session_id = $1
      LIMIT 1
    `, [session_id]);

    if (!chunk) {
      return res.sendStatus(404);
    }

    // 2. Get funnel config from campaign
    const campaign = await db.queryOne(`
      SELECT funnel_config FROM campaigns WHERE id = $1
    `, [chunk.campaign_id]);

    if (!campaign || !campaign.funnel_config) {
      return res.sendStatus(200); // No funnel configured, silently accept
    }

    // 3. Parse config and find step index
    const config = JSON.parse(campaign.funnel_config);
    const stepIndex = config.findIndex(step => step.key === key);

    if (stepIndex === -1) {
      return res.sendStatus(200); // Unknown key, silently accept
    }

    // 4. Record step visit for journey tracking (ignore if already visited)
    await db.query(`
      INSERT INTO session_steps (session_id, step_key, step_index)
      VALUES ($1, $2, $3)
      ON CONFLICT (session_id, step_key) DO NOTHING
    `, [session_id, key, stepIndex]);

    // 5. Get current progress (handle missing session row)
    const session = await db.queryOne(`
      SELECT furthest_step_index FROM sessions WHERE session_id = $1
    `, [session_id]);
    const currentIndex = session?.furthest_step_index ?? -1;

    // 6. Update only if advancing deeper into funnel ("high score" rule)
    if (stepIndex > currentIndex) {
      await db.query(`
        INSERT INTO sessions (session_id, furthest_step_index)
        VALUES ($1, $2)
        ON CONFLICT(session_id) DO UPDATE
        SET furthest_step_index = EXCLUDED.furthest_step_index
      `, [session_id, stepIndex]);

      console.log(`📍 Checkpoint: ${session_id} advanced to step ${stepIndex} (${config[stepIndex].name})`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error in POST /api/sessions/:session_id/checkpoint:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Manually trigger video generation for a session (auth required)
app.post("/api/sessions/:session_id/generate-assets", authenticateJWT, async (req, res) => {
  try {
    const { session_id } = req.params;

    // Check if session exists
    const session = await db.queryOne("SELECT session_id, assets_status FROM sessions WHERE session_id = $1", [session_id]);
    if (!session) {
      // Check if chunks exist
      const chunk = await db.queryOne("SELECT 1 FROM session_chunks WHERE session_id = $1 LIMIT 1", [session_id]);
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
    await queue.addJob(session_id);
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
    const session = await db.queryOne(`
      SELECT s.session_id, s.assets_status, s.video_s3_key, s.timeline_s3_key, sc.s3_bucket
      FROM sessions s
      LEFT JOIN session_chunks sc ON s.session_id = sc.session_id
      WHERE s.session_id = $1
      LIMIT 1
    `, [session_id]);

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
app.get("/api/sessions/:session_id/ai-result", authenticateJWT, async (req, res) => {
  try {
    const { session_id } = req.params;

    // Get session with AI diagnosis
    const session = await db.queryOne(`
      SELECT session_id, ai_diagnosis, ai_evidence, ai_last_step, ai_progress
      FROM sessions
      WHERE session_id = $1
    `, [session_id]);

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
app.get("/api/campaigns/:id/ai-status", authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify campaign exists
    const campaign = await db.queryOne("SELECT id, name FROM campaigns WHERE id = $1", [id]);
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    // Count sessions by assets_status for this campaign
    const stats = await db.queryOne(`
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
      WHERE sc.campaign_id = $1
    `, [id]);

    res.json({
      campaign_id: parseInt(id),
      campaign_name: campaign.name,
      sessions: {
        total: parseInt(stats.total) || 0,
        dropped_off: parseInt(stats.dropped_off) || 0,
        completed: parseInt(stats.completed) || 0
      },
      assets: {
        ready: parseInt(stats.ready) || 0,
        queued: parseInt(stats.queued) || 0,
        processing: parseInt(stats.processing) || 0,
        raw: parseInt(stats.raw) || 0,
        failed: parseInt(stats.failed) || 0
      },
      ai_ready: parseInt(stats.ready) || 0
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
    const campaign = await db.queryOne(`
      SELECT id, name, created_at, mission_brief FROM campaigns WHERE id = $1
    `, [campaignId]);
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
    const goldenSession = await db.queryOne(`
      SELECT DISTINCT s.session_id
      FROM sessions s
      JOIN session_chunks sc ON s.session_id = sc.session_id
      WHERE sc.campaign_id = $1
        AND s.status = 'completed'
      ORDER BY s.updated_at DESC
      LIMIT 1
    `, [campaignId]);

    if (!goldenSession) {
      return res.status(400).json({
        error: "No completed sessions found to calibrate AI. Need at least one completed session as the Golden Path."
      });
    }

    // Find ALL drop-off sessions with ready assets (include bucket per session)
    const { rows: dropOffSessions } = await db.query(`
      SELECT DISTINCT
        s.session_id,
        s.timeline_s3_key,
        s.video_s3_key,
        sc.s3_bucket as bucket
      FROM sessions s
      JOIN session_chunks sc ON s.session_id = sc.session_id
      WHERE sc.campaign_id = $1
        AND s.status = 'dropped_off'
        AND s.assets_status = 'ready'
    `, [campaignId]);

    if (dropOffSessions.length === 0) {
      return res.status(400).json({
        error: "No processed drop-off sessions to analyze. Wait for video processing to complete."
      });
    }

    // Mark campaign as analyzing
    await db.query("UPDATE campaigns SET ai_analysis_status = 'analyzing' WHERE id = $1", [campaignId]);

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

        // Step 2: Generate custom rubric from mission brief + golden path
        console.log(`[AI] Generating custom analysis rubric...`);
        const rubric = await aiAnalyst.generateCustomRubric(campaign.mission_brief, goldenTimelineText);

        // Step 3: Build context cache with the rubric
        console.log(`[AI] Building context cache with persona: ${rubric.persona}`);
        const cacheName = await aiAnalyst.buildRubricCache(rubric, goldenTimelineText, campaignId);

        // Step 4: Sequential analysis - download video, analyze, cleanup for each session
        const analyses = [];
        const fs = require('fs');
        const tempDir = path.join(__dirname, 'temp');

        // Ensure temp directory exists
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }

        for (let i = 0; i < dropOffSessions.length; i++) {
          const session = dropOffSessions[i];

          // Validate: Ensure assets actually exist in the DB record
          if (!session.video_s3_key || !session.timeline_s3_key || !session.bucket) {
            console.warn(`[AI] Skipping ${session.session_id}: Missing S3 keys or bucket`);
            continue;
          }

          const tempVideoPath = path.join(tempDir, `${session.session_id}.mp4`);

          try {
            console.log(`[AI] Processing ${session.session_id} [${i + 1}/${dropOffSessions.length}]`);

            // A. Download timeline (text, keep in memory)
            const timelineResponse = await s3.getObject({
              Bucket: session.bucket,
              Key: session.timeline_s3_key
            }).promise();
            const timelineText = timelineResponse.Body.toString('utf8');

            // B. Download video (binary, write to disk)
            console.log(`[AI] Downloading video for ${session.session_id}...`);
            const videoResponse = await s3.getObject({
              Bucket: session.bucket,
              Key: session.video_s3_key
            }).promise();
            fs.writeFileSync(tempVideoPath, videoResponse.Body);

            // C. Run AI analysis with video
            const result = await aiAnalyst.analyzeDropOff(
              session.session_id,
              cacheName,
              timelineText,
              rubric,
              tempVideoPath
            );

            analyses.push(result);

          } catch (err) {
            console.error(`[AI] Failed to analyze ${session.session_id}:`, err.message);
            analyses.push({
              session_id: session.session_id,
              error: err.message
            });
          } finally {
            // D. Immediate cleanup - delete video before next iteration
            if (fs.existsSync(tempVideoPath)) {
              fs.unlinkSync(tempVideoPath);
              console.log(`[AI] Cleaned up temp video: ${session.session_id}`);
            }
          }
        }

        if (analyses.length === 0) {
          throw new Error('No sessions could be analyzed');
        }

        // Step 5: Generate campaign report
        console.log(`[AI] Generating campaign report...`);
        const report = await aiAnalyst.generateCampaignReport(
          campaignId,
          campaign.name,
          campaign.mission_brief,
          analyses,
          rubric
        );

        // Step 6: Save per-session AI diagnoses
        for (const analysis of analyses) {
          if (analysis.session_id && !analysis.error) {
            await db.query(`
              UPDATE sessions
              SET ai_diagnosis = $1, ai_evidence = $2, ai_last_step = $3, ai_progress = $4
              WHERE session_id = $5
            `, [
              analysis.category || null,
              analysis.evidence || null,
              analysis.last_step_name || null,
              analysis.progress_percentage || null,
              analysis.session_id
            ]);
            console.log(`[AI] Saved diagnosis for session: ${analysis.session_id} -> ${analysis.category}`);
          }
        }

        // Step 7: Save report and generated rubric to database
        await db.query(`
          UPDATE campaigns
          SET ai_report = $1, generated_rubric = $2, ai_analysis_status = 'complete'
          WHERE id = $3
        `, [report, JSON.stringify(rubric), campaignId]);

        console.log(`[AI] Analysis complete for campaign: ${campaign.name} (${analyses.length} sessions diagnosed)`);

      } catch (err) {
        console.error(`[AI] Analysis failed for campaign ${campaignId}:`, err);
        await db.query(`
          UPDATE campaigns
          SET ai_analysis_status = 'failed'
          WHERE id = $1
        `, [campaignId]);
      }
    })();

  } catch (err) {
    console.error("Error in POST /api/campaigns/:id/analyze:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// Get AI analysis report for a campaign
app.get("/api/campaigns/:id/report", authenticateJWT, async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);

    const result = await db.queryOne(`
      SELECT name, mission_brief, generated_rubric, ai_report, ai_analysis_status
      FROM campaigns
      WHERE id = $1
    `, [campaignId]);

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

    const campaignRecord = await db.queryOne("SELECT id, name FROM campaigns WHERE name = $1", [campaign]);
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

      // Write to PostgreSQL after successful S3 upload
      await db.query(`
        INSERT INTO session_chunks (session_id, distinct_id, campaign_id, s3_key, s3_bucket, page_url, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [sessionId, distinctId, campaignRecord.id, s3Key, bucketName, pageUrl, timestamp]);
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

app.post("/identify", validateDomainToken, async (req, res) => {
  try {
    const { email, distinctId } = req.body;
    if (!email || !distinctId) {
      return res.status(400).json({ error: "Missing email or distinctId" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Insert user (upsert - ignore if exists)
    await db.query(
      "INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING",
      [email]
    );

    const user = await db.queryOne("SELECT id, email FROM users WHERE email = $1", [email]);
    if (!user) {
      return res.status(500).json({ error: "Failed to retrieve user ID" });
    }

    // Insert alias (upsert - update user_id if exists)
    await db.query(
      "INSERT INTO aliases (distinct_id, user_id) VALUES ($1, $2) ON CONFLICT (distinct_id) DO UPDATE SET user_id = EXCLUDED.user_id",
      [distinctId, user.id]
    );

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

app.get("/api/stats", authenticateJWT, async (req, res) => {
  try {
    const totalCampaignsResult = await db.queryOne("SELECT COUNT(*) as count FROM campaigns");
    const totalSessionsResult = await db.queryOne("SELECT COUNT(DISTINCT session_id) as count FROM session_chunks");
    const totalUsersResult = await db.queryOne("SELECT COUNT(*) as count FROM users");

    const completedSessionsResult = await db.queryOne(`
      SELECT COUNT(*) as count FROM sessions WHERE status = 'completed'
    `);

    const droppedSessionsResult = await db.queryOne(`
      SELECT COUNT(DISTINCT sc.session_id) as count
      FROM session_chunks sc
      LEFT JOIN sessions s ON sc.session_id = s.session_id
      WHERE s.status IS NULL OR s.status = 'dropped_off'
    `);

    // Sessions in last 24 hours
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const sessionsLast24hResult = await db.queryOne(`
      SELECT COUNT(DISTINCT session_id) as count FROM session_chunks WHERE timestamp > $1
    `, [oneDayAgo]);

    // Sessions in last 7 days
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const sessionsLast7dResult = await db.queryOne(`
      SELECT COUNT(DISTINCT session_id) as count FROM session_chunks WHERE timestamp > $1
    `, [sevenDaysAgo]);

    const totalCampaigns = parseInt(totalCampaignsResult?.count) || 0;
    const totalSessions = parseInt(totalSessionsResult?.count) || 0;
    const totalUsers = parseInt(totalUsersResult?.count) || 0;
    const completedSessions = parseInt(completedSessionsResult?.count) || 0;
    const droppedSessions = parseInt(droppedSessionsResult?.count) || 0;
    const sessionsLast24h = parseInt(sessionsLast24hResult?.count) || 0;
    const sessionsLast7d = parseInt(sessionsLast7dResult?.count) || 0;

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
