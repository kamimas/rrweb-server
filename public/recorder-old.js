// public/recorder.js
(function() {
  "use strict";

  // Read the domain key from the script tag's data attribute
  var DOMAIN_TOKEN = document.currentScript.getAttribute("data-domain-key");
  if (!DOMAIN_TOKEN) {
    console.error("Recorder: No domain key provided. Please include data-domain-key attribute.");
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

  // Utility: dynamically load external scripts
  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = function(err) {
        console.error("Failed to load script:", src, err);
        reject(err);
      };
      document.head.appendChild(script);
    });
  }

  // Generate or retrieve distinct_id
  function getOrCreateDistinctId() {
    var id = localStorage.getItem(DISTINCT_ID_KEY);
    if (!id) {
      id = "uid_" + Date.now() + "_" + Math.random().toString(36).substring(2, 11);
      localStorage.setItem(DISTINCT_ID_KEY, id);
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
      return newSessionId;
    }

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
      console.error("Recorder: Error parsing stored rrweb events:", err);
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
      console.log("Recorder: Timeout reached, stopping recording");
      stopRecordingInternal();
    }, durationMs);
  }

  // Send events to the backend
  function sendEvents() {
    if (events.length === 0) return;
    if (!currentCampaign) {
      console.error("Recorder: No campaign set, cannot send events");
      return;
    }

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
      }
    } catch (err) {
      console.error("Recorder: Compression failed, sending uncompressed:", err);
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
      }
    } catch (err) {
      console.error("Recorder: Error using sendBeacon:", err);
    }

    if (!sent) {
      if (compressed) {
        fetch(url + "?compression=gzip", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: compressed,
          credentials: "include"
        }).catch(function(err) {
          console.error("Recorder: Failed to send events via fetch:", err);
        });
      } else {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payloadStr,
          credentials: "include"
        }).catch(function(err) {
          console.error("Recorder: Failed to send events via fetch:", err);
        });
      }
    }

    events = [];
    saveEvents();
  }

  // Start rrweb recording
  function startRecordingInternal(options) {
    if (!librariesLoaded) {
      console.error("Recorder: Libraries not loaded yet. Wait for recorder.ready promise.");
      return;
    }

    options = options || {};

    // Campaign is required
    if (!options.campaign || typeof options.campaign !== "string") {
      console.error("Recorder: campaign is required. Usage: recorder.startRecording({ campaign: 'my-campaign' })");
      return;
    }

    if (isRecordingActive) {
      console.warn("Recorder: Already recording");
      return;
    }

    // Check if previous timeout expired - if so, clear state
    if (isTimeoutExpired()) {
      clearTimeoutState();
      localStorage.removeItem(CAMPAIGN_KEY);
    }

    // Set campaign
    currentCampaign = options.campaign;
    localStorage.setItem(CAMPAIGN_KEY, currentCampaign);

    // Handle timeout
    if (options.timeout && typeof options.timeout === "number" && options.timeout > 0) {
      localStorage.setItem(TIMEOUT_START_KEY, Date.now().toString());
      localStorage.setItem(TIMEOUT_DURATION_KEY, options.timeout.toString());
      setupTimeoutTimer(options.timeout);
    }

    // Get or create session (new if idle > 30min)
    sessionId = getOrCreateSessionId();
    updateLastActivity();
    loadStoredEvents();

    try {
      stopFn = rrweb.record({
        emit: function(event) {
          events.push(event);
          updateLastActivity();
          saveEventsDebounced();
        },
      });
      isRecordingActive = true;
      console.log("Recorder: Recording started, campaign:", currentCampaign, "session:", sessionId);
    } catch (err) {
      console.error("Recorder: Error starting rrweb recording:", err);
    }
  }

  // Stop rrweb recording
  function stopRecordingInternal() {
    if (!isRecordingActive) {
      console.warn("Recorder: Not currently recording");
      return;
    }

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
    var stoppedCampaign = currentCampaign;
    currentCampaign = null;
    localStorage.removeItem(CAMPAIGN_KEY);

    console.log("Recorder: Recording stopped, campaign:", stoppedCampaign);
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
    if (!savedCampaign) return;

    // Check if timeout expired
    if (isTimeoutExpired()) {
      console.log("Recorder: Previous recording timeout expired, not resuming");
      clearTimeoutState();
      localStorage.removeItem(CAMPAIGN_KEY);
      return;
    }

    // Resume recording with remaining timeout
    currentCampaign = savedCampaign;
    sessionId = getOrCreateSessionId();
    updateLastActivity();
    loadStoredEvents();

    // Resume timeout timer if there was one
    var remaining = getRemainingTimeout();
    if (remaining !== null && remaining > 0) {
      setupTimeoutTimer(remaining);
    }

    try {
      stopFn = rrweb.record({
        emit: function(event) {
          events.push(event);
          updateLastActivity();
          saveEventsDebounced();
        },
      });
      isRecordingActive = true;
      console.log("Recorder: Recording resumed, campaign:", currentCampaign, "session:", sessionId);
    } catch (err) {
      console.error("Recorder: Error resuming rrweb recording:", err);
    }
  }

  // Initialize the recorder
  function init() {
    distinctId = getOrCreateDistinctId();
    saveEventsDebounced = debounce(saveEvents, 500);

    // Create ready promise
    var readyResolve;
    var readyPromise = new Promise(function(resolve) {
      readyResolve = resolve;
    });

    // Expose public API immediately (before libraries load)
    window.recorder = window.recorder || {};
    window.recorder.startRecording = startRecordingInternal;
    window.recorder.stopRecording = stopRecordingInternal;
    window.recorder.isRecording = isRecordingInternal;
    window.recorder.getCampaign = getCampaignInternal;
    window.recorder.ready = readyPromise;
    window.recorder.identify = function(email) {
      if (!email || typeof email !== "string") {
        console.error("Recorder.identify: Invalid email provided");
        return Promise.reject(new Error("Invalid email"));
      }
      var identifyUrl = window.RRWEB_SERVER_URL
        ? window.RRWEB_SERVER_URL.replace("/upload-session", "/identify")
        : "http://localhost:3000/identify";
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
          console.log("Recorder: User identified successfully:", email);
          return data;
        })
        .catch(function(err) {
          console.error("Recorder: Error identifying user:", err);
          throw err;
        });
    };

    // Fetch config and load libraries
    var configUrl = window.RRWEB_SERVER_URL
      ? window.RRWEB_SERVER_URL.replace("/upload-session", "/config")
      : "/config";

    fetch(configUrl)
      .then(function(res) { return res.json(); })
      .then(function(config) {
        var libs = [
          "https://cdn.jsdelivr.net/npm/rrweb@latest/dist/rrweb.min.js",
          "https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js"
        ];
        // Skip console plugin for now - it has compatibility issues
        return Promise.all(libs.map(loadScript)).then(function() { return config; });
      })
      .then(function(config) {
        // Plugins ready (console plugin disabled for compatibility)
        librariesLoaded = true;
        readyResolve();

        // Try to resume if there was an active recording
        tryResumeRecording();

        // Periodic send + beforeunload
        setInterval(function() {
          if (isRecordingActive) sendEvents();
        }, 60000);

        window.addEventListener("beforeunload", function() {
          if (isRecordingActive) sendEvents();
        });
      })
      .catch(function(err) {
        console.error("Recorder: Error loading configuration or libraries:", err);
      });
  }

  init();
})();
