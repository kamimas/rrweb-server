const fs = require('fs');

/**
 * Mask PII (Personally Identifiable Information) in user input.
 * Replaces sensitive data with placeholders to protect privacy.
 *
 * @param {string} text - The text to mask
 * @param {string} fieldName - The field name (for context-aware masking)
 * @returns {string} - Masked text
 */
function maskPII(text, fieldName = '') {
    if (!text || typeof text !== 'string') return text;

    const lowerField = fieldName.toLowerCase();

    // Email fields - mask completely
    if (lowerField.includes('email')) {
        return '[EMAIL]';
    }

    // Password fields - mask completely
    if (lowerField.includes('password') || lowerField.includes('pwd')) {
        return '[PASSWORD]';
    }

    // Phone fields - mask completely
    if (lowerField.includes('phone') || lowerField.includes('tel')) {
        return '[PHONE]';
    }

    // Name fields - mask completely
    if (lowerField.includes('name') && !lowerField.includes('username')) {
        return '[NAME]';
    }

    // Address fields
    if (lowerField.includes('address') || lowerField.includes('street') || lowerField.includes('city') || lowerField.includes('zip')) {
        return '[ADDRESS]';
    }

    // Credit card fields
    if (lowerField.includes('card') || lowerField.includes('credit') || lowerField.includes('cvv') || lowerField.includes('cvc')) {
        return '[PAYMENT]';
    }

    // SSN fields
    if (lowerField.includes('ssn') || lowerField.includes('social')) {
        return '[SSN]';
    }

    // Pattern-based detection (for unlabeled fields)
    // Email pattern
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text)) {
        return '[EMAIL]';
    }

    // Phone pattern (various formats)
    if (/(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(text)) {
        return '[PHONE]';
    }

    // Credit card pattern (16 digits with optional separators)
    if (/\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/.test(text)) {
        return '[PAYMENT]';
    }

    // SSN pattern
    if (/\d{3}[-\s]?\d{2}[-\s]?\d{4}/.test(text)) {
        return '[SSN]';
    }

    // If text is short and might be sensitive, show length indicator
    if (text.length > 20) {
        return `[INPUT: ${text.length} chars]`;
    }

    return text;
}

/**
 * Generate a text timeline narrative from rrweb events.
 * Handles React's virtual DOM updates and nested click targets.
 *
 * @param {Array} events - Array of rrweb events
 * @param {boolean} maskSensitiveData - Whether to mask PII (default: true)
 * @returns {string} - The timeline narrative as a string
 */
