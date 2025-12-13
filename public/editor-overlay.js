(function() {
  console.log("🎨 Visual Editor: GTM Mode v1.3");

  // Fix: Strip '/upload-session' from the base URL to get the root origin
  var RAW_URL = window.RRWEB_SERVER_URL || "http://localhost:3000";
  var SERVER_URL = RAW_URL.replace('/upload-session', '').replace(/\/$/, '');
  let isInspectMode = true;
  let activeElement = null;

  // --- UI SETUP ---
  const container = document.createElement('div');
  container.id = 'rrweb-visual-editor-root';
  document.body.appendChild(container);
  const shadow = container.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .highlighter {
      position: fixed;
      border: 2px solid #ef4444;
      background: rgba(239, 68, 68, 0.1);
      pointer-events: none;
      z-index: 2147483646;
      display: none;
      border-radius: 4px;
      transition: all 0.1s ease;
    }
    .control-bar {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #1f2937;
      color: white;
      padding: 8px 16px;
      border-radius: 30px;
      z-index: 2147483647;
      display: flex;
      gap: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      border: 1px solid #374151;
    }
    .toggle-btn {
      background: transparent;
      border: none;
      color: #9ca3af;
      padding: 6px 12px;
      border-radius: 20px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
    }
    .toggle-btn:hover:not(.active) { color: white; }
    .toggle-btn.active {
      background: white;
      color: #1f2937;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }

    /* GTM MENU STYLES */
    .editor-menu {
      position: fixed;
      background: white;
      color: #1f2937;
      padding: 0;
      border-radius: 12px;
      box-shadow: 0 20px 40px -5px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0,0,0,0.05);
      z-index: 2147483647;
      width: 360px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      border: 1px solid #e5e7eb;
      display: none;
      overflow: hidden;
    }
    .menu-header {
      background: linear-gradient(to right, #f9fafb, #f3f4f6);
      padding: 14px 16px;
      border-bottom: 1px solid #e5e7eb;
      font-weight: 700;
      font-size: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .menu-header-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .menu-close {
      cursor: pointer;
      color: #9ca3af;
      font-size: 18px;
      line-height: 1;
      padding: 4px;
      border-radius: 4px;
      transition: all 0.15s;
    }
    .menu-close:hover {
      background: #e5e7eb;
      color: #374151;
    }
    .menu-body {
      padding: 8px 0;
      max-height: 280px;
      overflow-y: auto;
    }

    .variable-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 10px 16px;
      border-bottom: 1px solid #f3f4f6;
      font-size: 13px;
      transition: background 0.15s;
    }
    .variable-row:hover {
      background: #fafafa;
    }
    .variable-row:last-child {
      border-bottom: none;
    }
    .variable-row input[type="checkbox"] {
      margin-top: 2px;
      cursor: pointer;
      width: 16px;
      height: 16px;
      accent-color: #3b82f6;
    }
    .var-details {
      flex: 1;
      min-width: 0;
    }
    .var-label {
      font-weight: 600;
      color: #6b7280;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .var-badge {
      font-size: 9px;
      padding: 2px 5px;
      border-radius: 3px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge-strong { background: #dcfce7; color: #166534; }
    .badge-good { background: #dbeafe; color: #1e40af; }
    .badge-weak { background: #fef3c7; color: #92400e; }

    .var-value {
      font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
      font-size: 12px;
      color: #111827;
      word-break: break-all;
      background: #f3f4f6;
      padding: 4px 8px;
      border-radius: 4px;
      display: block;
      max-height: 40px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .action-row {
      padding: 12px 16px;
      background: linear-gradient(to right, #f9fafb, #f3f4f6);
      border-top: 1px solid #e5e7eb;
    }
    .action-hint {
      font-size: 11px;
      color: #6b7280;
      margin-bottom: 10px;
      text-align: center;
    }
    .action-buttons {
      display: flex;
      gap: 8px;
    }
    button.action-btn {
      flex: 1;
      padding: 10px 8px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 12px;
      transition: all 0.15s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    button.action-btn:hover {
      transform: translateY(-1px);
    }
    button.action-btn .btn-icon {
      font-size: 16px;
    }
    .btn-step { background: #10b981; color: white; }
    .btn-step:hover { background: #059669; }
    .btn-start { background: #3b82f6; color: white; }
    .btn-start:hover { background: #2563eb; }
    .btn-stop { background: #ef4444; color: white; }
    .btn-stop:hover { background: #dc2626; }
  `;
  shadow.appendChild(style);

  const highlighter = document.createElement('div');
  highlighter.className = 'highlighter';
  shadow.appendChild(highlighter);

  const controlBar = document.createElement('div');
  controlBar.className = 'control-bar';
  controlBar.innerHTML = `
    <button id="mode-browse" class="toggle-btn">👆 Browse</button>
    <button id="mode-inspect" class="toggle-btn active">🎯 Inspect</button>
    <button id="mode-exit" class="toggle-btn" style="color:#ef4444;">✕ Exit</button>
  `;
  shadow.appendChild(controlBar);

  const menu = document.createElement('div');
  menu.className = 'editor-menu';
  shadow.appendChild(menu);

  // --- LOGIC: NORMALIZATION (The "Climb Up" Trick) ---
  // If user clicks an icon/span inside a button or link, target the interactive element
  function normalizeTarget(el) {
    const interactive = el.closest('a, button, [role="button"], input, select, textarea, [onclick]');
    return interactive || el;
  }

  // --- LOGIC: VARIABLE EXTRACTOR ---
  function extractVariables(el) {
    const vars = [];
    const normEl = normalizeTarget(el);

    // 1. Page Path (Always available)
    vars.push({
      id: 'path',
      label: 'Page URL Contains',
      type: 'PAGE_PATH',
      op: 'contains',
      val: window.location.pathname,
      checked: false, // Usually don't want to restrict to current page
      badge: 'good',
      badgeText: 'Context'
    });

    // 2. Click Text (Strong signal - survives class changes)
    const text = (normEl.innerText || normEl.textContent || "").trim();
    // Only use text if it's reasonably short and doesn't contain newlines
    if (text && text.length > 0 && text.length <= 80 && !text.includes('\n')) {
      vars.push({
        id: 'text',
        label: 'Click Text Equals',
        type: 'CLICK_TEXT',
        op: 'equals',
        val: text,
        checked: true, // Default: Check this
        badge: 'strong',
        badgeText: 'Stable'
      });
    }

    // 3. Click ID (Strongest signal if available)
    if (normEl.id) {
      vars.push({
        id: 'id',
        label: 'Element ID Equals',
        type: 'CLICK_ID',
        op: 'equals',
        val: '#' + normEl.id,
        checked: true, // Default: Check this
        badge: 'strong',
        badgeText: 'Best'
      });
    }

    // 4. Data attributes (Good for testing frameworks)
    const dataAttrs = ['data-testid', 'data-cy', 'data-test', 'data-action'];
    dataAttrs.forEach(attr => {
      if (normEl.getAttribute(attr)) {
        vars.push({
          id: 'attr-' + attr,
          label: attr + ' Equals',
          type: 'CLICK_ATTR',
          op: 'equals',
          val: `[${attr}="${normEl.getAttribute(attr)}"]`,
          attrName: attr,
          attrValue: normEl.getAttribute(attr),
          checked: false,
          badge: 'strong',
          badgeText: 'Test ID'
        });
      }
    });

    // 5. Href for links
    if (normEl.tagName === 'A' && normEl.getAttribute('href')) {
      vars.push({
        id: 'href',
        label: 'Link Href Contains',
        type: 'CLICK_HREF',
        op: 'contains',
        val: normEl.getAttribute('href'),
        checked: false,
        badge: 'good',
        badgeText: 'Link'
      });
    }

    // 6. CSS Selector (Fallback - filter out utility classes)
    let cssPath = normEl.tagName.toLowerCase();
    if (normEl.className && typeof normEl.className === 'string') {
      const utilityPatterns = /^(p|m|w|h|gap|flex|grid|border|bg|text|font|rounded|shadow|hover|focus|active|disabled|transition|duration|ease|transform|scale|rotate|translate|skew|origin|opacity|z|overflow|cursor|select|pointer|sr|whitespace|break|truncate|tracking|leading|list|decoration|underline|line|ring|outline|fill|stroke|inset|top|right|bottom|left|max|min|space|divide|place|items|content|justify|self|order|col|row|auto|span|start|end|hidden|block|inline|table|absolute|relative|fixed|sticky|static|float|clear|object|aspect|columns|container)-/;

      const cleanClasses = normEl.className.split(' ')
        .filter(c => c.trim().length > 0 && !c.includes(':') && !c.includes('/') && !utilityPatterns.test(c))
        .slice(0, 2)
        .join('.');

      if (cleanClasses) {
        cssPath += '.' + cleanClasses;
      }
    }

    vars.push({
      id: 'selector',
      label: 'CSS Selector Matches',
      type: 'CLICK_SELECTOR',
      op: 'matches',
      val: cssPath,
      checked: false, // Don't auto-check - prefer ID or Text
      badge: 'weak',
      badgeText: 'Fallback'
    });

    return vars;
  }

  // --- LOGIC: MENU UI ---
  let currentVariables = [];

  function showMenu(el) {
    currentVariables = extractVariables(el);

    const rowsHtml = currentVariables.map((v, i) => `
      <div class="variable-row">
        <input type="checkbox" id="chk-${i}" ${v.checked ? 'checked' : ''}>
        <div class="var-details">
          <div class="var-label">
            ${v.label}
            <span class="var-badge badge-${v.badge}">${v.badgeText}</span>
          </div>
          <div class="var-value" title="${v.val}">${v.val}</div>
        </div>
      </div>
    `).join('');

    menu.innerHTML = `
      <div class="menu-header">
        <div class="menu-header-title">
          <span>🎯</span>
          <span>Create Trigger Condition</span>
        </div>
        <span class="menu-close" id="btn-x">✕</span>
      </div>
      <div class="menu-body">
        ${rowsHtml}
      </div>
      <div class="action-row">
        <div class="action-hint">Select conditions above, then choose action:</div>
        <div class="action-buttons">
          <button class="action-btn btn-step" id="btn-step">
            <span class="btn-icon">📍</span>
            <span>Log Step</span>
          </button>
          <button class="action-btn btn-start" id="btn-start">
            <span class="btn-icon">▶️</span>
            <span>Start</span>
          </button>
          <button class="action-btn btn-stop" id="btn-stop">
            <span class="btn-icon">⏹️</span>
            <span>Stop</span>
          </button>
        </div>
      </div>
    `;

    // Positioning
    const rect = el.getBoundingClientRect();
    let top = rect.bottom + 10;
    if (top + 450 > window.innerHeight) {
      top = Math.max(10, rect.top - 450);
    }
    menu.style.display = 'block';
    menu.style.top = top + 'px';
    menu.style.left = Math.max(20, Math.min(rect.left, window.innerWidth - 380)) + 'px';

    // Update highlighter to blue
    highlighter.style.borderColor = '#3b82f6';
    highlighter.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';

    // Bind Actions
    shadow.getElementById('btn-x').onclick = closeMenu;

    const getSelectedConditions = () => {
      return currentVariables.filter((_, i) => {
        const chk = shadow.getElementById(`chk-${i}`);
        return chk && chk.checked;
      });
    };

    shadow.getElementById('btn-step').onclick = () => {
      const conds = getSelectedConditions();
      if (conds.length === 0) {
        alert("⚠️ Please select at least one condition.");
        return;
      }
      const key = prompt("Step Name (e.g., 'signup_clicked', 'added_to_cart'):", "custom_step");
      if (key && key.trim()) {
        saveRule('LOG_STEP', conds, key.trim());
      }
    };

    shadow.getElementById('btn-start').onclick = () => {
      const conds = getSelectedConditions();
      if (conds.length === 0) {
        alert("⚠️ Please select at least one condition.");
        return;
      }
      saveRule('START_RECORDING', conds);
    };

    shadow.getElementById('btn-stop').onclick = () => {
      const conds = getSelectedConditions();
      if (conds.length === 0) {
        alert("⚠️ Please select at least one condition.");
        return;
      }
      saveRule('STOP_RECORDING', conds);
    };
  }

  // --- SAVE LOGIC (JSON PAYLOAD) ---
  function saveRule(action, conditions, stepKey) {
    const params = new URLSearchParams(window.location.search);

    // Try URL params first, then fallback to globals/storage (persistence)
    let token = params.get('token');
    let campaignId = params.get('campaign_id');

    // Fallback to persistence if URL params are empty (after navigation)
    if (!token) {
      token = window.__RRWEB_EDITOR_TOKEN || sessionStorage.getItem("__rrweb_token");
    }
    if (!campaignId) {
      campaignId = window.__RRWEB_CAMPAIGN_ID || sessionStorage.getItem("__rrweb_campaign_id");
    }

    if (!token || !campaignId) {
      alert("❌ Session Lost.\n\nPlease close this tab and re-launch the Visual Editor from your Dashboard.");
      return;
    }

    // Construct the Composite Rule (GTM-style payload)
    const rulePayload = {
      operator: "AND",
      conditions: conditions.map(c => ({
        type: c.type,
        op: c.op,
        val: c.val
      }))
    };

    console.log("💾 Saving composite rule:", rulePayload);

    fetch(`${SERVER_URL}/api/projects/${token}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaign_id: parseInt(campaignId),
        trigger_type: 'CLICK_ELEMENT',
        selector: JSON.stringify(rulePayload), // Store as JSON string
        action_type: action,
        step_key: stepKey || null
      })
    })
    .then(res => {
      if (res.ok) {
        const condSummary = conditions.map(c => c.label.split(' ')[0]).join(' + ');
        alert(`✅ Rule Saved!\n\nConditions: ${condSummary}\nAction: ${action}${stepKey ? '\nStep: ' + stepKey : ''}`);
        closeMenu();
      } else {
        res.text().then(txt => alert("❌ Error saving rule: " + txt));
      }
    })
    .catch(err => {
      alert("❌ Network error: " + err.message);
    });
  }

  // --- EVENT LISTENERS ---
  document.addEventListener('mouseover', function(e) {
    if (!isInspectMode) return;
    if (menu.style.display === 'block') return;
    if (container.contains(e.target)) return;

    // Highlight the "smart" target (e.g., the button, not the span inside it)
    activeElement = normalizeTarget(e.target);

    const r = activeElement.getBoundingClientRect();
    highlighter.style.display = 'block';
    highlighter.style.top = r.top + 'px';
    highlighter.style.left = r.left + 'px';
    highlighter.style.width = r.width + 'px';
    highlighter.style.height = r.height + 'px';
  });

  document.addEventListener('click', function(e) {
    if (!isInspectMode) return;
    if (container.contains(e.target)) return;

    e.preventDefault();
    e.stopPropagation();
    showMenu(e.target);
  }, true);

  // Mode switching
  const btnBrowse = shadow.getElementById('mode-browse');
  const btnInspect = shadow.getElementById('mode-inspect');

  btnBrowse.onclick = () => {
    isInspectMode = false;
    btnBrowse.classList.add('active');
    btnInspect.classList.remove('active');
    highlighter.style.display = 'none';
    menu.style.display = 'none';
  };

  btnInspect.onclick = () => {
    isInspectMode = true;
    btnInspect.classList.add('active');
    btnBrowse.classList.remove('active');
  };

  // Exit button - clears editor mode and reloads
  const btnExit = shadow.getElementById('mode-exit');
  btnExit.onclick = () => {
    if (confirm("Exit Visual Editor?\n\nThis will end your editing session.")) {
      // Clear persistence
      sessionStorage.removeItem("__rrweb_editor_mode");
      sessionStorage.removeItem("__rrweb_token");
      sessionStorage.removeItem("__rrweb_campaign_id");
      // Reload without editor params
      window.location.href = window.location.pathname;
    }
  };

  function closeMenu() {
    menu.style.display = 'none';
    highlighter.style.display = 'none';
    // Reset highlighter color
    highlighter.style.borderColor = '#ef4444';
    highlighter.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
  }

})();
