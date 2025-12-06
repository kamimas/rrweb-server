/**
 * Test 2.1: SQLite WAL Mode Verification
 *
 * Ensures WAL mode is enabled for concurrent access.
 */

const db = require('../src/db');

console.log('='.repeat(60));
console.log('TEST: SQLite WAL Mode');
console.log('='.repeat(60));

// Check journal mode
const result = db.pragma('journal_mode');
const mode = result[0]?.journal_mode || 'unknown';

console.log(`Journal Mode: ${mode}`);

if (mode === 'wal') {
    console.log('\nPASS: WAL mode is enabled');
    console.log('Concurrent read/write is supported');
} else {
    console.error('\nFAIL: WAL mode is NOT enabled');
    console.error(`Current mode: ${mode}`);
    console.error('This will cause SQLITE_BUSY errors with concurrent access');
    process.exit(1);
}

// Verify tables exist
const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    ORDER BY name
`).all();

console.log('\nTables in database:');
tables.forEach(t => console.log(`  - ${t.name}`));

// Check if sessions table has required columns
try {
    const columns = db.prepare('PRAGMA table_info(sessions)').all();
    const columnNames = columns.map(c => c.name);

    console.log('\nSessions table columns:');
    columns.forEach(c => console.log(`  - ${c.name} (${c.type})`));

    const required = ['session_id', 'status', 'assets_status', 'video_s3_key', 'timeline_s3_key'];
    const missing = required.filter(col => !columnNames.includes(col));

    if (missing.length > 0) {
        console.error(`\nFAIL: Missing columns: ${missing.join(', ')}`);
        process.exit(1);
    }

    console.log('\nPASS: All required columns exist');
} catch (err) {
    console.error('\nFAIL: Could not check sessions table -', err.message);
    process.exit(1);
}

console.log('\n' + '='.repeat(60));
console.log('ALL TESTS PASSED');
console.log('='.repeat(60));
