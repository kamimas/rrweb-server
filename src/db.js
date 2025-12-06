/**
 * Shared Database Connection
 *
 * Provides a single SQLite connection with WAL mode enabled.
 * Used by server.js, worker.js, and tests.
 */

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');

// Database path (same logic as server.js)
const dbDir = process.env.NODE_ENV === 'production' ? '/app/data' : path.join(__dirname, '..');
const dbPath = path.join(dbDir, 'db.sqlite');

// Create connection
const db = new Database(dbPath);

// Enable WAL mode for concurrent access
db.pragma('journal_mode = WAL');

module.exports = db;
