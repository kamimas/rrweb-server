/**
 * Funnel Tracking Backend Integration Test
 *
 * Tests the checkpoint endpoint and "high score" logic.
 * Run with: node tests/test-funnel-backend.js
 *
 * Prerequisites:
 * - Server running on localhost:3000
 * - ALLOWED_DOMAINS configured with localhost:3003
 */

const db = require('../src/db');

// CONFIG - matches existing test setup
const API_URL = 'http://localhost:3000';
const HOST = 'localhost:3003';
const DOMAIN_TOKEN = '6d4a8cd0fb6b363742837691f30f5fe852c507446ee6f1199521a9b445465596';

// TEST DATA
const SESSION_ID = 'test-funnel-' + Date.now();
const CAMPAIGN_NAME = 'Funnel Test Campaign ' + Date.now();

// FUNNEL CONFIG
const FUNNEL_CONFIG = [
    { name: "Landing", key: "view_home" },      // Index 0
    { name: "Pricing", key: "view_pricing" },   // Index 1
    { name: "Signup", key: "click_signup" },    // Index 2
    { name: "Success", key: "purchase_done" }   // Index 3
];

let campaignId = null;

async function setupTestData() {
    console.log("🛠️  Setting up Test Data...");
    console.log(`   Session ID: ${SESSION_ID}`);

    // 1. Create Campaign with Funnel Config
    const insertCampaign = db.prepare(`
        INSERT INTO campaigns (name, created_at, funnel_config)
        VALUES (?, ?, ?)
    `);
    const result = insertCampaign.run(CAMPAIGN_NAME, Date.now(), JSON.stringify(FUNNEL_CONFIG));
    campaignId = result.lastInsertRowid;
    console.log(`   Campaign ID: ${campaignId}`);

    // 2. Create Session Chunk (links session to campaign)
    // Note: session row will be created by checkpoint endpoint via upsert
    const insertChunk = db.prepare(`
        INSERT INTO session_chunks (session_id, distinct_id, campaign_id, s3_key, s3_bucket, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertChunk.run(SESSION_ID, 'test-user-funnel', campaignId, `mock_key_${SESSION_ID}`, 'mock_bucket', Date.now());

    console.log("   ✅ Test data created\n");
}

async function sendCheckpoint(key) {
    const res = await fetch(`${API_URL}/api/sessions/${SESSION_ID}/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            key,
            host: HOST,
            domainToken: DOMAIN_TOKEN
        })
    });
    return res.status;
}

function getProgress() {
    const row = db.prepare("SELECT furthest_step_index FROM sessions WHERE session_id = ?").get(SESSION_ID);
    return row?.furthest_step_index ?? -1;
}

function verifyProgress(expectedIndex, testName) {
    const actual = getProgress();
    if (actual === expectedIndex) {
        console.log(`✅ PASS: [${testName}] Index is ${actual}`);
        return true;
    } else {
        console.error(`❌ FAIL: [${testName}] Expected ${expectedIndex}, got ${actual}`);
        return false;
    }
}

async function cleanup() {
    console.log("\n🧹 Cleaning up test data...");
    db.prepare("DELETE FROM sessions WHERE session_id = ?").run(SESSION_ID);
    db.prepare("DELETE FROM session_chunks WHERE session_id = ?").run(SESSION_ID);
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(campaignId);
    console.log("   Done");
}

async function runTests() {
    let passed = 0;
    let failed = 0;

    try {
        await setupTestData();
        console.log("🚀 Starting Funnel Logic Tests...\n");

        // TEST 1: First Step (Landing - Index 0)
        console.log("👉 Test 1: Sending 'view_home' (Index 0)...");
        let status = await sendCheckpoint('view_home');
        if (status !== 200) {
            console.error(`❌ FAIL: HTTP status ${status}`);
            failed++;
        } else if (verifyProgress(0, "First Step")) {
            passed++;
        } else {
            failed++;
        }

        // TEST 2: Skip to End (Success - Index 3)
        console.log("\n👉 Test 2: Sending 'purchase_done' (Index 3) - Jumping ahead...");
        status = await sendCheckpoint('purchase_done');
        if (status !== 200) {
            console.error(`❌ FAIL: HTTP status ${status}`);
            failed++;
        } else if (verifyProgress(3, "Jump to End")) {
            passed++;
        } else {
            failed++;
        }

        // TEST 3: Go Backwards (Pricing - Index 1)
        console.log("\n👉 Test 3: Sending 'view_pricing' (Index 1) - Should be ignored...");
        status = await sendCheckpoint('view_pricing');
        if (status !== 200) {
            console.error(`❌ FAIL: HTTP status ${status}`);
            failed++;
        } else if (verifyProgress(3, "Backwards Navigation - High Score Preserved")) {
            passed++;
        } else {
            failed++;
        }

        // TEST 4: Invalid Key
        console.log("\n👉 Test 4: Sending 'unknown_key'...");
        status = await sendCheckpoint('unknown_key');
        if (status === 200) {
            console.log("✅ PASS: Unknown key returned 200 OK");
            passed++;
        } else {
            console.error(`❌ FAIL: Unknown key returned ${status}`);
            failed++;
        }
        if (verifyProgress(3, "Unknown Key - Index Unchanged")) {
            passed++;
        } else {
            failed++;
        }

        // TEST 5: Missing key
        console.log("\n👉 Test 5: Sending request with no key...");
        status = await sendCheckpoint(undefined);
        if (status === 200) {
            console.log("✅ PASS: Missing key returned 200 OK");
            passed++;
        } else {
            console.error(`❌ FAIL: Missing key returned ${status}`);
            failed++;
        }

        // Summary
        console.log("\n" + "=".repeat(50));
        if (failed === 0) {
            console.log(`✨ ALL TESTS PASSED (${passed}/${passed + failed})`);
        } else {
            console.log(`⚠️  TESTS COMPLETE: ${passed} passed, ${failed} failed`);
            process.exitCode = 1;
        }
        console.log("=".repeat(50));

    } catch (err) {
        console.error("\n❌ CRITICAL FAILURE:", err);
        process.exitCode = 1;
    } finally {
        await cleanup();
    }
}

runTests();
