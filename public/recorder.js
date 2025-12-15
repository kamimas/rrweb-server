// public/recorder.js - DIRECT S3 UPLOAD VERSION
(function() {
  "use strict";

  var VERSION = "2.0.0-direct-upload";
  window.RRWEB_RECORDER_VERSION = VERSION;

  var DOMAIN_TOKEN = document.currentScript.getAttribute("data-domain-key");
  if (!DOMAIN_TOKEN) {
    return;
  }

  // Check for Editor Mode (with persistence across page navigation)
  var urlParams = new URLSearchParams(window.location.search);
  var isEditorUrl = urlParams.get("__editor_mode") === "true";
  var storedEditorMode = sessionStorage.getItem("__rrweb_editor_mode");

  var isEditorMode = false;
  var editorToken = null;
  var campaignId = null;

  if (isEditorUrl) {
    isEditorMode = true;
    editorToken = urlParams.get("token");
    campaignId = urlParams.get("campaign_id");
    sessionStorage.setItem("__rrweb_editor_mode", "true");
    sessionStorage.setItem("__rrweb_token", editorToken);
    sessionStorage.setItem("__rrweb_campaign_id", campaignId);
  } else if (storedEditorMode === "true") {
    isEditorMode = true;
    editorToken = sessionStorage.getItem("__rrweb_token");
    campaignId = sessionStorage.getItem("__rrweb_campaign_id");
  }

  if (isEditorMode && editorToken) {
    window.__RRWEB_EDITOR_TOKEN = editorToken;
    window.__RRWEB_CAMPAIGN_ID = campaignId;
    window.__RRWEB_DOMAIN_TOKEN = DOMAIN_TOKEN;

    var editorUrl = window.RRWEB_SERVER_URL
      ? window.RRWEB_SERVER_URL.replace("/upload-session", "/editor-overlay.js")
      : "http://localhost:3000/editor-overlay.js";

    var editorScript = document.createElement("script");
    editorScript.src = editorUrl;
    document.head.appendChild(editorScript);

    return;
  }

  // Storage keys
  var DISTINCT_ID_KEY = "rrweb_distinct_id";
  var SESSION_ID_KEY = "rrweb_session_id";
  var LAST_ACTIVITY_KEY = "rrweb_last_activity";
  var EVENTS_KEY = "rrweb_events";
  var CAMPAIGN_KEY = "rrweb_campaign";
  var TIMEOUT_START_KEY = "rrweb_timeout_start";
  var TIMEOUT_DURATION_KEY = "rrweb_timeout_duration";

  // Constants
  var IDLE_TIMEOUT_MS = 30 * 60 * 1000;

  // State
  var events = [];
  var stopFn = null;
  var isRecordingActive = false;
  var distinctId = null;
  var sessionId = null;
  var currentCampaign = null;
  var plugins = [];
  var saveEventsDebounced = null;
  var timeoutTimer = null;
  var librariesLoaded = false;
  var librariesLoading = false;
  var chunkSequence = 0;

  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function loadLibraries() {
    if (librariesLoaded) {
      return Promise.resolve();
    }

    if (librariesLoading) {
      return new Promise(function(resolve) {
        var checkLoaded = setInterval(function() {
          if (librariesLoaded) {
            clearInterval(checkLoaded);
            resolve();
          }
        }, 100);
      });
    }

    librariesLoading = true;

    var libs = [
      "https://cdn.jsdelivr.net/npm/rrweb@latest/dist/rrweb.min.js",
      "https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js"
    ];

    return Promise.all(libs.map(loadScript))
      .then(function() {
        librariesLoaded = true;
        librariesLoading = false;
      })
      .catch(function(err) {
        librariesLoading = false;
        throw err;
      });
  }

  function getOrCreateDistinctId() {
    var id = localStorage.getItem(DISTINCT_ID_KEY);
    if (!id) {
      id = "uid_" + Date.now() + "_" + Math.random().toString(36).substring(2, 11);
      localStorage.setItem(DISTINCT_ID_KEY, id);
    }
    return id;
  }

  function isIdleTimeoutExceeded() {
    var lastActivity = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (!lastActivity) return true;
    return (Date.now() - parseInt(lastActivity, 10)) > IDLE_TIMEOUT_MS;
  }

  function updateLastActivity() {
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
  }

  function getOrCreateSessionId() {
    var existingSessionId = localStorage.getItem(SESSION_ID_KEY);

    if (!existingSessionId || isIdleTimeoutExceeded()) {
      var newSessionId = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 11);
      localStorage.setItem(SESSION_ID_KEY, newSessionId);
      localStorage.removeItem(EVENTS_KEY);
      events = [];
      chunkSequence = 0;
      return newSessionId;
    }

    return existingSessionId;
  }

  function loadStoredEvents() {
    try {
      var stored = localStorage.getItem(EVENTS_KEY);
      if (stored) {
        var parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          events = parsed;
          return;
        }
      }
    } catch (err) {
      // Ignore parse errors
    }
    events = [];
  }

  function saveEvents() {
    try {
      localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
    } catch (err) {
      // Ignore save errors
    }
  }

  function debounce(func, delay) {
    var timeout;
    return function() {
      clearTimeout(timeout);
      timeout = setTimeout(func, delay);
    };
  }

  function isTimeoutExpired() {
    var timeoutStart = localStorage.getItem(TIMEOUT_START_KEY);
    var timeoutDuration = localStorage.getItem(TIMEOUT_DURATION_KEY);

    if (!timeoutStart || !timeoutDuration) return false;

    var elapsed = Date.now() - parseInt(timeoutStart, 10);
    return elapsed >= parseInt(timeoutDuration, 10);
  }

  function getRemainingTimeout() {
    var timeoutStart = localStorage.getItem(TIMEOUT_START_KEY);
    var timeoutDuration = localStorage.getItem(TIMEOUT_DURATION_KEY);

    if (!timeoutStart || !timeoutDuration) return null;

    var elapsed = Date.now() - parseInt(timeoutStart, 10);
    var remaining = parseInt(timeoutDuration, 10) - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  function clearTimeoutState() {
    localStorage.removeItem(TIMEOUT_START_KEY);
    localStorage.removeItem(TIMEOUT_DURATION_KEY);
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
  }

  function setupTimeoutTimer(durationMs) {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
    timeoutTimer = setTimeout(function() {
      stopRecordingInternal();
    }, durationMs);
  }

  function getServerBaseUrl() {
    var url = window.RRWEB_SERVER_URL || "http://localhost:3000/upload-session";
    return url.replace("/upload-session", "");
  }

  function sendEvents() {
    if (events.length === 0) {
      return;
    }
    if (!currentCampaign) {
      return;
    }

    var chunkTimestamp = Date.now();
    var eventsToSend = events.slice();
    var currentSeq = chunkSequence++;

    var baseUrl = getServerBaseUrl();
    var uploadUrlEndpoint = baseUrl + "/api/sessions/" + sessionId + "/upload-url";

    var ticketPayload = {
      chunkTimestamp: chunkTimestamp,
      campaign: currentCampaign,
      distinctId: distinctId,
      pageUrl: window.location.href,
      host: window.location.host,
      domainToken: DOMAIN_TOKEN,
      sequenceId: currentSeq
    };

    var recordingData = {
      sessionId: sessionId,
      events: eventsToSend,
      pageUrl: window.location.href,
      timestamp: chunkTimestamp
    };
    var recordingJson = JSON.stringify(recordingData);

    var compressed = null;
    try {
      if (window.fflate) {
        compressed = fflate.gzipSync(fflate.strToU8(recordingJson));
      }
    } catch (err) {
      return;
    }

    if (!compressed) {
      return;
    }

    events = [];
    saveEvents();

    fetch(uploadUrlEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ticketPayload),
      keepalive: true
    })
    .then(function(res) {
      if (!res.ok) {
        throw new Error("Failed to get upload URL: " + res.status);
      }
      return res.json();
    })
    .then(function(data) {
      var uploadUrl = data.uploadUrl;

      return fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/gzip" },
        body: compressed,
        keepalive: true
      });
    })
    .catch(function() {
      // Silent failure
    });
  }

  function flushEvents() {
    if (events.length === 0) return;
    if (!currentCampaign) return;
    if (!sessionId) return;

    var currentSeq = chunkSequence++;
    var baseUrl = getServerBaseUrl();
    var flushUrl = baseUrl + "/api/sessions/" + sessionId + "/flush?seq=" + currentSeq;

    var payload = {
      events: events,
      campaign: currentCampaign,
      distinctId: distinctId,
      pageUrl: window.location.href,
      host: window.location.host,
      timestamp: Date.now(),
      domainToken: DOMAIN_TOKEN
    };

    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
        navigator.sendBeacon(flushUrl, blob);
      }
    } catch (err) {
      // Ignore errors on unload
    }

    events = [];
    saveEvents();
  }

  function startRecordingInternal(options) {
    options = options || {};

    if (!options.campaign || typeof options.campaign !== "string") {
      return;
    }

    if (isRecordingActive) {
      return;
    }

    if (isTimeoutExpired()) {
      clearTimeoutState();
      localStorage.removeItem(CAMPAIGN_KEY);
    }

    currentCampaign = options.campaign;
    localStorage.setItem(CAMPAIGN_KEY, currentCampaign);

    if (options.timeout && typeof options.timeout === "number" && options.timeout > 0) {
      localStorage.setItem(TIMEOUT_START_KEY, Date.now().toString());
      localStorage.setItem(TIMEOUT_DURATION_KEY, options.timeout.toString());
      setupTimeoutTimer(options.timeout);
    }

    sessionId = getOrCreateSessionId();
    updateLastActivity();
    loadStoredEvents();

    loadLibraries()
      .then(function() {
        try {
          stopFn = rrweb.record({
            emit: function(event) {
              events.push(event);
              updateLastActivity();
              saveEventsDebounced();
            }
          });
          isRecordingActive = true;

          setTimeout(function() {
            sendEvents();
          }, 500);
        } catch (err) {
          // Silent failure
        }
      })
      .catch(function() {
        // Silent failure
      });
  }

  function stopRecordingInternal() {
    if (!isRecordingActive) {
      return;
    }

    sendEvents();

    if (typeof stopFn === "function") {
      stopFn();
      stopFn = null;
    }

    isRecordingActive = false;
    clearTimeoutState();
    currentCampaign = null;
    localStorage.removeItem(CAMPAIGN_KEY);
    localStorage.removeItem(SESSION_ID_KEY);
    sessionId = null;
  }

  function isRecordingInternal() {
    return isRecordingActive;
  }

  function getCampaignInternal() {
    return currentCampaign;
  }

  function tryResumeRecording() {
    var savedCampaign = localStorage.getItem(CAMPAIGN_KEY);
    if (!savedCampaign) {
      return;
    }

    if (isTimeoutExpired()) {
      clearTimeoutState();
      localStorage.removeItem(CAMPAIGN_KEY);
      return;
    }

    startRecordingInternal({
      campaign: savedCampaign,
      timeout: getRemainingTimeout() || undefined
    });
  }

  function runAutopilot(rules) {
    if (!rules || rules.length === 0) return;

    function executeRule(rule) {
      if (rule.action_type === "START_RECORDING") {
        if (rule.campaign_name) {
          var options = { campaign: rule.campaign_name };
          if (rule.timeout_ms) {
            options.timeout = rule.timeout_ms;
          }
          window.recorder.startRecording(options);
        }
      }
      else if (rule.action_type === "STOP_RECORDING") {
        // CRITICAL: Save sessionId BEFORE stopRecording() clears it
        var currentSessionId = window.recorder.getSessionId();

        if (rule.completion_status && currentSessionId) {
          // Set status BEFORE stopping (while session still exists)
          window.recorder.setStatus(rule.completion_status)
            .then(function() {
              window.recorder.stopRecording();
            })
            .catch(function(err) {
              console.error("Failed to set status:", err);
              window.recorder.stopRecording();  // Stop anyway
            });
        } else {
          window.recorder.stopRecording();
        }
      }
      else if (rule.action_type === "LOG_STEP") {
        if (rule.step_key) {
          window.recorder.checkpoint(rule.step_key);
        }
      }
    }

    function checkUrlRules() {
      var currentPath = window.location.pathname;
      rules.forEach(function(rule) {
        if (rule.trigger_type === "URL_CONTAINS") {
          if (currentPath.indexOf(rule.selector) !== -1) {
             if (rule.action_type === "START_RECORDING" &&
                 window.recorder.isRecording() &&
                 window.recorder.getCampaign() === rule.campaign_name) {
               return;
             }
             executeRule(rule);
          }
        }
      });
    }

    var originalPushState = history.pushState;
    history.pushState = function() {
      originalPushState.apply(this, arguments);
      setTimeout(checkUrlRules, 50);
    };
    window.addEventListener("popstate", checkUrlRules);
    checkUrlRules();

    document.addEventListener("click", function(e) {
      function normalizeTarget(el) {
        var interactive = el.closest('a, button, [role="button"], input, select, textarea, [onclick]');
        return interactive || el;
      }

      rules.forEach(function(rule) {
        if (rule.trigger_type === "CLICK_ELEMENT") {
          var isMatch = false;
          var conditions = null;

          try {
            var parsed = JSON.parse(rule.selector);
            if (parsed.operator === "AND" && Array.isArray(parsed.conditions)) {
              conditions = parsed.conditions;
            }
          } catch (err) {
            // Not JSON, fall back to legacy string logic
          }

          if (conditions) {
            var target = normalizeTarget(e.target);

            var allPassed = conditions.every(function(cond) {
              if (cond.type === 'PAGE_PATH') {
                if (cond.op === 'contains') {
                  return window.location.pathname.indexOf(cond.val) !== -1;
                }
                return window.location.pathname === cond.val;
              }

              if (cond.type === 'CLICK_TEXT') {
                var txt = (target.innerText || target.textContent || "").trim();
                if (cond.op === 'equals') {
                  return txt === cond.val;
                }
                return txt.indexOf(cond.val) !== -1;
              }

              if (cond.type === 'CLICK_ID') {
                var expectedId = cond.val.startsWith('#') ? cond.val : '#' + cond.val;
                return ('#' + target.id) === expectedId;
              }

              if (cond.type === 'CLICK_HREF') {
                var anchor = target.closest('a');
                if (!anchor) return false;
                var actualHref = anchor.getAttribute('href') || '';
                if (cond.op === 'contains') {
                  return actualHref.indexOf(cond.val) !== -1;
                }
                return actualHref === cond.val;
              }

              if (cond.type === 'CLICK_ATTR') {
                var attrMatch = cond.val.match(/\[([^\]=]+)="([^"]+)"\]/);
                if (attrMatch) {
                  var attrName = attrMatch[1];
                  var attrValue = attrMatch[2];
                  return target.getAttribute(attrName) === attrValue;
                }
                return false;
              }

              if (cond.type === 'CLICK_SELECTOR') {
                try {
                  return target.matches(cond.val) || e.target.matches(cond.val);
                } catch (err) {
                  return false;
                }
              }

              return false;
            });

            if (allPassed) {
              isMatch = true;
            }

          } else {
            if (rule.selector.startsWith('text="') || rule.selector.startsWith("text='")) {
              var expectedText = rule.selector
                .replace(/^text=["']/, '')
                .replace(/["']$/, '')
                .trim();
              var clickedText = (e.target.innerText || "").trim();
              if (clickedText === expectedText || clickedText.indexOf(expectedText) !== -1) {
                isMatch = true;
              }
              if (!isMatch && e.target.parentElement) {
                var parentText = (e.target.parentElement.innerText || "").trim();
                if (parentText === expectedText) {
                  isMatch = true;
                }
              }
            }
            else if (rule.selector.startsWith('href="') || rule.selector.startsWith("href='")) {
              var expectedHref = rule.selector
                .replace(/^href=["']/, '')
                .replace(/["']$/, '');
              var anchor = e.target.closest('a');
              if (anchor) {
                var actualHref = anchor.getAttribute('href') || '';
                if (actualHref === expectedHref || actualHref.indexOf(expectedHref) !== -1) {
                  isMatch = true;
                }
              }
            }
            else {
              try {
                if (e.target.matches(rule.selector) || e.target.closest(rule.selector)) {
                  isMatch = true;
                }
              } catch (err) {
                // Ignore invalid selector errors
              }
            }
          }

          if (isMatch) {
            executeRule(rule);
          }
        }
      });
    }, true);
  }

  function init() {
    distinctId = getOrCreateDistinctId();
    saveEventsDebounced = debounce(saveEvents, 500);

    window.recorder = window.recorder || {};
    window.recorder.startRecording = startRecordingInternal;
    window.recorder.stopRecording = stopRecordingInternal;
    window.recorder.isRecording = isRecordingInternal;
    window.recorder.getCampaign = getCampaignInternal;
    window.recorder.ready = Promise.resolve();
    window.recorder.identify = function(email) {
      if (!email || typeof email !== "string") {
        return Promise.reject(new Error("Invalid email"));
      }
      var identifyUrl = window.RRWEB_SERVER_URL
        ? window.RRWEB_SERVER_URL.replace("/upload-session", "/identify")
        : "http://localhost:3000/identify";
      return fetch(identifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email,
          distinctId: distinctId,
          host: window.location.host,
          domainToken: DOMAIN_TOKEN
        }),
        credentials: "include"
      })
        .then(function(res) {
          if (!res.ok) throw new Error("Failed to identify user");
          return res.json();
        });
    };

    window.recorder.setStatus = function(status) {
      if (!status || !["completed", "dropped_off"].includes(status)) {
        return Promise.reject(new Error("Invalid status"));
      }
      if (!sessionId) {
        return Promise.reject(new Error("No active session"));
      }
      var statusUrl = window.RRWEB_SERVER_URL
        ? window.RRWEB_SERVER_URL.replace("/upload-session", "/api/sessions/" + sessionId + "/status")
        : "http://localhost:3000/api/sessions/" + sessionId + "/status";
      return fetch(statusUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: status,
          host: window.location.host,
          domainToken: DOMAIN_TOKEN
        }),
        credentials: "include"
      })
        .then(function(res) {
          if (!res.ok) throw new Error("Failed to set session status");
          return res.json();
        });
    };

    window.recorder.checkpoint = function(key) {
      if (!key || typeof key !== "string") {
        return;
      }
      if (!sessionId) {
        return;
      }
      var checkpointUrl = window.RRWEB_SERVER_URL
        ? window.RRWEB_SERVER_URL.replace("/upload-session", "/api/sessions/" + sessionId + "/checkpoint")
        : "http://localhost:3000/api/sessions/" + sessionId + "/checkpoint";
      fetch(checkpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: key,
          host: window.location.host,
          domainToken: DOMAIN_TOKEN
        }),
        credentials: "include"
      }).catch(function() {
        // Silent failure
      });
    };

    window.recorder.getSessionId = function() {
      return sessionId;
    };

    var configUrl = window.RRWEB_SERVER_URL
        ? window.RRWEB_SERVER_URL.replace("/upload-session", "/api/projects/" + DOMAIN_TOKEN + "/config")
        : "http://localhost:3000/api/projects/" + DOMAIN_TOKEN + "/config";

    fetch(configUrl)
      .then(function(res) {
        if (res.ok) return res.json();
        throw new Error("Config fetch failed");
      })
      .then(function(data) {
        if (data.rules && Array.isArray(data.rules)) {
          runAutopilot(data.rules);
        }

        if (!window.recorder.isRecording()) {
          tryResumeRecording();
        }
      })
      .catch(function(err) {
        tryResumeRecording();
      });

    setInterval(function() {
      if (isRecordingActive) {
        sendEvents();
      }
    }, 60000);

    document.addEventListener("visibilitychange", function() {
      if (document.visibilityState === "hidden" && isRecordingActive) {
        flushEvents();
      }
    });

    window.addEventListener("beforeunload", function() {
      if (isRecordingActive) {
        flushEvents();
      }
    });

    window.addEventListener("pagehide", function() {
      if (isRecordingActive) {
        flushEvents();
      }
    });
  }

  init();
})();
