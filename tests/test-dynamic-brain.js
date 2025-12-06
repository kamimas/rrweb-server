/**
 * Dynamic Brain Test Bench
 *
 * Tests that the AI correctly generates context-specific analysis rubrics
 * based on the mission brief, proving the system is truly dynamic.
 *
 * Scenario A: EdTech (Calculus Quiz) -> Should generate pedagogical categories
 * Scenario B: E-Commerce (Luxury Watch) -> Should generate CRO categories
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const ai = require('../src/ai-analyst');

// --- SCENARIO DATA ---

const SCENARIOS = {
    EDTECH: {
        name: "Calculus Quiz (EdTech)",
        mission_brief: "This is a difficult calculus assessment for high schoolers. We want to know if students are dropping off because the math concepts are too hard (knowledge gap) or if the equation editor UI is frustrating them.",
        golden_timeline: `
============================================================
SESSION TIMELINE - Duration: 8:35.0
============================================================
[0:00.0] Page Loaded
[0:00.5] Viewport: 1920x1080
[0:01.0] Navigated to: https://app.mathquiz.com/derivatives
[0:03.0] Scrolled
[0:05.0] Clicked: "Start Quiz"
[0:08.0] Scrolled
[0:10.0] Text displayed: "Question 1: Find the derivative of f(x) = x^2"
[0:12.0] Clicked: "Open Equation Editor"
[0:15.0] Typed "2x" in "answer-q1" field
[0:18.0] Clicked: "Validate Syntax"
[0:20.0] Text displayed: "Syntax Valid"
[0:22.0] Clicked: "Next Question"
[0:25.0] Scrolled
[0:28.0] Text displayed: "Question 2: Find the derivative of f(x) = sin(x)"
[0:30.0] Clicked: "Show Hint"
[0:32.0] Text displayed: "Hint: Remember the basic trigonometric derivatives"
[0:35.0] Scrolled
[0:38.0] Typed "cos(x)" in "answer-q2" field
[0:40.0] Clicked: "Validate Syntax"
[0:42.0] Text displayed: "Syntax Valid"
[0:45.0] Clicked: "Next Question"
[0:48.0] Scrolled
[0:50.0] Text displayed: "Question 3: Find the derivative of f(x) = cos(x)"
[0:52.0] Scrolled
[0:55.0] Typed "-sin(x)" in "answer-q3" field
[0:58.0] Clicked: "Validate Syntax"
[1:00.0] Text displayed: "Syntax Valid"
[1:02.0] Clicked: "Next Question"
[1:05.0] Scrolled
[1:08.0] Text displayed: "Question 4: Find the derivative of f(x) = e^x"
[1:10.0] Scrolled
[1:12.0] Typed "e^x" in "answer-q4" field
[1:15.0] Clicked: "Validate Syntax"
[1:18.0] Text displayed: "Syntax Valid"
[1:20.0] Clicked: "Next Question"
[1:23.0] Scrolled
[1:25.0] Text displayed: "Question 5: Find the derivative of f(x) = ln(x)"
[1:28.0] Clicked: "Show Hint"
[1:30.0] Text displayed: "Hint: The natural log has a simple derivative"
[1:32.0] Scrolled
[1:35.0] Typed "1/x" in "answer-q5" field
[1:38.0] Clicked: "Validate Syntax"
[1:40.0] Text displayed: "Syntax Valid"
[1:42.0] Clicked: "Submit Quiz"
[1:45.0] Scrolled
[1:48.0] Text displayed: "Processing your answers..."
[1:50.0] Scrolled
[1:52.0] Text displayed: "Quiz Complete! Score: 5/5"
[1:55.0] Clicked: "View Detailed Results"
[2:00.0] Scrolled
[2:05.0] Text displayed: "Q1: Correct - You answered 2x"
[2:08.0] Text displayed: "Q2: Correct - You answered cos(x)"
[2:10.0] Text displayed: "Q3: Correct - You answered -sin(x)"
[2:12.0] Text displayed: "Q4: Correct - You answered e^x"
[2:15.0] Text displayed: "Q5: Correct - You answered 1/x"
[2:18.0] Scrolled
[2:20.0] Clicked: "Continue to Next Module"
[2:25.0] Navigated to: /modules/integration
============================================================
Total Events: 650 | Actions Logged: 55
============================================================

QUIZ SUMMARY:
- Question 1: Correct (derivative of x^2 = 2x)
- Question 2: Correct (derivative of sin(x) = cos(x))
- Question 3: Correct (derivative of cos(x) = -sin(x))
- Question 4: Correct (derivative of e^x = e^x)
- Question 5: Correct (derivative of ln(x) = 1/x)
- Score: 5/5 (100%)
- Time: 2 minutes 25 seconds
- Hints Used: 2
- Syntax Validations: 5 (all passed)
        `,
        dropoff_timeline: `
============================================================
SESSION TIMELINE - Duration: 1:45.0
============================================================
[0:00.0] Page Loaded
[0:00.5] Viewport: 1920x1080
[0:01.0] Navigated to: https://app.mathquiz.com/derivatives
[0:05.0] Clicked: "Start Quiz"
[0:10.0] Scrolled
[0:12.0] Typed "2x" in "answer-q1" field
[0:14.0] Clicked: "Next Question"
[0:18.0] Scrolled
[0:20.0] Typed "sin(x)" in "answer-q2" field
[0:22.0] Clicked: "Next Question"
[0:25.0] Error displayed: "Incorrect! Try again."
[0:30.0] Scrolled
[0:35.0] Typed "tan(x)" in "answer-q2" field
[0:38.0] Clicked: "Next Question"
[0:40.0] Error displayed: "Incorrect! Try again."
[0:45.0] Scrolled
[0:50.0] Scrolled
[0:55.0] Scrolled
[1:00.0] Typed "x" in "answer-q2" field
[1:05.0] Clicked: "Next Question"
[1:08.0] Error displayed: "Incorrect! Try again."
[1:15.0] Scrolled
[1:20.0] Scrolled
[1:30.0] Clicked: "Exit Quiz"
[1:35.0] Navigated to: /dashboard
[1:45.0] Session ended (Drop-off)
============================================================
Total Events: 180 | Actions Logged: 22
============================================================

DROP-OFF INDICATORS:
- Failed Question 2 three times (derivative of sin(x))
- Tried sin(x), tan(x), then just "x"
- Excessive scrolling after failures
- Exited without completing
        `
    },
    ECOMM: {
        name: "Luxury Watch Checkout (E-Comm)",
        mission_brief: "High-ticket checkout flow ($5k+ watches). Trust and Payment friction are critical. We want to ensure shipping costs or lack of payment badges aren't scaring users away.",
        golden_timeline: `
============================================================
SESSION TIMELINE - Duration: 6:40.0
============================================================
[0:00.0] Page Loaded
[0:00.5] Viewport: 1920x1080
[0:01.0] Navigated to: https://luxurywatches.com/rolex-submariner
[0:03.0] Scrolled
[0:05.0] Scrolled
[0:08.0] Text displayed: "Rolex Submariner - $7,500.00"
[0:10.0] Scrolled
[0:12.0] Clicked: "View Product Gallery"
[0:15.0] Clicked: "Image 2 of 5"
[0:18.0] Clicked: "Image 3 of 5"
[0:20.0] Clicked: "Close Gallery"
[0:22.0] Scrolled
[0:25.0] Text displayed: "Authenticity Guaranteed - Certificate Included"
[0:28.0] Clicked: "View Authenticity Details"
[0:30.0] Scrolled
[0:32.0] Text displayed: "Every watch comes with official Rolex certificate"
[0:35.0] Clicked: "Close Modal"
[0:38.0] Scrolled
[0:40.0] Clicked: "Add to Cart"
[0:42.0] Text displayed: "Added to cart successfully"
[0:45.0] Navigated to: /cart
[0:48.0] Scrolled
[0:50.0] Text displayed: "Your Cart - 1 Item"
[0:52.0] Text displayed: "Subtotal: $7,500.00"
[0:55.0] Clicked: "Apply Promo Code"
[0:58.0] Typed "LUXURY10" in "promo-code" field
[1:00.0] Clicked: "Apply"
[1:02.0] Text displayed: "Promo code not valid for this item"
[1:05.0] Scrolled
[1:08.0] Clicked: "Proceed to Checkout"
[1:10.0] Navigated to: /checkout
[1:12.0] Text displayed: "Secure Checkout - SSL Encrypted"
[1:15.0] Scrolled
[1:18.0] Typed "[NAME]" in "full-name" field
[1:20.0] Typed "[EMAIL]" in "email" field
[1:22.0] Typed "[PHONE]" in "phone" field
[1:25.0] Scrolled
[1:28.0] Typed "[ADDRESS]" in "street-address" field
[1:30.0] Typed "[CITY]" in "city" field
[1:32.0] Typed "[STATE]" in "state" field
[1:35.0] Typed "[ZIP]" in "zip-code" field
[1:38.0] Clicked: "Calculate Shipping"
[1:40.0] Text displayed: "Calculating shipping options..."
[1:42.0] Scrolled
[1:45.0] Text displayed: "Standard Shipping (5-7 days): $25.00"
[1:48.0] Text displayed: "Express Shipping (2-3 days): $75.00"
[1:50.0] Text displayed: "Overnight (Next Day): $150.00"
[1:52.0] Clicked: "Standard Shipping (5-7 days): $25.00"
[1:55.0] Text displayed: "Shipping method selected"
[1:58.0] Scrolled
[2:00.0] Clicked: "Continue to Payment"
[2:02.0] Navigated to: /checkout/payment
[2:05.0] Text displayed: "Payment Information"
[2:08.0] Text displayed: "Trust badges: Visa, Mastercard, Amex, PayPal"
[2:10.0] Scrolled
[2:12.0] Typed "[PAYMENT]" in "card-number" field
[2:15.0] Typed "[PAYMENT]" in "card-name" field
[2:18.0] Typed "[PAYMENT]" in "expiry" field
[2:20.0] Typed "[PAYMENT]" in "cvv" field
[2:22.0] Scrolled
[2:25.0] Clicked: "Save payment method for future purchases"
[2:28.0] Scrolled
[2:30.0] Clicked: "Review Order"
[2:32.0] Navigated to: /checkout/review
[2:35.0] Text displayed: "Order Review"
[2:38.0] Text displayed: "Rolex Submariner - $7,500.00"
[2:40.0] Text displayed: "Shipping: $25.00"
[2:42.0] Text displayed: "Tax: $600.00"
[2:45.0] Text displayed: "Total: $8,125.00"
[2:48.0] Scrolled
[2:50.0] Text displayed: "30-Day Return Policy"
[2:52.0] Text displayed: "Free returns within 30 days"
[2:55.0] Scrolled
[2:58.0] Clicked: "Place Order"
[3:00.0] Text displayed: "Processing your order..."
[3:05.0] Navigated to: /order-confirmation
[3:08.0] Text displayed: "Order Confirmed! Order #12345"
[3:10.0] Text displayed: "Thank you for your purchase"
[3:12.0] Text displayed: "Confirmation email sent to [EMAIL]"
[3:15.0] Scrolled
[3:18.0] Text displayed: "Estimated Delivery: 5-7 business days"
[3:20.0] Clicked: "Track Order"
============================================================
Total Events: 750 | Actions Logged: 65
============================================================

CHECKOUT SUMMARY:
- Product: Rolex Submariner ($7,500.00)
- Shipping: Standard 5-7 days ($25.00)
- Tax: $600.00
- Total: $8,125.00
- Payment: Credit Card (Completed)
- Order: #12345 Confirmed
- Return Policy: 30-day free returns
- Trust Elements: SSL encryption, payment badges, authenticity certificate
        `,
        dropoff_timeline: `
============================================================
SESSION TIMELINE - Duration: 1:30.0
============================================================
[0:00.0] Page Loaded
[0:00.5] Viewport: 1920x1080
[0:01.0] Navigated to: https://luxurywatches.com/rolex-submariner
[0:05.0] Scrolled
[0:10.0] Scrolled
[0:15.0] Clicked: "View Details"
[0:20.0] Scrolled
[0:25.0] Clicked: "Add to Cart"
[0:28.0] Navigated to: /cart
[0:30.0] Scrolled
[0:35.0] Clicked: "Proceed to Checkout"
[0:40.0] Navigated to: /checkout
[0:45.0] Typed "[NAME]" in "full-name" field
[0:50.0] Typed "[EMAIL]" in "email" field
[0:55.0] Typed "[ADDRESS]" in "shipping-address" field
[1:00.0] Clicked: "Calculate Shipping"
[1:05.0] Text displayed: "International Shipping: $350.00"
[1:10.0] Scrolled
[1:12.0] Scrolled
[1:15.0] Scrolled
[1:18.0] Clicked: "Back to Cart"
[1:22.0] Clicked: "Continue Shopping"
[1:25.0] Navigated to: /
[1:30.0] Session ended (Drop-off)
============================================================
Total Events: 180 | Actions Logged: 20
============================================================

DROP-OFF INDICATORS:
- Saw high international shipping cost ($350)
- Scrolled multiple times after seeing price
- Abandoned cart immediately
- Did not proceed to payment
        `
    }
};

async function runTestBench() {
    console.log("=".repeat(60));
    console.log("DYNAMIC BRAIN TEST BENCH");
    console.log("Testing AI adaptability across different funnel types");
    console.log("=".repeat(60));

    // Check for API key
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
        console.log('\n  SKIP: GEMINI_API_KEY not configured');
        console.log('Set your API key in .env to run this test');
        return;
    }

    console.log(' GEMINI_API_KEY detected\n');

    const results = [];

    // Test both scenarios
    for (const key of Object.keys(SCENARIOS)) {
        const scenario = SCENARIOS[key];
        console.log(`\n${"=".repeat(60)}`);
        console.log(` TESTING SCENARIO: ${scenario.name}`);
        console.log(`${"=".repeat(60)}`);

        try {
            // STEP 1: Generate Rubric (The "Brain")
            console.log(`\n1. Generating Custom Rubric via Gemini 3 Pro...`);
            console.log(`   Brief: "${scenario.mission_brief.substring(0, 80)}..."`);

            const rubric = await ai.generateCustomRubric(scenario.mission_brief, scenario.golden_timeline);

            console.log(`\n   RUBRIC GENERATED:`);
            console.log(`   Persona: ${rubric.persona}`);
            console.log(`   Categories: ${JSON.stringify(rubric.categories)}`);
            console.log(`   Key Signals: ${rubric.key_signals.substring(0, 80)}...`);

            // VALIDATION: Check if rubric matches expected context
            const rubricStr = JSON.stringify(rubric).toLowerCase();
            let contextMatch = true;
            let warnings = [];

            if (key === 'EDTECH') {
                // EdTech should have pedagogical terms
                const expectedTerms = ['knowledge', 'learning', 'concept', 'difficulty', 'understanding', 'pedagogical', 'educational'];
                const hasExpected = expectedTerms.some(term => rubricStr.includes(term));
                const hasWrongContext = ['shipping', 'payment', 'price', 'cart', 'checkout'].some(term => rubricStr.includes(term));

                if (!hasExpected) {
                    warnings.push("WARNING: EdTech rubric missing pedagogical terms");
                    contextMatch = false;
                }
                if (hasWrongContext) {
                    warnings.push("WARNING: EdTech rubric contains e-commerce terms");
                    contextMatch = false;
                }
            }

            if (key === 'ECOMM') {
                // E-comm should have CRO/commerce terms
                const expectedTerms = ['price', 'shipping', 'trust', 'payment', 'cart', 'checkout', 'cost', 'friction'];
                const hasExpected = expectedTerms.some(term => rubricStr.includes(term));
                const hasWrongContext = ['learning', 'pedagogical', 'quiz', 'student', 'knowledge gap'].some(term => rubricStr.includes(term));

                if (!hasExpected) {
                    warnings.push("WARNING: E-Comm rubric missing commerce terms");
                    contextMatch = false;
                }
                if (hasWrongContext) {
                    warnings.push("WARNING: E-Comm rubric contains educational terms");
                    contextMatch = false;
                }
            }

            if (warnings.length > 0) {
                warnings.forEach(w => console.log(`   ${w}`));
            } else {
                console.log(`   CONTEXT VALIDATION: Rubric matches ${key} context`);
            }

            // STEP 2: Build Context Cache
            console.log(`\n2. Caching Context (Rubric + Golden Path)...`);
            const cacheKey = await ai.buildRubricCache(rubric, scenario.golden_timeline, `test-${key.toLowerCase()}`);
            console.log(`   Cache Active: ${cacheKey}`);

            // STEP 3: Analyze Drop-off
            console.log(`\n3. Analyzing Drop-off Session...`);
            const diagnosis = await ai.analyzeDropOff(
                `dropoff-${key.toLowerCase()}`,
                cacheKey,
                scenario.dropoff_timeline,
                rubric
            );

            console.log(`\n   DIAGNOSIS RECEIVED:`);
            console.log(`   Category: ${diagnosis.category}`);
            console.log(`   Last Step: ${diagnosis.last_step_name}`);
            console.log(`   Progress: ${diagnosis.progress_percentage}%`);
            console.log(`   Evidence: ${diagnosis.evidence}`);
            console.log(`   Key Observation: ${diagnosis.key_observation}`);

            // Validate diagnosis makes sense for context
            const diagnosisStr = JSON.stringify(diagnosis).toLowerCase();
            let diagnosisValid = true;

            if (key === 'EDTECH') {
                // Should mention math/concept issues, not shipping
                if (diagnosisStr.includes('shipping') || diagnosisStr.includes('payment')) {
                    console.log(`   WARNING: EdTech diagnosis mentions e-commerce concepts`);
                    diagnosisValid = false;
                }
            }

            if (key === 'ECOMM') {
                // Should mention shipping/price, not learning
                if (diagnosisStr.includes('learning') || diagnosisStr.includes('pedagogical')) {
                    console.log(`   WARNING: E-Comm diagnosis mentions educational concepts`);
                    diagnosisValid = false;
                }
            }

            results.push({
                scenario: key,
                name: scenario.name,
                persona: rubric.persona,
                categories: rubric.categories,
                contextMatch,
                diagnosisValid,
                diagnosis: diagnosis.category
            });

            console.log(`\n   ${contextMatch && diagnosisValid ? 'PASS' : 'PARTIAL'}: ${scenario.name}`);

        } catch (error) {
            console.error(`   FAIL:`, error.message);
            results.push({
                scenario: key,
                name: scenario.name,
                error: error.message
            });
        }

        // Small delay between scenarios
        await new Promise(r => setTimeout(r, 1000));
    }

    // Summary
    console.log(`\n${"=".repeat(60)}`);
    console.log("TEST SUMMARY");
    console.log(`${"=".repeat(60)}`);

    for (const result of results) {
        if (result.error) {
            console.log(`\n ${result.name}: FAILED - ${result.error}`);
        } else {
            const status = result.contextMatch && result.diagnosisValid ? 'PASS' : 'PARTIAL';
            console.log(`\n${status === 'PASS' ? '' : ''} ${result.name}: ${status}`);
            console.log(`   Persona: ${result.persona}`);
            console.log(`   Categories: ${result.categories.join(', ')}`);
            console.log(`   Diagnosis: ${result.diagnosis}`);
        }
    }

    const allPassed = results.every(r => !r.error && r.contextMatch && r.diagnosisValid);
    console.log(`\n${"=".repeat(60)}`);
    console.log(allPassed ? " ALL TESTS PASSED - AI is context-aware!" : " SOME TESTS NEED REVIEW");
    console.log(`${"=".repeat(60)}`);
}

runTestBench().catch(err => {
    console.error('Test Error:', err);
    process.exit(1);
});
