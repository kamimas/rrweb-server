/**
 * AI Analyst Module - Dynamic Rubric Generation
 *
 * NEW APPROACH: Context Injection + Rubric Generation
 * Instead of rigid templates, the AI dynamically generates a custom analysis rubric
 * based on the admin's "Mission Brief" and the Golden Path.
 *
 * Flow:
 * 1. Admin provides a free-text "mission_brief" describing what the funnel does
 * 2. Calibration Agent (Gemini Pro) generates custom categories from brief + golden path
 * 3. Build Context Cache using the generated rubric
 * 4. Analyze drop-offs using the custom rules
 * 5. Generate strategic report
 *
 * Uses Google Gemini with Context Caching for cost efficiency.
 */

const { GoogleGenAI } = require("@google/genai");
const fs = require('fs');
const path = require('path');

// Models
const MODEL_SMART = "gemini-3-pro-preview";  // For rubric generation and final report
const MODEL_FAST = "gemini-2.5-flash";       // For batch analysis (supports caching, min 1024 tokens)

// Initialize client lazily (after env is loaded)
let client = null;

function initClient() {
    if (!client) {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY environment variable is not set');
        }
        client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
}

/**
 * Upload a video file to Google's File API for processing.
 * Required for video analysis with Gemini.
 *
 * @param {string} localPath - Path to the video file
 * @param {string} mimeType - MIME type (e.g., 'video/mp4')
 * @returns {Promise<object>} - The uploaded file object with URI
 */
async function uploadToGemini(localPath, mimeType) {
    initClient();

    const uploadResult = await client.files.upload({
        file: localPath,
        config: {
            mimeType,
            displayName: path.basename(localPath),
        }
    });

    // Wait for processing (videos take a few seconds)
    let file = await client.files.get({ name: uploadResult.name });
    while (file.state === 'PROCESSING') {
        console.log('[AI] Waiting for video processing...');
        await new Promise(r => setTimeout(r, 2000));
        file = await client.files.get({ name: file.name });
    }

    if (file.state === 'FAILED') {
        throw new Error('Video processing failed');
    }

    console.log(`[AI] Video uploaded: ${file.name}`);
    return file;
}

/**
 * STEP 1: Generate Custom Rubric (The "Calibration Agent")
 *
 * This runs ONCE per analysis request. Takes the admin's mission brief
 * and the golden timeline, then generates a custom analysis configuration.
 *
 * @param {string} missionBrief - The admin's description of what the funnel does
 * @param {string} goldenTimeline - The timeline from a successful session
 * @returns {Promise<object>} - Generated rubric with persona, categories, and signals
 */
