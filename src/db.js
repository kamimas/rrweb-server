/**
 * PostgreSQL Database Connection Pool
 *
 * Provides async database access with connection pooling.
 * Replaces SQLite for concurrent write handling at scale.
 *
 * IMPORTANT: All queries are ASYNC. Always use await!
 */

require('dotenv').config();
const { Pool } = require('pg');

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                    // Max concurrent connections
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail fast if can't connect in 5s
});

// Test connection on startup
pool.query('SELECT NOW()')
  .then(res => {
    console.log('✅ PostgreSQL connected:', res.rows[0].now);
  })
  .catch(err => {
    console.error('❌ CRITICAL: PostgreSQL connection failed:', err.message);
    console.error('   Check DATABASE_URL in your .env file');
    process.exit(1);
  });

// Handle pool errors (connection lost, etc.)
pool.on('error', (err) => {
  console.error('❌ Unexpected PostgreSQL pool error:', err.message);
});

/**
 * Execute a single query.
 *
 * @param {string} text - SQL query with $1, $2, etc. placeholders
 * @param {Array} params - Parameter values
 * @returns {Promise<{rows: Array, rowCount: number}>}
 *
 * @example
 * const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
 * const user = rows[0];
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;

  // Log slow queries (> 100ms) for debugging
  if (duration > 100) {
    console.warn(`[DB] Slow query (${duration}ms):`, text.substring(0, 100));
  }

  return res;
}

/**
 * Get a client from the pool for transactions.
 * IMPORTANT: Always release the client in a finally block!
 *
 * @returns {Promise<PoolClient>}
 *
 * @example
 * const client = await db.getClient();
 * try {
 *   await client.query('BEGIN');
 *   await client.query('INSERT INTO ...');
 *   await client.query('INSERT INTO ...');
 *   await client.query('COMMIT');
 * } catch (e) {
 *   await client.query('ROLLBACK');
 *   throw e;
 * } finally {
 *   client.release(); // CRITICAL!
 * }
 */
async function getClient() {
  return pool.connect();
}

/**
 * Helper for single-row queries.
 * Returns the first row or null.
 *
 * @param {string} text - SQL query
 * @param {Array} params - Parameter values
 * @returns {Promise<Object|null>}
 *
 * @example
 * const user = await db.queryOne('SELECT * FROM users WHERE id = $1', [userId]);
 */
async function queryOne(text, params) {
  const { rows } = await query(text, params);
  return rows[0] || null;
}

/**
 * Helper for INSERT...RETURNING queries.
 * Returns the inserted row.
 *
 * @param {string} text - SQL INSERT with RETURNING clause
 * @param {Array} params - Parameter values
 * @returns {Promise<Object>}
 *
 * @example
 * const campaign = await db.insert(
 *   'INSERT INTO campaigns (name) VALUES ($1) RETURNING *',
 *   [name]
 * );
 */
async function insert(text, params) {
  const { rows } = await query(text, params);
  return rows[0];
}

/**
 * Close the pool (for graceful shutdown).
 */
async function close() {
  await pool.end();
  console.log('✅ PostgreSQL pool closed');
}

module.exports = {
  query,
  queryOne,
  insert,
  getClient,
  close,
  pool, // Expose for advanced use cases
};
