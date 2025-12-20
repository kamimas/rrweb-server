# PostgreSQL Migration Guide

This document provides patterns for converting SQLite code to PostgreSQL in this codebase.

## Quick Reference

| SQLite | PostgreSQL |
|--------|------------|
| `db.prepare(sql).get(params)` | `await db.queryOne(sql, [params])` |
| `db.prepare(sql).all(params)` | `(await db.query(sql, [params])).rows` |
| `db.prepare(sql).run(params)` | `await db.query(sql, [params])` |
| `?` placeholder | `$1, $2, $3...` |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `INSERT OR REPLACE` | `INSERT ... ON CONFLICT ... DO UPDATE` |
| `result.lastInsertRowid` | `(RETURNING id)` in query |

## Pattern 1: Simple SELECT (Single Row)

### Before (SQLite)
```javascript
app.get("/api/users/:id", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  res.json(user);
});
```

### After (PostgreSQL)
```javascript
app.get("/api/users/:id", async (req, res) => {
  const user = await db.queryOne("SELECT * FROM users WHERE id = $1", [req.params.id]);
  res.json(user);
});
```

## Pattern 2: SELECT Multiple Rows

### Before (SQLite)
```javascript
const sessions = db.prepare("SELECT * FROM sessions WHERE status = ?").all("completed");
```

### After (PostgreSQL)
```javascript
const { rows: sessions } = await db.query(
  "SELECT * FROM sessions WHERE status = $1",
  ["completed"]
);
```

## Pattern 3: INSERT with Returning ID

### Before (SQLite)
```javascript
const result = db.prepare("INSERT INTO campaigns (name) VALUES (?)").run(name);
const newId = result.lastInsertRowid;
```

### After (PostgreSQL)
```javascript
const result = await db.insert(
  "INSERT INTO campaigns (name) VALUES ($1) RETURNING id",
  [name]
);
const newId = result.id;
```

## Pattern 4: INSERT OR IGNORE

### Before (SQLite)
```javascript
db.prepare("INSERT OR IGNORE INTO users (email) VALUES (?)").run(email);
```

### After (PostgreSQL)
```javascript
await db.query(
  "INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING",
  [email]
);
```

## Pattern 5: UPSERT (INSERT OR REPLACE)

### Before (SQLite)
```javascript
db.prepare(`
  INSERT INTO sessions (session_id, status) VALUES (?, ?)
  ON CONFLICT(session_id) DO UPDATE SET status = excluded.status
`).run(sessionId, status);
```

### After (PostgreSQL)
```javascript
await db.query(`
  INSERT INTO sessions (session_id, status) VALUES ($1, $2)
  ON CONFLICT (session_id) DO UPDATE SET status = EXCLUDED.status
`, [sessionId, status]);
```

## Pattern 6: UPDATE

### Before (SQLite)
```javascript
db.prepare("UPDATE sessions SET status = ? WHERE session_id = ?").run(status, sessionId);
```

### After (PostgreSQL)
```javascript
await db.query(
  "UPDATE sessions SET status = $1 WHERE session_id = $2",
  [status, sessionId]
);
```

## Pattern 7: DELETE

### Before (SQLite)
```javascript
db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
```

### After (PostgreSQL)
```javascript
await db.query("DELETE FROM sessions WHERE session_id = $1", [sessionId]);
```

## Pattern 8: Transactions

### Before (SQLite)
```javascript
// SQLite prepared statements run synchronously, so transactions are implicit
db.prepare("INSERT INTO campaigns ...").run(...);
db.prepare("INSERT INTO rules ...").run(...);
```

### After (PostgreSQL)
```javascript
const client = await db.getClient();
try {
  await client.query('BEGIN');
  const campaign = await client.query('INSERT INTO campaigns ... RETURNING id', [...]);
  await client.query('INSERT INTO rules (campaign_id) ...', [campaign.rows[0].id, ...]);
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release(); // CRITICAL: Always release!
}
```

## Pattern 9: Route Handler Conversion

### Before (SQLite)
```javascript
app.get("/api/data", authenticateJWT, (req, res) => {
  try {
    const data = db.prepare("SELECT * FROM table").all();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Internal error" });
  }
});
```

### After (PostgreSQL)
```javascript
app.get("/api/data", authenticateJWT, async (req, res) => {
  try {
    const { rows: data } = await db.query("SELECT * FROM table");
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Internal error" });
  }
});
```

## Common Mistakes to Avoid

### 1. Missing `await`
```javascript
// WRONG - returns a Promise, not data
const user = db.queryOne("SELECT ...");

// CORRECT
const user = await db.queryOne("SELECT ...");
```

### 2. Wrong Placeholder Syntax
```javascript
// WRONG - SQLite syntax
"SELECT * FROM users WHERE id = ?"

// CORRECT - PostgreSQL syntax
"SELECT * FROM users WHERE id = $1"
```

### 3. Missing `async` on Route Handler
```javascript
// WRONG - await won't work
app.get("/api/data", (req, res) => {
  const data = await db.query(...); // SyntaxError!
});

// CORRECT
app.get("/api/data", async (req, res) => {
  const data = await db.query(...);
});
```

### 4. Not Releasing Transaction Client
```javascript
// WRONG - connection leak!
const client = await db.getClient();
await client.query('BEGIN');
await client.query('INSERT ...');
await client.query('COMMIT');
// Missing client.release()!

// CORRECT - always use try/finally
const client = await db.getClient();
try {
  await client.query('BEGIN');
  await client.query('INSERT ...');
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```

## Files to Convert

### High Priority (Core Functionality)
1. `server.js` - Main API server (~92 calls remaining)
2. `src/queue-manager.js` - Video processing queue
3. `src/worker.js` - Background video processor

### Supporting Files
4. `src/s3-helpers.js` - Uses db for session lookup (needs db passed in)
5. `src/ai-analyst.js` - May use db for saving results

## Testing Your Migration

### 1. Syntax Check
```bash
node --check server.js
```

### 2. Parameter Scan
```bash
# Should return 0 results after migration
grep -n "= \?" server.js
```

### 3. Async Check
```bash
# Ensure all routes with db calls are async
grep -B2 "db.query\|db.queryOne" server.js | grep "app\."
# All matches should show "async (req, res)"
```

### 4. Load Test
```bash
# Run 50 concurrent requests
for i in {1..50}; do
  curl -X POST http://localhost:3000/api/sessions/test-$i/flush \
    -H "Content-Type: application/json" \
    -d '{"events":[],"campaign":"test"}' &
done
wait
```

## PostgreSQL Setup

### Local Development
```bash
# Using Docker
docker run -d \
  --name rrweb-postgres \
  -e POSTGRES_USER=rrweb \
  -e POSTGRES_PASSWORD=rrweb_password \
  -e POSTGRES_DB=rrweb_sessions \
  -p 5432:5432 \
  postgres:15-alpine

# Initialize schema
psql -U rrweb -d rrweb_sessions -f docs/schema.sql
```

### Environment Variable
```bash
DATABASE_URL=postgres://rrweb:rrweb_password@localhost:5432/rrweb_sessions
```
