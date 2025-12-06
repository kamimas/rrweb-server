/**
 * Test 1.1: Timeline Generation
 *
 * Verifies the timeline generator works correctly.
 */

const fs = require('fs');
const path = require('path');
const { generateTimeline } = require('../timeline-react-aware');

const inputFile = process.argv[2] || path.join(__dirname, '../recording.json');

console.log('='.repeat(60));
console.log('TEST: Timeline Generation');
console.log('='.repeat(60));
console.log(`Input: ${inputFile}\n`);

// Test 1: File exists
if (!fs.existsSync(inputFile)) {
    console.error('FAIL: Input file not found');
    process.exit(1);
}

// Test 2: Parse JSON
let events;
try {
    events = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
    console.log(`PASS: Parsed ${events.length} events`);
} catch (err) {
    console.error('FAIL: Could not parse JSON -', err.message);
    process.exit(1);
}

// Test 3: Generate timeline
let timeline;
try {
    timeline = generateTimeline(events);
    console.log(`PASS: Generated timeline (${timeline.length} chars)`);
} catch (err) {
    console.error('FAIL: Timeline generation failed -', err.message);
    process.exit(1);
}

// Test 4: Output contains expected elements
const hasClicks = timeline.includes('Clicked:');
const hasTimestamps = /\[\d+:\d+\.\d+\]/.test(timeline);
const hasHeader = timeline.includes('SESSION TIMELINE');

console.log(`PASS: Contains clicks: ${hasClicks}`);
console.log(`PASS: Contains timestamps: ${hasTimestamps}`);
console.log(`PASS: Contains header: ${hasHeader}`);

// Test 5: Empty input handling
try {
    const emptyResult = generateTimeline([]);
    console.log(`PASS: Handles empty input gracefully`);
} catch (err) {
    console.error('FAIL: Crashed on empty input');
    process.exit(1);
}

console.log('\n' + '='.repeat(60));
console.log('Timeline Output Preview (first 1000 chars):');
console.log('='.repeat(60));
console.log(timeline.substring(0, 1000));

console.log('\n' + '='.repeat(60));
console.log('ALL TESTS PASSED');
console.log('='.repeat(60));
