(function() {
  console.log("🎨 Visual Editor Loaded (Advanced)");

  // --- 1. CONFIGURATION ---
  var SERVER_URL = window.RRWEB_SERVER_URL || "http://localhost:3000";

  // --- 2. STATE ---
  let isInspectMode = true;
  let activeElement = null;
  let currentSelector = "";

  // --- 3. UI SETUP (Shadow DOM) ---
  const container = document.createElement('div');
  container.id = 'rrweb-visual-editor-root';
  document.body.appendChild(container);

  const shadow = container.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    /* HIGHLIGHTER */
    .highlighter {
      position: fixed;
      border: 2px solid #ef4444;
      background: rgba(239, 68, 68, 0.1);
      pointer-events: none;
      z-index: 2147483646;
      transition: all 0.1s ease;
      border-radius: 4px;
      display: none;
    }

    /* CONTROL BAR (Bottom Center) */
    .control-bar {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #1f2937;
      color: white;
      padding: 8px 16px;
      border-radius: 9999px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      z-index: 2147483647;
      display: flex;
      gap: 12px;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
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
    .toggle-btn.active {
      background: white;
      color: #1f2937;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    .toggle-btn:hover:not(.active) { color: white; }

    /* STRATEGY PICKER MENU */
    .editor-menu {
      position: fixed;
      background: white;
      color: #1f2937;
      padding: 16px;
      border-radius: 12px;
      box-shadow: 0 20px 40px -5px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0,0,0,0.05);
      z-index: 2147483647;
      width: 340px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      border: 1px solid #e5e7eb;
      display: none;
    }
    .menu-header {
      font-weight: 700;
      font-size: 14px;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid #f3f4f6;
      color: #111827;
    }

    /* STRATEGY OPTIONS */
    .strategy-list {
      max-height: 220px;
      overflow-y: auto;
      margin-bottom: 12px;
    }
    .strategy-option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      margin-bottom: 6px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.15s ease;
      background: #fafafa;
    }
    .strategy-option:hover {
      background: #f3f4f6;
      border-color: #d1d5db;
    }
    .strategy-option.selected {
      border-color: #3b82f6;
      background: #eff6ff;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
    }
    .strategy-tag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 4px 8px;
      border-radius: 4px;
      min-width: 42px;
      color: white;
    }
    .tag-id { background: #10b981; }
    .tag-txt { background: #8b5cf6; }
    .tag-attr { background: #f59e0b; }
    .tag-link { background: #3b82f6; }
    .tag-cls { background: #6b7280; }
    .tag-path { background: #9ca3af; }

    .strategy-val {
      font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
      font-size: 12px;
      color: #374151;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .strategy-hint {
      font-size: 10px;
      color: #9ca3af;
      margin-left: auto;
      flex-shrink: 0;
    }

    /* ACTION BUTTONS */
    .action-section {
      border-top: 1px solid #f3f4f6;
      padding-top: 12px;
    }
    .action-label {
      font-size: 11px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .action-buttons {
      display: flex;
      gap: 8px;
    }
    button.action-btn {
      flex: 1;
      padding: 10px 12px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 12px;
      transition: all 0.15s ease;
    }
    button.action-btn:hover {
      transform: translateY(-1px);
    }
    .btn-start { background: #3b82f6; color: white; }
    .btn-start:hover { background: #2563eb; }
    .btn-step { background: #10b981; color: white; }
    .btn-step:hover { background: #059669; }
    .btn-stop { background: #ef4444; color: white; }
    .btn-stop:hover { background: #dc2626; }

    button.btn-cancel {
      width: 100%;
      padding: 10px;
      margin-top: 10px;
      background: white;
      color: #6b7280;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
      font-size: 13px;
    }
    button.btn-cancel:hover {
      background: #f9fafb;
      border-color: #d1d5db;
    }
  `;
  shadow.appendChild(style);

  // --- ELEMENTS ---

  // 1. Highlighter
  const highlighter = document.createElement('div');
  highlighter.className = 'highlighter';
  shadow.appendChild(highlighter);

  // 2. Control Bar
  const controlBar = document.createElement('div');
  controlBar.className = 'control-bar';
  controlBar.innerHTML = `
    <button id="mode-browse" class="toggle-btn">👆 Browse</button>
    <button id="mode-inspect" class="toggle-btn active">🎯 Inspect</button>
  `;
  shadow.appendChild(controlBar);

  // 3. Strategy Menu
  const menu = document.createElement('div');
  menu.className = 'editor-menu';
  shadow.appendChild(menu);

  // --- LOGIC: MODE SWITCHING ---
  const btnBrowse = shadow.getElementById('mode-browse');
  const btnInspect = shadow.getElementById('mode-inspect');

  function setMode(mode) {
    if (mode === 'inspect') {
      isInspectMode = true;
      btnInspect.classList.add('active');
      btnBrowse.classList.remove('active');
      highlighter.style.display = 'none';
    } else {
      isInspectMode = false;
      btnBrowse.classList.add('active');
      btnInspect.classList.remove('active');
      highlighter.style.display = 'none';
      menu.style.display = 'none';
    }
  }

  btnBrowse.onclick = () => setMode('browse');
  btnInspect.onclick = () => setMode('inspect');

  // --- LOGIC: GENERATE SELECTOR STRATEGIES ---
  function generateStrategies(el) {
    const strategies = [];

    // 1. ID (Best - Most Stable)
    if (el.id) {
      strategies.push({
        type: 'ID',
        value: '#' + el.id,
        hint: 'Best'
      });
    }

    // 2. TEXT (User Favorite - Works even if classes change)
    const text = el.innerText ? el.innerText.trim().slice(0, 40) : "";
    if (text && text.length > 0 && !text.includes('\n')) {
      strategies.push({
        type: 'TXT',
        value: `text="${text}"`,
        hint: 'Stable'
      });
    }

    // 3. LINK (href for anchor tags)
    if (el.tagName === 'A' && el.getAttribute('href')) {
      const href = el.getAttribute('href');
      strategies.push({
        type: 'LINK',
        value: `href="${href}"`,
        hint: 'Good'
      });
    }

    // 4. ATTRIBUTES (data-testid, name, aria-label, etc.)
    const attrPriority = ['data-testid', 'data-cy', 'data-test', 'name', 'aria-label', 'placeholder', 'type'];
    attrPriority.forEach(attr => {
      if (el.getAttribute(attr)) {
        strategies.push({
          type: 'ATTR',
          value: `[${attr}="${el.getAttribute(attr)}"]`,
          hint: 'Good'
        });
      }
    });

    // 5. CLEAN CLASSES (Filter out Tailwind/utility garbage)
    if (el.className && typeof el.className === 'string') {
      const utilityPatterns = /^(p|m|w|h|gap|flex|grid|border|bg|text|font|rounded|shadow|hover|focus|active|disabled|transition|duration|ease|transform|scale|rotate|translate|skew|origin|opacity|z|overflow|cursor|select|pointer|sr|whitespace|break|truncate|tracking|leading|list|decoration|underline|line|ring|outline|fill|stroke|inset|top|right|bottom|left|max|min|space|divide|place|items|content|justify|self|order|col|row|auto|span|start|end|hidden|block|inline|table|absolute|relative|fixed|sticky|static|float|clear|object|aspect|columns|container)-/;

      const meaningfulClasses = el.className.split(' ')
        .filter(c => c.trim().length > 0 && !c.includes(':') && !c.includes('/') && !utilityPatterns.test(c))
        .slice(0, 2) // Max 2 classes
        .join('.');

      if (meaningfulClasses.length > 0) {
        strategies.push({
          type: 'CLS',
          value: '.' + meaningfulClasses,
          hint: 'OK'
        });
      }
    }

    // 6. PATH (Fallback - Least stable)
    const tagName = el.tagName.toLowerCase();
    let pathSelector = tagName;

    // Add some context from parent if available
    if (el.parentElement && el.parentElement.tagName !== 'BODY') {
      const parentTag = el.parentElement.tagName.toLowerCase();
      if (el.parentElement.id) {
        pathSelector = '#' + el.parentElement.id + ' > ' + tagName;
      } else if (parentTag !== 'div' && parentTag !== 'span') {
        pathSelector = parentTag + ' > ' + tagName;
      }
    }

    strategies.push({
      type: 'PATH',
      value: pathSelector,
      hint: 'Fallback'
    });

    return strategies;
  }

  // --- LOGIC: SHOW STRATEGY MENU ---
  function showMenu(el) {
    const strategies = generateStrategies(el);
    currentSelector = strategies[0].value; // Default to best option

    // Build strategy options HTML
    const getTagClass = (type) => {
      const classes = { ID: 'tag-id', TXT: 'tag-txt', ATTR: 'tag-attr', LINK: 'tag-link', CLS: 'tag-cls', PATH: 'tag-path' };
      return classes[type] || 'tag-path';
    };

    const optionsHtml = strategies.map((s, i) => `
      <div class="strategy-option ${i === 0 ? 'selected' : ''}" data-value="${s.value.replace(/"/g, '&quot;')}">
        <span class="strategy-tag ${getTagClass(s.type)}">${s.type}</span>
        <span class="strategy-val" title="${s.value.replace(/"/g, '&quot;')}">${s.value}</span>
        <span class="strategy-hint">${s.hint}</span>
      </div>
    `).join('');

    menu.innerHTML = `
      <div class="menu-header">🎯 Choose Element Selector</div>
      <div class="strategy-list">${optionsHtml}</div>

      <div class="action-section">
        <div class="action-label">When clicked:</div>
        <div class="action-buttons">
          <button class="action-btn btn-start" id="btn-start">▶ Start</button>
          <button class="action-btn btn-step" id="btn-step">📍 Step</button>
          <button class="action-btn btn-stop" id="btn-stop">⏹ Stop</button>
        </div>
      </div>
      <button class="btn-cancel" id="btn-cancel">Cancel</button>
    `;

    // Position menu near the element
    const rect = el.getBoundingClientRect();
    let top = rect.bottom + 10;
    if (top + 380 > window.innerHeight) {
      top = Math.max(10, rect.top - 380);
    }

    menu.style.display = 'block';
    menu.style.top = top + 'px';
    menu.style.left = Math.max(10, Math.min(rect.left, window.innerWidth - 360)) + 'px';

    // Update highlighter color to blue (selected)
    highlighter.style.borderColor = '#3b82f6';
    highlighter.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';

    // --- Bind Strategy Selection ---
    shadow.querySelectorAll('.strategy-option').forEach(option => {
      option.onclick = function() {
        shadow.querySelectorAll('.strategy-option').forEach(o => o.classList.remove('selected'));
        this.classList.add('selected');
        currentSelector = this.getAttribute('data-value');
      };
    });

    // --- Bind Action Buttons ---
    shadow.getElementById('btn-cancel').onclick = closeMenu;

    shadow.getElementById('btn-start').onclick = () => {
      saveRule('START_RECORDING', currentSelector);
    };

    shadow.getElementById('btn-stop').onclick = () => {
      saveRule('STOP_RECORDING', currentSelector);
    };

    shadow.getElementById('btn-step').onclick = () => {
      const key = prompt("Step Name (e.g. 'signup_clicked', 'added_to_cart'):");
      if (key && key.trim()) {
        saveRule('LOG_STEP', currentSelector, key.trim());
      }
    };
  }

  function closeMenu() {
    menu.style.display = 'none';
    if (isInspectMode) {
      highlighter.style.borderColor = '#ef4444';
      highlighter.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
    }
    highlighter.style.display = 'none';
  }

  // --- EVENT LISTENERS ---
  document.addEventListener('mouseover', function(e) {
    if (!isInspectMode) return;
    if (menu.style.display === 'block') return;
    if (e.target === container || container.contains(e.target)) return;

    activeElement = e.target;
    const rect = activeElement.getBoundingClientRect();

    highlighter.style.display = 'block';
    highlighter.style.top = rect.top + 'px';
    highlighter.style.left = rect.left + 'px';
    highlighter.style.width = rect.width + 'px';
    highlighter.style.height = rect.height + 'px';
  });

  document.addEventListener('click', function(e) {
    if (e.target === container || container.contains(e.target)) return;
    if (!isInspectMode) return;

    e.preventDefault();
    e.stopPropagation();

    showMenu(e.target);
  }, true);

  // --- SAVE LOGIC ---
  function saveRule(actionType, selector, stepKey = null) {
    const urlParams = new URLSearchParams(window.location.search);
    const domainToken = urlParams.get('token');
    const campaignId = urlParams.get('campaign_id');

    if (!domainToken || !campaignId) {
      alert("Error: Missing token or campaign_id in URL.\n\nExpected format:\n?__editor_mode=true&token=YOUR_TOKEN&campaign_id=123");
      return;
    }

    console.log("💾 Saving rule:", { actionType, selector, stepKey, campaignId });

    fetch(`${SERVER_URL}/api/projects/${domainToken}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaign_id: parseInt(campaignId),
        trigger_type: 'CLICK_ELEMENT',
        selector: selector,
        action_type: actionType,
        step_key: stepKey
      })
    })
    .then(res => {
      if (res.ok) {
        alert("✅ Rule Saved!\n\nSelector: " + selector + "\nAction: " + actionType + (stepKey ? "\nStep: " + stepKey : ""));
        closeMenu();
      } else {
        res.text().then(txt => alert("❌ Error saving rule: " + txt));
      }
    })
    .catch(err => {
      alert("❌ Network error: " + err.message);
    });
  }
})();
