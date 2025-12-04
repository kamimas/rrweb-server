// public/recorder.js - LAZY LOADING VERSION
(function() {
  "use strict";

  // Logging utility
  var LOG_PREFIX = "🎥 [rrweb]";
  function log(message, data) {
    if (data !== undefined) {
      console.log(LOG_PREFIX + " " + message, data);
    } else {
      console.log(LOG_PREFIX + " " + message);
    }
  }
  function logWarn(message, data) {
    if (data !== undefined) {
      console.warn(LOG_PREFIX + " ⚠️ " + message, data);
    } else {
      console.warn(LOG_PREFIX + " ⚠️ " + message);
    }
  }
  function logError(message, data) {
    if (data !== undefined) {
      console.error(LOG_PREFIX + " ❌ " + message, data);
    } else {
      console.error(LOG_PREFIX + " ❌ " + message);
    }
  }

  log("Initializing recorder...");

  // Read the domain key from the script tag's data attribute
  var DOMAIN_TOKEN = document.currentScript.getAttribute("data-domain-key");
  if (!DOMAIN_TOKEN) {
    logError("No domain key provided. Please include data-domain-key attribute.");
    return;
  }
  log("Domain token found: " + DOMAIN_TOKEN.substring(0, 10) + "...");

  // Storage keys
  var DISTINCT_ID_KEY = "rrweb_distinct_id";
  var SESSION_ID_KEY = "rrweb_session_id";
  var LAST_ACTIVITY_KEY = "rrweb_last_activity";
  var EVENTS_KEY = "rrweb_events";
  var CAMPAIGN_KEY = "rrweb_campaign";
  var TIMEOUT_START_KEY = "rrweb_timeout_start";
  var TIMEOUT_DURATION_KEY = "rrweb_timeout_duration";

  // Constants
  var IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes = new session

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

  // Utility: dynamically load external scripts
  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = function(err) {
        console.error("Recorder: Failed to load script:", src);
        reject(err);
      };
      document.head.appendChild(script);
    });
  }

  // Lazy load rrweb libraries
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
        console.error("Recorder: Failed to load libraries:", err);
        throw err;
      });
  }

  // Generate or retrieve distinct_id
  function getOrCreateDistinctId() {
    var id = localStorage.getItem(DISTINCT_ID_KEY);
    if (!id) {
      id = "uid_" + Date.now() + "_" + Math.random().toString(36).substring(2, 11);
      localStorage.setItem(DISTINCT_ID_KEY, id);
      log("Created new distinct ID: " + id);
    } else {
      log("Using existing distinct ID: " + id);
    }
    return id;
  }

  // Check if idle timeout exceeded (30 min)
  function isIdleTimeoutExceeded() {
    var lastActivity = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (!lastActivity) return true;
    return (Date.now() - parseInt(lastActivity, 10)) > IDLE_TIMEOUT_MS;
  }

  // Update last activity timestamp
  function updateLastActivity() {
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
  }

  // Get or create session ID (new session if idle > 30min)
  function getOrCreateSessionId() {
    var existingSessionId = localStorage.getItem(SESSION_ID_KEY);

    if (!existingSessionId || isIdleTimeoutExceeded()) {
      var newSessionId = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 11);
      localStorage.setItem(SESSION_ID_KEY, newSessionId);
      localStorage.removeItem(EVENTS_KEY);
      events = [];
      if (existingSessionId) {
        log("🔄 Session expired (idle > 30min). Created new session: " + newSessionId);
      } else {
        log("🆕 Created new session: " + newSessionId);
      }
      return newSessionId;
    }

    log("📌 Resuming existing session: " + existingSessionId);
    return existingSessionId;
  }

  // Load stored events from localStorage
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
      console.error("Recorder: Error parsing stored events:", err);
    }
    events = [];
  }

  // Save events to localStorage
  function saveEvents() {
    try {
      localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
    } catch (err) {
      console.error("Recorder: Error saving events:", err);
    }
  }

  function debounce(func, delay) {
    var timeout;
    return function() {
      clearTimeout(timeout);
      timeout = setTimeout(func, delay);
    };
  }

  // Check if recording timeout has expired
  function isTimeoutExpired() {
    var timeoutStart = localStorage.getItem(TIMEOUT_START_KEY);
    var timeoutDuration = localStorage.getItem(TIMEOUT_DURATION_KEY);

    if (!timeoutStart || !timeoutDuration) return false;

    var elapsed = Date.now() - parseInt(timeoutStart, 10);
    return elapsed >= parseInt(timeoutDuration, 10);
  }

  // Get remaining timeout duration
  function getRemainingTimeout() {
    var timeoutStart = localStorage.getItem(TIMEOUT_START_KEY);
    var timeoutDuration = localStorage.getItem(TIMEOUT_DURATION_KEY);

    if (!timeoutStart || !timeoutDuration) return null;

    var elapsed = Date.now() - parseInt(timeoutStart, 10);
    var remaining = parseInt(timeoutDuration, 10) - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  // Clear timeout state
  function clearTimeoutState() {
    localStorage.removeItem(TIMEOUT_START_KEY);
    localStorage.removeItem(TIMEOUT_DURATION_KEY);
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
  }

  // Set up timeout timer
  function setupTimeoutTimer(durationMs) {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
    timeoutTimer = setTimeout(function() {
      stopRecordingInternal();
    }, durationMs);
  }

  // Send events to the backend
  function sendEvents() {
    if (events.length === 0) {
      log("📤 No events to send (buffer empty)");
      return;
    }
    if (!currentCampaign) {
      logError("No campaign set, cannot send events");
      return;
    }

    var eventCount = events.length;
    log("📤 Sending " + eventCount + " events to server...", {
      sessionId: sessionId,
      campaign: currentCampaign,
      pageUrl: window.location.href
    });

    var payload = {
      sessionId: sessionId,
      distinctId: distinctId,
      campaign: currentCampaign,
      events: events,
      pageUrl: window.location.href,
      host: window.location.host,
      timestamp: Date.now(),
      domainToken: DOMAIN_TOKEN
    };
    var url = window.RRWEB_SERVER_URL || "http://localhost:3000/upload-session";
    var payloadStr = JSON.stringify(payload);
    var sent = false;

    // Compress with gzip using fflate
    var compressed = null;
    try {
      if (window.fflate) {
        compressed = fflate.gzipSync(fflate.strToU8(payloadStr));
        log("📦 Compressed payload: " + payloadStr.length + " -> " + compressed.length + " bytes");
      }
    } catch (err) {
      logWarn("Compression failed, sending uncompressed");
    }

    try {
      if (navigator.sendBeacon) {
        if (compressed) {
          var blob = new Blob([compressed], { type: "text/plain" });
          sent = navigator.sendBeacon(url + "?compression=gzip", blob);
        } else {
          var blob = new Blob([payloadStr], { type: "application/json" });
          sent = navigator.sendBeacon(url, blob);
        }
        if (sent) {
          log("✅ Events sent via sendBeacon (" + eventCount + " events)");
        }
      }
    } catch (err) {
      logWarn("sendBeacon failed, falling back to fetch");
    }

    if (!sent) {
      log("📡 Sending events via fetch...");
      if (compressed) {
        fetch(url + "?compression=gzip", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: compressed,
          credentials: "include"
        }).then(function(res) {
          if (res.ok) {
            log("✅ Events sent via fetch (" + eventCount + " events)");
          } else {
            logError("Server returned error: " + res.status);
          }
        }).catch(function(err) {
          logError("Failed to send events: " + err.message);
        });
      } else {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payloadStr,
          credentials: "include"
        }).then(function(res) {
          if (res.ok) {
            log("✅ Events sent via fetch (" + eventCount + " events)");
          } else {
            logError("Server returned error: " + res.status);
          }
        }).catch(function(err) {
          logError("Failed to send events: " + err.message);
        });
      }
    }

    events = [];
    saveEvents();
  }

  // Start rrweb recording - LAZY LOADS LIBRARIES FIRST
  function startRecordingInternal(options) {
    options = options || {};

    log("▶️ startRecording() called", options);

    // Campaign is required
    if (!options.campaign || typeof options.campaign !== "string") {
      logError("Campaign is required. Usage: recorder.startRecording({ campaign: 'my-campaign' })");
      return;
    }

    if (isRecordingActive) {
      logWarn("Already recording for campaign: " + currentCampaign);
      return;
    }

    // Check if previous timeout expired - if so, clear state
    if (isTimeoutExpired()) {
      log("⏰ Previous recording timeout expired, clearing state");
      clearTimeoutState();
      localStorage.removeItem(CAMPAIGN_KEY);
    }

    // Set campaign
    currentCampaign = options.campaign;
    localStorage.setItem(CAMPAIGN_KEY, currentCampaign);
    log("📋 Campaign set: " + currentCampaign);

    // Handle timeout
    if (options.timeout && typeof options.timeout === "number" && options.timeout > 0) {
      localStorage.setItem(TIMEOUT_START_KEY, Date.now().toString());
      localStorage.setItem(TIMEOUT_DURATION_KEY, options.timeout.toString());
      setupTimeoutTimer(options.timeout);
      log("⏱️ Recording timeout set: " + (options.timeout / 1000) + " seconds");
    }

    // Get or create session (new if idle > 30min)
    sessionId = getOrCreateSessionId();
    updateLastActivity();
    loadStoredEvents();

    log("📚 Loading rrweb libraries...");

    // LAZY LOAD: Load libraries first, then start recording
    loadLibraries()
      .then(function() {
        try {
          var eventCounter = 0;
          stopFn = rrweb.record({
            emit: function(event) {
              events.push(event);
              eventCounter++;
              updateLastActivity();
              saveEventsDebounced();
              // Log every 10th event to avoid spam, or first 3 events
              if (eventCounter <= 3 || eventCounter % 10 === 0) {
                log("🔴 Recording event #" + eventCounter + " (type: " + event.type + ", total buffered: " + events.length + ")");
              }
            }
          });
          isRecordingActive = true;
          log("🎬 ========================================");
          log("🎬 RECORDING STARTED");
          log("🎬 Session ID: " + sessionId);
          log("🎬 Campaign: " + currentCampaign);
          log("🎬 Distinct ID: " + distinctId);
          log("🎬 Page: " + window.location.href);
          log("🎬 ========================================");
        } catch (err) {
          logError("Error starting rrweb recording: " + err.message);
        }
      })
      .catch(function(err) {
        logError("Failed to load libraries: " + err.message);
      });
  }

  // Stop rrweb recording
  function stopRecordingInternal() {
    if (!isRecordingActive) {
      log("⏹️ stopRecording() called but not currently recording");
      return;
    }

    log("⏹️ ========================================");
    log("⏹️ STOPPING RECORDING");
    log("⏹️ Session ID: " + sessionId);
    log("⏹️ Campaign: " + currentCampaign);
    log("⏹️ ========================================");

    // Flush pending events before stopping
    sendEvents();

    if (typeof stopFn === "function") {
      stopFn();
      stopFn = null;
    }

    isRecordingActive = false;

    // Clear timeout state
    clearTimeoutState();

    // Clear campaign
    currentCampaign = null;
    localStorage.removeItem(CAMPAIGN_KEY);

    log("✅ Recording stopped successfully");
  }

  // Check if recording is active
  function isRecordingInternal() {
    return isRecordingActive;
  }

  // Get current campaign
  function getCampaignInternal() {
    return currentCampaign;
  }

  // Resume recording if it was active before page navigation
  function tryResumeRecording() {
    var savedCampaign = localStorage.getItem(CAMPAIGN_KEY);
    if (!savedCampaign) {
      log("🔍 No saved campaign found, not auto-resuming");
      return;
    }

    // Check if timeout expired
    if (isTimeoutExpired()) {
      log("⏰ Saved campaign timeout expired, clearing state");
      clearTimeoutState();
      localStorage.removeItem(CAMPAIGN_KEY);
      return;
    }

    log("🔄 Auto-resuming recording for campaign: " + savedCampaign);
    // Resume recording with saved campaign
    startRecordingInternal({
      campaign: savedCampaign,
      timeout: getRemainingTimeout() || undefined
    });
  }

  // Initialize the recorder
  function init() {
    distinctId = getOrCreateDistinctId();
    saveEventsDebounced = debounce(saveEvents, 500);

    // Expose public API immediately (NO library loading yet)
    window.recorder = window.recorder || {};
    window.recorder.startRecording = startRecordingInternal;
    window.recorder.stopRecording = stopRecordingInternal;
    window.recorder.isRecording = isRecordingInternal;
    window.recorder.getCampaign = getCampaignInternal;
    window.recorder.ready = Promise.resolve(); // Always ready - libraries load on-demand
    window.recorder.identify = function(email) {
      log("👤 identify() called with email: " + email);
      if (!email || typeof email !== "string") {
        logError("Invalid email provided to identify()");
        return Promise.reject(new Error("Invalid email"));
      }
      var identifyUrl = window.RRWEB_SERVER_URL
        ? window.RRWEB_SERVER_URL.replace("/upload-session", "/identify")
        : "http://localhost:3000/identify";
      log("👤 Sending identify request to: " + identifyUrl);
      return fetch(identifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, distinctId: distinctId }),
        credentials: "include"
      })
        .then(function(res) {
          if (!res.ok) throw new Error("Failed to identify user");
          return res.json();
        })
        .then(function(data) {
          log("👤 ========================================");
          log("👤 USER IDENTIFIED");
          log("👤 Email: " + email);
          log("👤 Distinct ID: " + distinctId);
          log("👤 ========================================");
          return data;
        })
        .catch(function(err) {
          logError("Failed to identify user: " + err.message);
          throw err;
        });
    };

    window.recorder.setStatus = function(status) {
      log("🏷️ setStatus() called with: " + status);
      if (!status || !["completed", "dropped_off"].includes(status)) {
        logError("Invalid status. Must be 'completed' or 'dropped_off'");
        return Promise.reject(new Error("Invalid status"));
      }
      if (!sessionId) {
        logError("No active session. Make sure startRecording was called first.");
        return Promise.reject(new Error("No active session"));
      }
      var statusUrl = window.RRWEB_SERVER_URL
        ? window.RRWEB_SERVER_URL.replace("/upload-session", "/api/sessions/" + sessionId + "/status")
        : "http://localhost:3000/api/sessions/" + sessionId + "/status";
      log("🏷️ Sending status update to: " + statusUrl);
      return fetch(statusUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: status }),
        credentials: "include"
      })
        .then(function(res) {
          if (!res.ok) throw new Error("Failed to set session status");
          return res.json();
        })
        .then(function(data) {
          log("🏷️ ========================================");
          log("🏷️ SESSION STATUS UPDATED");
          log("🏷️ Session ID: " + sessionId);
          log("🏷️ Status: " + status);
          log("🏷️ ========================================");
          return data;
        })
        .catch(function(err) {
          logError("Failed to set session status: " + err.message);
          throw err;
        });
    };

    window.recorder.getSessionId = function() {
      return sessionId;
    };

    // Check if in manual mode
    var config = window.RRWEB_CONFIG || {};
    var manualMode = config.manualMode === true;

    if (!manualMode) {
      // Try to resume if there was an active recording
      tryResumeRecording();
    }

    // Periodic send + beforeunload
    setInterval(function() {
      if (isRecordingActive) {
        log("⏰ Periodic flush triggered (60s interval)");
        sendEvents();
      }
    }, 60000);

    window.addEventListener("beforeunload", function() {
      if (isRecordingActive) {
        log("🚪 Page unload detected, flushing events...");
        sendEvents();
      }
    });

    log("✅ Recorder initialized successfully");
    log("📖 Available methods: recorder.startRecording(), recorder.stopRecording(), recorder.identify(), recorder.setStatus(), recorder.isRecording(), recorder.getSessionId()");
  }

  init();
})();
