(function() {
  console.log("🎨 Visual Editor Loaded");

  // --- 1. CONFIGURATION ---
  var SERVER_URL = window.RRWEB_SERVER_URL || "http://localhost:3000";

  // --- 2. STATE ---
  let isInspectMode = true; // Default to Inspect logic
  let activeElement = null;

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
      font-family: sans-serif;
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

    /* CONTEXT MENU */
    .editor-menu {
      position: fixed;
      background: white;
      color: #1f2937;
      padding: 16px;
      border-radius: 8px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
      z-index: 2147483647;
      width: 280px;
      font-family: sans-serif;
      border: 1px solid #e5e7eb;
      display: none;
    }
    .menu-header { font-weight: 700; margin-bottom: 8px; }
    .selector-badge {
      background: #f3f4f6; padding: 4px 8px;
      border-radius: 4px; font-family: monospace; font-size: 11px;
      color: #4b5563; word-break: break-all; margin-bottom: 12px;
      border: 1px solid #e5e7eb;
    }
    button.action-btn {
      width: 100%; padding: 10px; margin-top: 8px;
      border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;
    }
    .btn-start { background: #3b82f6; color: white; }
    .btn-step { background: #10b981; color: white; }
    .btn-stop { background: #ef4444; color: white; }
    .btn-cancel { background: white; color: #6b7280; border: 1px solid #d1d5db; margin-top: 12px; }
  `;
  shadow.appendChild(style);

  // --- ELEMENTS ---

  // 1. Highlighter
  const highlighter = document.createElement('div');
  highlighter.className = 'highlighter';
  shadow.appendChild(highlighter);

  // 2. Control Bar (The Toggle)
  const controlBar = document.createElement('div');
  controlBar.className = 'control-bar';
  controlBar.innerHTML = `
    <button id="mode-browse" class="toggle-btn">Browse</button>
    <button id="mode-inspect" class="toggle-btn active">Inspect</button>
  `;
  shadow.appendChild(controlBar);

  // 3. Menu
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
      highlighter.style.display = 'none'; // Will reappear on mouseover
    } else {
      isInspectMode = false;
      btnBrowse.classList.add('active');
      btnInspect.classList.remove('active');
      highlighter.style.display = 'none'; // Hide immediately
      menu.style.display = 'none'; // Hide menu if open
    }
  }

  btnBrowse.onclick = () => setMode('browse');
  btnInspect.onclick = () => setMode('inspect');

  // --- LOGIC: SELECTOR GENERATOR ---
  function getCssSelector(el) {
    if (el.id) return '#' + el.id;
    if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
    let selector = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.split(' ')
        .filter(c => c.trim().length > 0 && !c.includes(':') && !c.includes('/'))
        .join('.');
      if (classes) selector += '.' + classes;
    }
    if (el.tagName === 'A' && el.getAttribute('href')) {
      const href = el.getAttribute('href');
      if (href.startsWith('/')) selector += `[href="${href}"]`;
    }
    return selector;
  }

  // --- EVENT LISTENERS ---

  document.addEventListener('mouseover', function(e) {
    // 1. Check if we should ignore this event
    if (!isInspectMode) return; // Don't highlight in Browse Mode
    if (menu.style.display === 'block') return; // Freeze if menu is open
    if (e.target === container) return; // Ignore self

    activeElement = e.target;
    const rect = activeElement.getBoundingClientRect();

    highlighter.style.display = 'block';
    highlighter.style.top = rect.top + 'px';
    highlighter.style.left = rect.left + 'px';
    highlighter.style.width = rect.width + 'px';
    highlighter.style.height = rect.height + 'px';
  });

  document.addEventListener('click', function(e) {
    // 1. If clicking inside our UI, let it pass
    if (e.target === container || container.contains(e.target)) return;

    // 2. If in Browse Mode, DO NOTHING (Let the click happen!)
    if (!isInspectMode) return;

    // 3. If in Inspect Mode, Block & Show Menu
    e.preventDefault();
    e.stopPropagation();

    const selector = getCssSelector(e.target);
    showMenu(selector);
  }, true);

  // --- MENU LOGIC ---
  function showMenu(selector) {
    highlighter.style.borderColor = '#3b82f6';
    highlighter.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';

    menu.innerHTML = `
      <div class="menu-header">Create Rule</div>
      <div class="selector-badge">${selector}</div>
      <button class="action-btn btn-start" id="btn-start">Start Recording</button>
      <button class="action-btn btn-step" id="btn-step">Log Funnel Step</button>
      <button class="action-btn btn-stop" id="btn-stop">Stop Recording</button>
      <button class="action-btn btn-cancel" id="btn-cancel">Cancel</button>
    `;

    // Position menu near the click, but keep it on screen
    const rect = activeElement.getBoundingClientRect();
    let top = rect.bottom + 10;
    if (top + 300 > window.innerHeight) top = rect.top - 300; // Flip up if near bottom

    menu.style.display = 'block';
    menu.style.top = top + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px'; // Prevent overflow right

    shadow.getElementById('btn-cancel').onclick = closeMenu;
    shadow.getElementById('btn-start').onclick = () => saveRule('START_RECORDING', selector);
    shadow.getElementById('btn-stop').onclick = () => saveRule('STOP_RECORDING', selector);
    shadow.getElementById('btn-step').onclick = () => {
      const key = prompt("Step Name (e.g. 'signup_clicked'):");
      if (key) saveRule('LOG_STEP', selector, key);
    };
  }

  function closeMenu() {
    menu.style.display = 'none';
    if (isInspectMode) {
        highlighter.style.borderColor = '#ef4444';
        highlighter.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
    }
  }

  // --- SAVE LOGIC ---
  function saveRule(actionType, selector, stepKey = null) {
    const urlParams = new URLSearchParams(window.location.search);
    const domainToken = urlParams.get('token');
    const campaignId = urlParams.get('campaign_id');

    if (!domainToken || !campaignId) {
      alert("Error: Missing token or campaign_id.");
      return;
    }

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
        alert("Rule Saved!");
        closeMenu();
      } else {
        res.text().then(txt => alert("Error: " + txt));
      }
    });
  }
})();