function generateTimeline(events, maskSensitiveData = true) {
    if (!events || events.length === 0) {
        return 'No events to process.';
    }

    // --- THE VIRTUAL DOM STORE (local to this call) ---
    const virtualDOM = {};

    // Helper: Register Nodes into our Virtual DOM
    function registerNode(node, parentId = null) {
        if (!node) return;

        const nodeData = {
            id: node.id,
            tagName: node.tagName || 'text',
            attributes: node.attributes || {},
            parentId: parentId,
            text: ''
        };

        // Capture text content
        if (node.type === 3 && node.textContent) {
            nodeData.text = node.textContent.trim();
            // Update parent's cached text for easier lookup
            if (parentId && virtualDOM[parentId]) {
                virtualDOM[parentId].textChildren = (virtualDOM[parentId].textChildren || '') + nodeData.text;
            }
        }

        if (node.id) virtualDOM[node.id] = nodeData;

        if (node.childNodes) {
            node.childNodes.forEach(child => registerNode(child, node.id));
        }
    }

    // Helper: Remove Nodes (React Unmounts)
    function removeNode(id) {
        if (virtualDOM[id]) delete virtualDOM[id];
    }

    // Helper: Collect all text content from a node and its children
    function getTextContent(id, maxDepth = 3) {
        const node = virtualDOM[id];
        if (!node || maxDepth <= 0) return '';

        let text = '';

        // Get direct text
        if (node.text) text += node.text;
        if (node.textChildren) text += node.textChildren;

        // Search children for text
        Object.values(virtualDOM).forEach(child => {
            if (child.parentId === id) {
                text += ' ' + getTextContent(child.id, maxDepth - 1);
            }
        });

        return text.trim().replace(/\s+/g, ' ');
    }

    // Helper: Smart Label Resolver (Battles React Nesting)
    function resolveLabel(id, depth = 0) {
        const node = virtualDOM[id];
        if (!node) return `Unknown Element`;
        if (depth > 5) return node.tagName;

        // A. Get text content from this node or children
        const textContent = getTextContent(id, 3);
        if (textContent && textContent.length > 1 && textContent.length < 100) {
            const cleaned = textContent.substring(0, 40).trim();
            if (cleaned.length > 1) return `"${cleaned}${textContent.length > 40 ? '...' : ''}"`;
        }

        // B. Check for explicit attributes (Best for React)
        if (node.attributes['aria-label']) return `"${node.attributes['aria-label']}"`;
        if (node.attributes['title']) return `"${node.attributes['title']}"`;
        if (node.attributes['data-testid']) return `"${node.attributes['data-testid']}"`;
        if (node.attributes['placeholder']) return `"${node.attributes['placeholder']}" field`;
        if (node.attributes['name']) return `"${node.attributes['name']}" field`;
        if (node.attributes['alt']) return `"${node.attributes['alt']}" image`;

        // C. Parent Walking (The "Clicking an Icon inside a Button" fix)
        const boringTags = ['span', 'div', 'i', 'svg', 'path', 'g', 'b', 'strong', 'rect', 'circle'];
        if (boringTags.includes(node.tagName) && node.parentId) {
            return resolveLabel(node.parentId, depth + 1);
        }

        // D. Use id as fallback
        if (node.attributes['id']) return `"${node.attributes['id']}"`;

        // E. Fallback: CSS Class (skip hash-based classes)
        let label = node.tagName || 'element';
        if (node.attributes.class && typeof node.attributes.class === 'string') {
            const firstClass = node.attributes.class.split(' ')[0];
            if (firstClass && !firstClass.match(/^(css-|sc-|_)/)) {
                label += `.${firstClass}`;
            }
        }
        return label;
    }

    // Format timestamp as mm:ss.s
    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = (seconds % 60).toFixed(1);
        return `${mins}:${secs.padStart(4, '0')}`;
    }

    // --- MAIN PROCESSING ---
    const startTime = events[0].timestamp;
    const timeline = [];
    let lastClickLabel = '';
    let lastClickTime = 0;

    events.forEach(e => {
        const timeOffsetSec = (e.timestamp - startTime) / 1000;
        const timeStr = formatTime(timeOffsetSec);

        // --- TYPE 4: META (Viewport Size & Navigation) ---
        if (e.type === 4) {
            if (e.data.width && e.data.height) {
                timeline.push(`[${timeStr}] Viewport: ${e.data.width}x${e.data.height}`);
            }
            if (e.data.href) {
                timeline.push(`[${timeStr}] Navigated to: ${e.data.href}`);
            }
        }

        // --- TYPE 2: FULL SNAPSHOT ---
        else if (e.type === 2) {
            registerNode(e.data.node);
            timeline.push(`[${timeStr}] Page Loaded`);
        }

        // --- TYPE 3: INCREMENTAL MUTATIONS (Maintain Virtual DOM) ---
        else if (e.type === 3 && e.data.source === 0) {
            if (e.data.adds) e.data.adds.forEach(add => registerNode(add.node, add.parentId));
            if (e.data.removes) e.data.removes.forEach(rem => removeNode(rem.id));
            if (e.data.texts) {
                e.data.texts.forEach(txt => {
                    if (virtualDOM[txt.id]) {
                        virtualDOM[txt.id].text = txt.value;
                        const pId = virtualDOM[txt.id].parentId;
                        if (pId && virtualDOM[pId]) virtualDOM[pId].textChildren = txt.value;
                    }
                });
            }
        }

        // --- TYPE 3: USER INTERACTIONS ---

        // Mouse Up (Click)
        else if (e.type === 3 && e.data.source === 2 && e.data.type === 2) {
            const label = resolveLabel(e.data.id);
            if (label !== lastClickLabel || (timeOffsetSec - lastClickTime) > 0.3) {
                timeline.push(`[${timeStr}] Clicked: ${label}`);
                lastClickLabel = label;
                lastClickTime = timeOffsetSec;
            }
        }

        // Scroll
        else if (e.type === 3 && e.data.source === 3) {
            const lastLog = timeline[timeline.length - 1] || '';
            if (!lastLog.includes('Scrolled')) {
                timeline.push(`[${timeStr}] Scrolled`);
            }
        }

        // Input (Blur/Change)
        else if (e.type === 3 && e.data.source === 5) {
            const label = resolveLabel(e.data.id);
            if (e.data.text) {
                // Mask PII if enabled (default: true)
                const displayText = maskSensitiveData ? maskPII(e.data.text, label) : e.data.text;
                timeline.push(`[${timeStr}] Typed "${displayText}" in ${label}`);
            }
        }
    });

    // Build final output
    const durationSec = (events[events.length - 1].timestamp - startTime) / 1000;
    const header = `SESSION TIMELINE - Duration: ${formatTime(durationSec)}`;
    const separator = '='.repeat(60);
    const footer = `Total Events: ${events.length} | Actions Logged: ${timeline.length}`;

    return [
        separator,
        header,
        separator,
        ...timeline,
        separator,
        footer
    ].join('\n');
}

// Export for Worker usage
module.exports = { generateTimeline };

// CLI Support: node timeline-react-aware.js <input.json>
if (require.main === module) {
    const inputFile = process.argv[2] || 'recording.json';

    if (!fs.existsSync(inputFile)) {
        console.error(`Usage: node timeline-react-aware.js <events.json>`);
        console.error(`File not found: ${inputFile}`);
        process.exit(1);
    }

    try {
        const events = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
        const result = generateTimeline(events);
        console.log(result);
    } catch (err) {
        console.error('Error processing events:', err.message);
        process.exit(1);
    }
}
