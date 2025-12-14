(function() {
  console.log("🎨 Visual Editor: Advanced HUD v1.5");

  // --- 1. CONFIG & STATE ---
  var SERVER_URL = window.RRWEB_SERVER_URL || "http://localhost:3000";
  if (SERVER_URL.includes('/upload-session')) SERVER_URL = SERVER_URL.replace('/upload-session', '');
  if (SERVER_URL.endsWith('/')) SERVER_URL = SERVER_URL.slice(0, -1);

  let isInspectMode = true;
  let isHudMinimized = false;

  // Get Context
  const params = new URLSearchParams(window.location.search);
  const CAMPAIGN_ID = parseInt(params.get('campaign_id') || window.__RRWEB_CAMPAIGN_ID || sessionStorage.getItem("__rrweb_campaign_id"));
  const TOKEN = params.get('token') || window.__RRWEB_EDITOR_TOKEN || sessionStorage.getItem("__rrweb_token");

  if (!CAMPAIGN_ID || !TOKEN) console.warn("🎨 Missing Campaign ID or Token");

  // --- 2. UI SETUP ---
  const container = document.createElement('div');
  container.id = 'rrweb-visual-editor-root';
  document.body.appendChild(container);
  const shadow = container.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    /* SHARED FONTS */
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }

    /* HIGHLIGHTER */
    .highlighter {
      position: fixed; border: 2px solid #ef4444; background: rgba(239, 68, 68, 0.1);
      pointer-events: none; z-index: 2147483646; display: none; border-radius: 4px;
    }

    /* CONTROL BAR (Bottom) */
    .control-bar {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: #1f2937; color: white; padding: 8px 16px; border-radius: 30px;
      z-index: 2147483647; display: flex; gap: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .toggle-btn {
      background: transparent; border: none; color: #9ca3af; padding: 6px 12px;
      border-radius: 20px; cursor: pointer; font-weight: 600; font-size: 14px;
      transition: all 0.15s;
    }
    .toggle-btn:hover:not(.active) { color: white; }
    .toggle-btn.active { background: white; color: #1f2937; }

    /* HUD SIDEBAR (Top Left) */
    .campaign-hud {
      position: fixed; top: 20px; left: 20px; width: 280px;
      background: white; border-radius: 12px; border: 1px solid #e5e7eb;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);
      z-index: 2147483647; display: flex; flex-direction: column;
      max-height: 70vh; transition: all 0.2s ease;
      overflow: hidden;
    }
    .campaign-hud.minimized {
      width: 48px; height: 48px; border-radius: 50%;
      cursor: pointer;
    }
    .hud-header {
      padding: 12px 16px; background: linear-gradient(135deg, #1f2937, #374151);
      color: white; font-weight: 700; font-size: 13px;
      display: flex; justify-content: space-between; align-items: center;
      border-radius: 12px 12px 0 0;
    }
    .minimized .hud-header {
      padding: 0; justify-content: center; align-items: center;
      height: 100%; border-radius: 50%;
    }
    .hud-title { display: flex; align-items: center; gap: 8px; }
    .minimized .hud-title span:last-child { display: none; }

    .hud-controls { display: flex; gap: 8px; }
    .hud-controls span {
      cursor: pointer; padding: 4px 6px; font-size: 14px;
      border-radius: 4px; transition: background 0.15s;
    }
    .hud-controls span:hover { background: rgba(255,255,255,0.15); }
    .minimized .hud-controls { display: none; }

    .hud-content { overflow-y: auto; flex: 1; }
    .minimized .hud-content { display: none; }

    .hud-section { border-bottom: 1px solid #f3f4f6; }
    .hud-section:last-child { border-bottom: none; }
    .hud-label {
      font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;
      color: #9ca3af; padding: 10px 14px 6px 14px;
      display: flex; align-items: center; gap: 6px;
    }
    .hud-count {
      background: #e5e7eb; color: #374151; padding: 1px 6px;
      border-radius: 10px; font-size: 10px; font-weight: 700;
    }
    .hud-item {
      padding: 8px 14px; font-size: 12px; color: #374151;
      display: flex; align-items: center; gap: 10px;
      transition: background 0.15s;
    }
    .hud-item:hover { background: #f9fafb; }
    .hud-icon { width: 20px; text-align: center; font-size: 14px; }
    .hud-desc {
      flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-weight: 500;
    }
    .hud-empty {
      padding: 8px 14px; font-style: italic; color: #d1d5db; font-size: 11px;
    }
    .hud-loading, .hud-error {
      padding: 16px; text-align: center; font-size: 12px;
    }
    .hud-loading { color: #9ca3af; }
    .hud-error { color: #ef4444; background: #fef2f2; }

    /* MENU (The Popup) */
    .editor-menu {
      position: fixed; background: white; color: #1f2937; padding: 0;
      border-radius: 12px; box-shadow: 0 20px 40px -5px rgba(0, 0, 0, 0.25);
      z-index: 2147483648; width: 340px;
      border: 1px solid #e5e7eb; display: none; overflow: hidden;
    }
    .menu-header {
      padding: 14px 16px; background: linear-gradient(to right, #f9fafb, #f3f4f6);
      border-bottom: 1px solid #e5e7eb; font-weight: bold; font-size: 14px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .menu-close {
      cursor: pointer; color: #9ca3af; font-size: 18px; padding: 4px;
      border-radius: 4px; transition: all 0.15s;
    }
    .menu-close:hover { background: #e5e7eb; color: #374151; }
    .menu-body { padding: 8px 0; max-height: 280px; overflow-y: auto; }
    .variable-row {
      display: flex; align-items: flex-start; gap: 10px; padding: 10px 16px;
      border-bottom: 1px solid #f3f4f6; font-size: 12px;
      transition: background 0.15s;
    }
    .variable-row:hover { background: #fafafa; }
    .variable-row:last-child { border-bottom: none; }
    .variable-row input[type="checkbox"] {
      margin-top: 2px; cursor: pointer; width: 16px; height: 16px;
      accent-color: #3b82f6;
    }
    .var-details { flex: 1; min-width: 0; }
    .var-label {
      font-size: 10px; font-weight: 700; color: #6b7280;
      text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;
    }
    .var-val {
      font-family: "SF Mono", Monaco, monospace; font-size: 11px;
      background: #f3f4f6; padding: 4px 8px; border-radius: 4px;
      word-break: break-all; color: #111;
    }
    .config-section {
      padding: 12px 16px; border-top: 1px solid #e5e7eb;
      background: #fafbfc;
    }
    .config-group {
      margin-bottom: 12px;
    }
    .config-group:last-child {
      margin-bottom: 0;
    }
    .config-label {
      display: block; font-size: 11px; font-weight: 700;
      color: #374151; margin-bottom: 8px; text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .config-input {
      width: 100%; padding: 8px 10px; border: 1px solid #d1d5db;
      border-radius: 6px; font-size: 13px; font-family: inherit;
      transition: border-color 0.15s;
    }
    .config-input:focus {
      outline: none; border-color: #3b82f6;
    }
    .radio-group {
      display: flex; flex-direction: column; gap: 8px;
    }
    .radio-option {
      display: flex; align-items: center; gap: 8px; cursor: pointer;
      padding: 8px 10px; border-radius: 6px; transition: background 0.15s;
      font-size: 13px; color: #374151;
    }
    .radio-option:hover {
      background: #f3f4f6;
    }
    .radio-option input[type="radio"] {
      cursor: pointer; width: 16px; height: 16px; accent-color: #3b82f6;
    }
    .action-row {
      padding: 12px 16px; display: flex; gap: 8px;
      background: linear-gradient(to right, #f9fafb, #f3f4f6);
      border-top: 1px solid #e5e7eb;
    }
    button.action-btn {
      flex: 1; padding: 10px 8px; border: none; border-radius: 8px;
      cursor: pointer; font-weight: 600; font-size: 12px; color: white;
      transition: all 0.15s; display: flex; flex-direction: column;
      align-items: center; gap: 2px;
    }
    button.action-btn:hover { transform: translateY(-1px); }
    button.action-btn .btn-icon { font-size: 16px; }
    .btn-step { background: #10b981; }
    .btn-step:hover { background: #059669; }
    .btn-start { background: #3b82f6; }
    .btn-start:hover { background: #2563eb; }
    .btn-stop { background: #ef4444; }
    .btn-stop:hover { background: #dc2626; }
  `;
  shadow.appendChild(style);

  // --- 3. DOM ELEMENTS ---
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

  const hud = document.createElement('div');
  hud.className = 'campaign-hud';
  hud.innerHTML = `
    <div class="hud-header" id="hud-header">
      <div class="hud-title">
        <span>📊</span>
        <span>Campaign #${CAMPAIGN_ID || '?'}</span>
      </div>
      <div class="hud-controls">
        <span id="hud-refresh" title="Refresh">↻</span>
        <span id="hud-min" title="Minimize">−</span>
      </div>
    </div>
    <div class="hud-content" id="hud-list">
      <div class="hud-loading">Loading rules...</div>
    </div>
  `;
  shadow.appendChild(hud);

  // --- 4. HUD LOGIC (Minimize & Fetch) ---

  // Toggle Minimize
  const toggleHud = () => {
    isHudMinimized = !isHudMinimized;
    if (isHudMinimized) {
      hud.classList.add('minimized');
    } else {
      hud.classList.remove('minimized');
    }
  };
  shadow.getElementById('hud-min').onclick = (e) => {
    e.stopPropagation();
    toggleHud();
  };
  shadow.getElementById('hud-header').onclick = (e) => {
    if (isHudMinimized) toggleHud();
  };

  // Fetch Logic
  function fetchCampaignState() {
    if (!TOKEN || !CAMPAIGN_ID) {
      shadow.getElementById('hud-list').innerHTML = `<div class="hud-error">Missing token or campaign ID</div>`;
      return;
    }

    shadow.getElementById('hud-list').innerHTML = `<div class="hud-loading">Loading...</div>`;

    fetch(`${SERVER_URL}/api/projects/${TOKEN}/config`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then(data => {
        const allRules = data.rules || [];
        const myRules = allRules.filter(r => r.campaign_id === CAMPAIGN_ID);
        renderHud(myRules);
      })
      .catch(err => {
        console.error('HUD fetch error:', err);
        shadow.getElementById('hud-list').innerHTML = `<div class="hud-error">Connection Failed</div>`;
      });
  }

  function renderHud(rules) {
    const list = shadow.getElementById('hud-list');
    list.innerHTML = '';

    const starts = rules.filter(r => r.action_type === 'START_RECORDING');
    const steps = rules.filter(r => r.action_type === 'LOG_STEP');
    const stops = rules.filter(r => r.action_type === 'STOP_RECORDING');

    // Helper to parse selector into readable description
    function describeSelector(selector) {
      try {
        const parsed = JSON.parse(selector);
        if (parsed.conditions && Array.isArray(parsed.conditions)) {
          const parts = parsed.conditions
            .map(c => {
              if (c.type === 'CLICK_TEXT') return `"${c.val}"`;
              if (c.type === 'CLICK_ID') return c.val;
              if (c.type === 'PAGE_PATH') return `on ${c.val}`;
              if (c.type === 'CLICK_HREF') return `href:${c.val}`;
              return c.val;
            });
          return parts.join(' + ') || 'Page View';
        }
      } catch (e) {}
      return selector;
    }

    const renderSection = (title, items, icon, emptyMsg) => {
      let html = `<div class="hud-section">
        <div class="hud-label">
          <span>${title}</span>
          <span class="hud-count">${items.length}</span>
        </div>`;

      if (items.length === 0) {
        html += `<div class="hud-empty">${emptyMsg}</div>`;
      } else {
        items.forEach((item, idx) => {
          let desc = describeSelector(item.selector);

          // For steps, show the step key as primary
          if (item.action_type === 'LOG_STEP') {
            desc = item.step_key;
          }

          const itemIcon = item.action_type === 'LOG_STEP' ? `${idx + 1}.` : icon;

          html += `
            <div class="hud-item" title="${item.selector}">
              <span class="hud-icon">${itemIcon}</span>
              <span class="hud-desc">${desc}</span>
            </div>`;
        });
      }

      html += `</div>`;
      return html;
    };

    list.innerHTML += renderSection('Start Triggers', starts, '▶️', 'No start trigger');
    list.innerHTML += renderSection('Funnel Steps', steps, '📍', 'No steps defined');
    list.innerHTML += renderSection('Stop Triggers', stops, '⏹️', 'Manual stop only');
  }

  // Initial Load
  fetchCampaignState();
  shadow.getElementById('hud-refresh').onclick = (e) => {
    e.stopPropagation();
    fetchCampaignState();
  };


  // --- 5. SELECTOR & MENU LOGIC (GTM Style) ---

  function normalizeTarget(el) {
    return el.closest('a, button, [role="button"], input, select, textarea, [onclick]') || el;
  }

  function extractVariables(el) {
    const vars = [];
    const normEl = normalizeTarget(el);

    // Page Path
    vars.push({
      label: 'Page URL Contains',
      type: 'PAGE_PATH',
      op: 'contains',
      val: window.location.pathname,
      checked: false
    });

    // Click Text
    const text = (normEl.innerText || normEl.textContent || "").trim();
    if (text && text.length <= 80 && !text.includes('\n')) {
      vars.push({
        label: 'Click Text Equals',
        type: 'CLICK_TEXT',
        op: 'equals',
        val: text,
        checked: true
      });
    }

    // Click ID
    if (normEl.id) {
      vars.push({
        label: 'Element ID Equals',
        type: 'CLICK_ID',
        op: 'equals',
        val: '#' + normEl.id,
        checked: true
      });
    }

    // Href for links
    if (normEl.tagName === 'A' && normEl.getAttribute('href')) {
      vars.push({
        label: 'Link Href Contains',
        type: 'CLICK_HREF',
        op: 'contains',
        val: normEl.getAttribute('href'),
        checked: false
      });
    }

    return vars;
  }

  let currentVariables = [];

  function showMenu(el) {
    currentVariables = extractVariables(el);

    if (currentVariables.length === 0) {
      alert("No selectable attributes found on this element.");
      return;
    }

    const rows = currentVariables.map((v, i) => `
      <div class="variable-row">
        <input type="checkbox" id="chk-${i}" ${v.checked ? 'checked' : ''}>
        <div class="var-details">
          <div class="var-label">${v.label}</div>
          <div class="var-val">${v.val}</div>
        </div>
      </div>`).join('');

    menu.innerHTML = `
      <div class="menu-header">
        <span>🎯 Create Rule</span>
        <span class="menu-close" id="btn-x">✕</span>
      </div>
      <div class="menu-body">${rows}</div>
      <div class="config-section">
        <div class="config-group" id="config-timeout" style="display:none;">
          <label class="config-label">⏱️ Recording Timeout (optional)</label>
          <input type="number" id="input-timeout" class="config-input" placeholder="Minutes (e.g., 20)" min="0" step="1">
        </div>
        <div class="config-group" id="config-status" style="display:none;">
          <label class="config-label">✅ Mark Session As</label>
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="status" value="completed" id="radio-completed">
              <span>Completed</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="status" value="dropped_off" id="radio-dropped">
              <span>Dropped Off</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="status" value="" id="radio-none" checked>
              <span>None</span>
            </label>
          </div>
        </div>
      </div>
      <div class="action-row">
        <button class="action-btn btn-step" id="btn-step">
          <span class="btn-icon">📍</span>
          <span>Step</span>
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
    `;

    // Position
    const rect = el.getBoundingClientRect();
    let top = rect.bottom + 10;
    if (top + 400 > window.innerHeight) top = Math.max(10, rect.top - 400);
    menu.style.display = 'block';
    menu.style.top = top + 'px';
    menu.style.left = Math.max(20, Math.min(rect.left, window.innerWidth - 360)) + 'px';

    // Update highlighter color
    highlighter.style.borderColor = '#3b82f6';
    highlighter.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';

    // Bindings
    shadow.getElementById('btn-x').onclick = closeMenu;

    const getConds = () => currentVariables.filter((_, i) => {
      const chk = shadow.getElementById(`chk-${i}`);
      return chk && chk.checked;
    });

    // Show/hide config sections on button hover
    const configTimeout = shadow.getElementById('config-timeout');
    const configStatus = shadow.getElementById('config-status');
    const btnStep = shadow.getElementById('btn-step');
    const btnStart = shadow.getElementById('btn-start');
    const btnStop = shadow.getElementById('btn-stop');

    btnStep.onmouseenter = () => {
      configTimeout.style.display = 'none';
      configStatus.style.display = 'none';
    };
    btnStart.onmouseenter = () => {
      configTimeout.style.display = 'block';
      configStatus.style.display = 'none';
    };
    btnStop.onmouseenter = () => {
      configTimeout.style.display = 'none';
      configStatus.style.display = 'block';
    };

    btnStep.onclick = () => {
      const c = getConds();
      if (!c.length) return alert("Select at least one condition");
      const k = prompt("Step Name (e.g., 'signup_click', 'add_to_cart'):");
      if (k && k.trim()) saveRule('LOG_STEP', c, k.trim());
    };

    btnStart.onclick = () => {
      const c = getConds();
      if (!c.length) return alert("Select at least one condition");

      // Read timeout from input
      const timeoutInput = shadow.getElementById('input-timeout').value;
      let timeoutMs = null;
      if (timeoutInput && timeoutInput.trim()) {
        const minutes = parseFloat(timeoutInput.trim());
        if (!isNaN(minutes) && minutes > 0) {
          timeoutMs = Math.floor(minutes * 60 * 1000);
        }
      }

      saveRule('START_RECORDING', c, null, timeoutMs);
    };

    btnStop.onclick = () => {
      const c = getConds();
      if (!c.length) return alert("Select at least one condition");

      // Read status from radio buttons
      const selectedRadio = shadow.querySelector('input[name="status"]:checked');
      const completionStatus = selectedRadio && selectedRadio.value ? selectedRadio.value : null;

      saveRule('STOP_RECORDING', c, null, null, completionStatus);
    };
  }

  function saveRule(action, conditions, key, timeoutMs, completionStatus) {
    if (!TOKEN || !CAMPAIGN_ID) {
      alert("Session Lost. Please close and relaunch the Visual Editor.");
      return;
    }

    const rulePayload = {
      operator: "AND",
      conditions: conditions.map(c => ({ type: c.type, op: c.op, val: c.val }))
    };

    console.log("💾 Saving rule:", action, rulePayload);

    const payload = {
      campaign_id: CAMPAIGN_ID,
      trigger_type: 'CLICK_ELEMENT',
      selector: JSON.stringify(rulePayload),
      action_type: action,
      step_key: key || null,
      timeout_ms: timeoutMs || null,
      completion_status: completionStatus || null
    };

    fetch(`${SERVER_URL}/api/projects/${TOKEN}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => {
      if (r.ok) {
        closeMenu();
        fetchCampaignState(); // UPDATE THE HUD INSTANTLY
      } else {
        r.text().then(t => alert("Error: " + t));
      }
    }).catch(err => {
      alert("Network error: " + err.message);
    });
  }

  // --- 6. LISTENERS ---
  const btnBrowse = shadow.getElementById('mode-browse');
  const btnInspect = shadow.getElementById('mode-inspect');
  const btnExit = shadow.getElementById('mode-exit');

  const setMode = (mode) => {
    isInspectMode = (mode === 'inspect');
    if (isInspectMode) {
      btnInspect.classList.add('active');
      btnBrowse.classList.remove('active');
    } else {
      btnBrowse.classList.add('active');
      btnInspect.classList.remove('active');
      highlighter.style.display = 'none';
      menu.style.display = 'none';
    }
  };

  btnBrowse.onclick = () => setMode('browse');
  btnInspect.onclick = () => setMode('inspect');

  // Exit button
  btnExit.onclick = () => {
    if (confirm("Exit Visual Editor?\n\nThis will end your editing session.")) {
      sessionStorage.removeItem("__rrweb_editor_mode");
      sessionStorage.removeItem("__rrweb_token");
      sessionStorage.removeItem("__rrweb_campaign_id");
      window.location.href = window.location.pathname;
    }
  };

  document.addEventListener('mouseover', e => {
    if (!isInspectMode || menu.style.display === 'block' || container.contains(e.target)) return;
    const el = normalizeTarget(e.target);
    const r = el.getBoundingClientRect();
    highlighter.style.display = 'block';
    highlighter.style.top = r.top + 'px';
    highlighter.style.left = r.left + 'px';
    highlighter.style.width = r.width + 'px';
    highlighter.style.height = r.height + 'px';
  });

  document.addEventListener('click', e => {
    if (!isInspectMode || container.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    showMenu(e.target);
  }, true);

  function closeMenu() {
    menu.style.display = 'none';
    highlighter.style.display = 'none';
    highlighter.style.borderColor = '#ef4444';
    highlighter.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
  }

})();