async function generateCustomRubric(missionBrief, goldenTimeline) {
    initClient();

    console.log("🧠 [AI] Generating Custom Analysis Rubric...");

    const prompt = `You are a Lead Product Analyst specializing in user behavior analysis.

            CONTEXT FROM ADMIN:
            ${missionBrief}

            SUCCESSFUL USER JOURNEY (Golden Path):
            ${goldenTimeline}

            TASK:
            Based on the admin's description and the actual success path above, create a custom JSON configuration for analyzing drop-off sessions for THIS specific campaign.

            Your output must include:
            1. "persona" - An appropriate AI analyst persona for this specific funnel (e.g., "Pedagogical Expert", "CRO Specialist", "Luxury Retail UX Expert")
            2. "goal" - A one-sentence goal for the analysis
            3. "categories" - Exactly 4-5 specific failure categories relevant to THIS funnel (not generic ones)
            4. "key_signals" - Specific behavioral signals to look for in the timeline

            IMPORTANT: The categories should be specific to the funnel described, not generic UX categories.

            Examples of good category specificity:
            - For a calculus quiz: "Concept Confusion (Derivatives)", "Calculation Error", "Equation Input Frustration"
            - For luxury checkout: "Sticker Shock (Price Sensitivity)", "Trust Friction (Payment Security)", "Shipping Cost Surprise"
            - For employee tool: "Workflow Inefficiency", "Navigation Confusion", "Feature Discovery Failure"

            OUTPUT JSON ONLY (no markdown, no explanation):
            {
                "persona": "...",
                "goal": "...",
                "categories": ["Category 1", "Category 2", "Category 3", "Category 4"],
                "key_signals": "..."
            }`;

    const result = await client.models.generateContent({
        model: MODEL_SMART,
        contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    const responseText = result.text;

    try {
        const jsonStr = responseText.replace(/```json|```/g, '').trim();
        const rubric = JSON.parse(jsonStr);

        console.log(`🎯 [AI] Generated Persona: ${rubric.persona}`);
        console.log(`📋 [AI] Generated Categories: ${rubric.categories.join(', ')}`);

        return rubric;
    } catch (err) {
        console.error('[AI] Failed to parse rubric response:', responseText);
        // Return a fallback rubric
        return {
            persona: "UX Analyst",
            goal: "Identify friction points and drop-off reasons in user journeys.",
            categories: [
                "UX Friction",
                "Technical Issue",
                "Content Problem",
                "Unknown Cause"
            ],
            key_signals: "Errors, unexpected navigation, long pauses, repeated actions, rage clicks."
        };
    }
}

/**
 * STEP 2: Build Context Cache using the Generated Rubric
 *
 * Creates a cached system instruction using the dynamically generated rubric.
 *
 * @param {object} rubric - The generated rubric from generateCustomRubric
 * @param {string} goldenTimeline - The golden path timeline
 * @param {string|number} campaignId - The campaign ID (for cache naming)
 * @returns {Promise<string>} - The cache name/key for reuse
 */
async function buildRubricCache(rubric, goldenTimeline, campaignId) {
    initClient();

    console.log(`[AI] Building Context Cache with persona: ${rubric.persona}`);

    const systemInstruction = `You are a ${rubric.persona}.

YOUR GOAL:
${rubric.goal}

THE GOLDEN PATH (What Success Looks Like):
Below is the timeline of a user who successfully COMPLETED this journey.
This is your baseline map of the expected user experience.

--- GOLDEN TIMELINE START ---
${goldenTimeline}
--- GOLDEN TIMELINE END ---

YOUR ROLE:
You will analyze subsequent user sessions (drop-offs) to determine:
1. WHERE they stopped (which step/screen/question)
2. WHY they stopped (categorize into one of the valid categories)
3. WHAT they struggled with before quitting

ANALYSIS RULES:
When analyzing drop-offs, you MUST categorize the root cause into one of these specific categories:
${rubric.categories.map(c => `- ${c}`).join('\n')}

LOOK FOR THESE SIGNALS:
${rubric.key_signals}

OUTPUT FORMAT:
Always respond in valid JSON format when analyzing sessions.
{
    "session_id": "the session id",
    "last_step_name": "Name of the step/screen they were on when they quit",
    "progress_percentage": 0-100,
    "category": "One of the valid categories above",
    "evidence": "One sentence explaining why you chose this category",
    "key_observation": "Most notable behavior before drop-off",
    "comparison_to_golden": "Brief comparison to the success path"
}`;

    // Create cache with 1 hour TTL
    // Note: Gemini requires minimum 1024 tokens for caching, so we pad the initialization
    const initPrompt = `Initialize Analysis Context for Campaign ${campaignId}.

I need you to analyze user sessions that dropped off before completing the journey.
For each session, compare it against the Golden Path timeline provided in your instructions.
Identify the exact step where the user stopped, categorize the reason for dropping off, and provide evidence.

The categories you should use are:
${rubric.categories.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Key behavioral signals to watch for:
${rubric.key_signals}

Please confirm you understand your role and are ready to analyze sessions.`;

    const initResponse = `Analysis context loaded successfully.

I am now acting as a ${rubric.persona}.

My goal: ${rubric.goal}

I have reviewed the Golden Path timeline and understand the expected user journey. I am ready to analyze drop-off sessions using these categories:
${rubric.categories.map((c, i) => `${i + 1}. ${c}`).join('\n')}

I will look for these behavioral signals:
${rubric.key_signals}

For each session you provide, I will output a JSON object with:
- session_id: The session identifier
- last_step_name: Where the user stopped
- progress_percentage: How far they got (0-100)
- category: One of the categories above
- evidence: Why I chose this category
- key_observation: Notable behavior before drop-off
- comparison_to_golden: How this compares to the success path

Ready to analyze. Please provide the first drop-off session.`;

    const cache = await client.caches.create({
        model: MODEL_FAST,
        config: {
            displayName: `analysis-${campaignId}-${Date.now()}`,
            systemInstruction: systemInstruction,
            contents: [
                { role: "user", parts: [{ text: initPrompt }] },
                { role: "model", parts: [{ text: initResponse }] }
            ],
            ttl: "3600s",  // 1 hour
        }
    });

    console.log(`[AI] Cache created: ${cache.name}`);
    return cache.name;
}

/**
 * STEP 3: Analyze a Single Drop-off Session
 *
 * Compares a drop-off session against the cached Golden Path using the custom rubric.
 *
 * @param {string} sessionId - The session ID being analyzed
 * @param {string} cacheName - The cache name from buildRubricCache
 * @param {string} timelineText - The drop-off session's timeline
 * @param {object} rubric - The generated rubric (for category validation)
 * @param {string} videoPath - Path to the drop-off session's video (optional)
 * @returns {Promise<object>} - Analysis result
 */
async function analyzeDropOff(sessionId, cacheName, timelineText, rubric = null, videoPath = null) {
    initClient();

    console.log(`[AI] Analyzing drop-off: ${sessionId}`);

    const prompt = `Analyze this drop-off session and compare it to the Golden Path.

SESSION ID: ${sessionId}

USER TIMELINE (DROP-OFF):
--- TIMELINE START ---
${timelineText}
--- TIMELINE END ---

INSTRUCTIONS:
1. Compare this user's journey to the Golden Path
2. Identify where they stopped and categorize WHY using the valid categories
3. Look for the key signals mentioned in your instructions

OUTPUT (JSON ONLY):
{
    "session_id": "${sessionId}",
    "last_step_name": "Name of the step/screen they were on when they quit",
    "progress_percentage": 0-100,
    "category": "One of the valid categories from your instructions",
    "evidence": "One sentence explaining why you chose this category",
    "key_observation": "Most notable behavior before drop-off",
    "comparison_to_golden": "Brief comparison (e.g., 'Stopped 3 steps before completion')"
}`;

    // Build content parts
    const parts = [{ text: prompt }];

    // If video is provided and exists, upload and include it
    if (videoPath && fs.existsSync(videoPath)) {
        try {
            const videoFile = await uploadToGemini(videoPath, "video/mp4");
            parts.push({
                fileData: {
                    mimeType: videoFile.mimeType,
                    fileUri: videoFile.uri
                }
            });
        } catch (err) {
            console.warn(`[AI] Could not upload video for ${sessionId}: ${err.message}`);
        }
    }

    // Generate content using the cached context
    const result = await client.models.generateContent({
        model: MODEL_FAST,
        contents: [{ role: "user", parts }],
        config: {
            cachedContent: cacheName
        }
    });

    const responseText = result.text;

    // Parse JSON from response
    try {
        const jsonStr = responseText.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(jsonStr);

        // Validate category if rubric provided
        if (rubric && rubric.categories && parsed.category) {
            const isValidCategory = rubric.categories.some(
                c => c.toLowerCase().includes(parsed.category.toLowerCase()) ||
                     parsed.category.toLowerCase().includes(c.toLowerCase())
            );
            if (!isValidCategory) {
                console.warn(`[AI] Category "${parsed.category}" not in valid list, keeping as-is`);
            }
        }

        return parsed;
    } catch (err) {
        console.error(`[AI] Failed to parse response for ${sessionId}:`, responseText);
        return {
            session_id: sessionId,
            last_step_name: "Unknown",
            progress_percentage: 0,
            category: rubric?.categories?.[rubric.categories.length - 1] || "Unknown",
            evidence: "Failed to parse AI response",
            key_observation: "Analysis error",
            comparison_to_golden: "Analysis failed",
            raw_response: responseText
        };
    }
}

/**
 * STEP 4: Generate Campaign Report
 *
 * Aggregates individual analyses into a strategic report.
 * Uses the generated rubric to tailor the report to the context.
 *
 * @param {string} campaignId - The campaign ID
 * @param {string} campaignName - The campaign name
 * @param {string} missionBrief - The original mission brief
 * @param {Array<object>} analysisResults - Array of individual analysis results
 * @param {object} rubric - The generated rubric (for context)
 * @returns {Promise<string>} - The generated report (markdown)
 */
async function generateCampaignReport(campaignId, campaignName, missionBrief, analysisResults, rubric) {
    initClient();

    console.log(`[AI] Generating report for campaign: ${campaignName} (${analysisResults.length} sessions)`);

    const prompt = `You are the ${rubric.persona} responsible for improving user experience.

CAMPAIGN: ${campaignName} (ID: ${campaignId})
MISSION: ${missionBrief}
ANALYSIS COUNT: ${analysisResults.length} drop-off sessions analyzed

CATEGORIES USED IN ANALYSIS:
${rubric.categories.map(c => `- ${c}`).join('\n')}

DATA:
${JSON.stringify(analysisResults, null, 2)}

TASK:
Generate a strategic report for the team. Include:

1. **Executive Summary** - One paragraph overview of the drop-off patterns
2. **The Killer Step** - Identify which step/screen causes the most drop-offs
3. **Category Breakdown** - Show the distribution across the categories above with percentages
4. **Pattern Analysis** - Any patterns in behavior, timing, or specific friction points. When citing specific evidence, use Markdown links to reference sessions. The link text can be anything natural (e.g., "Session A", "Watch Evidence", "this user"), but the URL must follow this exact format: session:{session_id}?t={timestamp} where timestamp is in seconds. Example: [Watch this user hesitate](session:sess_abc123?t=45)
5. **Actionable Recommendations** - 3-5 specific changes to reduce drop-offs, prioritized by impact

FORMAT:
Use markdown formatting. Be specific and actionable.
Focus on insights that will help the team improve the user experience.
Reference specific categories and steps from the analysis.

CRITICAL - SESSION LINK FORMAT:
When referencing sessions, you MUST use the session: protocol (not a URL path).
✅ CORRECT: [Watch Session](session:sess_abc123) or [Watch Session](session:sess_abc123?t=45)
❌ WRONG: [Watch Session](/session/sess_abc123) - DO NOT use slashes
❌ WRONG: [Watch Session](https://example.com/session/sess_abc123) - DO NOT use URLs
The format is: session:{session_id} or session:{session_id}?t={seconds}
Use the exact session_id values from the DATA section above.`;

    const result = await client.models.generateContent({
        model: MODEL_SMART,
        contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    return result.text;
}

/**
 * MAIN ORCHESTRATOR: Run Full Campaign Analysis
 *
 * This is the main entry point for analyzing a campaign.
 * Flow:
 * 1. Generate custom rubric from mission brief + golden path
 * 2. Build context cache with the rubric
 * 3. Analyze all drop-off sessions
 * 4. Generate strategic report
 *
 * @param {number} campaignId - The campaign ID
 * @param {string} campaignName - The campaign name
 * @param {string} missionBrief - The admin's description of the funnel
 * @param {string} goldenTimelineText - Timeline from a completed session
 * @param {Array<{sessionId: string, timelineText: string, videoPath?: string}>} dropOffSessions - Sessions to analyze
 * @param {function} onProgress - Progress callback (optional)
 * @returns {Promise<{rubric: object, analyses: Array, report: string}>}
 */
async function runCampaignAnalysis(campaignId, campaignName, missionBrief, goldenTimelineText, dropOffSessions, onProgress = null) {
    // Stage 1: Generate custom rubric from mission brief
    if (onProgress) onProgress('calibration', 'Generating custom analysis rubric...');
    const rubric = await generateCustomRubric(missionBrief, goldenTimelineText);

    // Stage 2: Build cache with the generated rubric
    if (onProgress) onProgress('cache', `Building cache with ${rubric.persona} persona...`);
    const cacheName = await buildRubricCache(rubric, goldenTimelineText, campaignId);

    // Stage 3: Analyze each drop-off
    const analyses = [];
    for (let i = 0; i < dropOffSessions.length; i++) {
        const session = dropOffSessions[i];
        if (onProgress) {
            onProgress('analysis', `Analyzing session ${i + 1}/${dropOffSessions.length}...`);
        }

        try {
            const result = await analyzeDropOff(
                session.sessionId,
                cacheName,
                session.timelineText,
                rubric,
                session.videoPath
            );
            analyses.push(result);
        } catch (err) {
            console.error(`[AI] Error analyzing ${session.sessionId}:`, err.message);
            analyses.push({
                session_id: session.sessionId,
                error: err.message
            });
        }

        // Small delay to avoid rate limiting
        if (i < dropOffSessions.length - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // Stage 4: Generate report with context
    if (onProgress) onProgress('report', 'Generating strategic report...');
    const report = await generateCampaignReport(campaignId, campaignName, missionBrief, analyses, rubric);

    return { rubric, analyses, report };
}

// Legacy function for backwards compatibility
async function runFullAnalysis(campaignId, campaignName, goldenTimelineText, dropOffSessions, config = null, onProgress = null) {
    // If config is provided (old format), convert to mission brief
    const missionBrief = config?.goal || "Analyze user drop-offs and identify friction points.";
    return runCampaignAnalysis(campaignId, campaignName, missionBrief, goldenTimelineText, dropOffSessions, onProgress);
}

// =============================================================================
// PROBLEM ANALYSIS FUNCTIONS
// =============================================================================

/**
 * Analyze a Problem Cohort
 *
 * Takes sessions with notes from a problem cohort and generates a markdown report
 * analyzing patterns, root causes, and recommendations.
 *
 * @param {object} problem - The problem object { id, title, description }
 * @param {Array<object>} sessionsWithNotes - Sessions with metadata and notes
 *   Each session: { session_id, location_country, location_city, location_region,
 *                   device_os, device_browser, device_type, duration_ms, start_hour, notes: [] }
 * @returns {Promise<string>} - Markdown report
 */
async function analyzeProblemCohort(problem, sessionsWithNotes) {
    initClient();

    console.log(`[AI] Analyzing problem cohort: "${problem.title}" (${sessionsWithNotes.length} sessions)`);

    // Build structured session data
    const sessionData = sessionsWithNotes.map(session => {
        const notes = session.notes.map(n => `[${n.color}] ${n.content}`).join('; ');
        return `<session id="${session.session_id}">
  <location country="${session.location_country || ''}" city="${session.location_city || ''}" region="${session.location_region || ''}" />
  <device type="${session.device_type || ''}" os="${session.device_os || ''}" browser="${session.device_browser || ''}" />
  <duration_seconds>${session.duration_ms ? Math.round(session.duration_ms / 1000) : 'unknown'}</duration_seconds>
  <start_hour>${session.start_hour !== null && session.start_hour !== undefined ? session.start_hour : 'unknown'}</start_hour>
  <analyst_notes>${notes}</analyst_notes>
</session>`;
    }).join('\n');

    const prompt = `You are a UX analyst investigating a recurring user problem. Your goal is to find what these problem sessions have in common so engineers can fix the root cause.

<problem>
Title: ${problem.title}
Description: ${problem.description || 'No description provided.'}
</problem>

<sessions>
${sessionData}
</sessions>

<instructions>
Analyze the ${sessionsWithNotes.length} sessions above. Look for factors that might explain why these users experienced this problem:

1. **Device patterns**: Are certain device types (mobile/desktop), browsers, or operating systems over-represented?
2. **Duration patterns**: Do short sessions or long sessions correlate with this issue?
3. **Time patterns**: Does the problem occur more at certain hours?
4. **Location patterns**: Any geographic concentration?
5. **Behavioral patterns**: What do the analyst notes reveal about user actions leading to the problem?

For each factor, report the breakdown (e.g., "Mobile: 8/10 sessions, Desktop: 2/10 sessions"). Highlight any factor where one value appears in >60% of sessions.

When referencing specific sessions, use this link format: [descriptive text](session:SESSION_ID)
</instructions>

Respond in this exact markdown format:

# ${problem.title}

## Summary
2-3 sentences: What is happening and who is affected.

## Contributing Factors
| Factor | Breakdown | Significant? |
|--------|-----------|--------------|
| Device Type | mobile: X, desktop: Y | Yes/No |
| Browser | chrome: X, safari: Y, ... | Yes/No |
| OS | iOS: X, Windows: Y, ... | Yes/No |
| Duration | <1min: X, 1-5min: Y, >5min: Z | Yes/No |
| Time of Day | morning: X, afternoon: Y, ... | Yes/No |
| Location | US: X, EU: Y, ... | Yes/No |

## Key Patterns
Bullet points describing behavioral patterns from analyst notes. Link to specific sessions.

## Root Cause Hypothesis
One paragraph: Your best guess at why this is happening, based on the data.

## Recommended Fixes
1. **[HIGH]** Most impactful fix
2. **[MEDIUM]** Secondary fix
3. **[LOW]** Nice-to-have fix`;

    const result = await client.models.generateContent({
        model: MODEL_SMART,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
            thinkingConfig: {
                thinkingLevel: "HIGH"
            }
        }
    });

    return result.text;
}

/**
 * Continue a chat conversation about a problem analysis
 *
 * @param {object} problem - The problem object { id, title, description }
 * @param {Array<object>} sessionsWithNotes - Original session data used for analysis
 * @param {string} report - The generated AI report
 * @param {Array<object>} chatHistory - Previous messages [{ role, content }]
 * @param {string} userMessage - The new user message
 * @returns {Promise<string>} - Assistant response
 */
async function chatAboutProblem(problem, sessionsWithNotes, report, chatHistory, userMessage) {
    initClient();

    console.log(`[AI] Chat about problem: "${problem.title}" (${chatHistory.length} prior messages)`);

    // Build compact session reference
    const sessionRef = sessionsWithNotes.map(session => {
        const loc = [session.location_country, session.location_city].filter(Boolean).join('/') || '?';
        const dev = [session.device_type, session.device_browser].filter(Boolean).join('/') || '?';
        const notes = session.notes.map(n => n.content).join('; ');
        return `${session.session_id}: ${loc}, ${dev} — "${notes}"`;
    }).join('\n');

    // System context with structured data
    const systemContext = `<context>
<problem title="${problem.title}">${problem.description || ''}</problem>
<sessions count="${sessionsWithNotes.length}">
${sessionRef}
</sessions>
<report>
${report}
</report>
</context>

<instructions>
Answer questions about this analysis. Reference session IDs when relevant. Be concise.
</instructions>`;

    // Build contents array with history
    const contents = [
        { role: "user", parts: [{ text: systemContext }] },
        { role: "model", parts: [{ text: "Ready to answer questions about this problem analysis." }] }
    ];

    // Add chat history
    for (const msg of chatHistory) {
        contents.push({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        });
    }

    // Add the new user message
    contents.push({
        role: "user",
        parts: [{ text: userMessage }]
    });

    const result = await client.models.generateContent({
        model: MODEL_SMART,
        contents,
        config: {
            thinkingConfig: {
                thinkingLevel: "HIGH"
            }
        }
    });

    return result.text;
}

module.exports = {
    // Core functions (new API)
    generateCustomRubric,
    buildRubricCache,
    analyzeDropOff,
    generateCampaignReport,
    runCampaignAnalysis,

    // Problem analysis functions
    analyzeProblemCohort,
    chatAboutProblem,

    // Legacy compatibility
    runFullAnalysis
};
