# Session Recording Platform - API Documentation

## Overview

A session recording platform that captures user interactions on web applications. Designed for **targeted debugging** - when you identify a funnel issue (e.g., in Mixpanel), you create a campaign, instrument your code to record specific user flows, then analyze the recordings.

### Core Workflow

1. **Create Campaign** - Define what you're investigating (e.g., "learn_mode_dropoff_dec2024")
2. **Instrument Code** - Add `recorder.startRecording({ campaign: "..." })` at funnel entry point
3. **Collect Sessions** - Users trigger recordings, data flows to server
4. **Analyze** - Filter sessions by campaign, watch playback

---

## Base URL

```
http://localhost:3000
```

---

## Campaigns

Campaigns are tags for grouping related recording sessions.

### Create Campaign

```
POST /api/campaigns
```

**Request:**
```json
{
  "name": "learn_mode_dropoff_dec2024"
}
```

**Response (201):**
```json
{
  "id": 1,
  "name": "learn_mode_dropoff_dec2024",
  "created_at": 1701534000000
}
```

**Errors:**
- `400` - Missing or invalid name
- `409` - Campaign name already exists

---

### List Campaigns

```
GET /api/campaigns
```

**Response (200):**
```json
{
  "campaigns": [
    {
      "id": 1,
      "name": "learn_mode_dropoff_dec2024",
      "created_at": 1701534000000,
      "session_count": 42
    },
    {
      "id": 2,
      "name": "checkout_abandonment_q1",
      "created_at": 1701620400000,
      "session_count": 18
    }
  ]
}
```

---

### Get Campaign

```
GET /api/campaigns/:id
```

**Response (200):**
```json
{
  "id": 1,
  "name": "learn_mode_dropoff_dec2024",
  "created_at": 1701534000000,
  "session_count": 42
}
```

**Errors:**
- `404` - Campaign not found

---

### Delete Campaign

Deletes the campaign and **all associated sessions**.

```
DELETE /api/campaigns/:id
```

**Response (200):**
```json
{
  "success": true,
  "deleted_sessions": 42
}
```

**Errors:**
- `404` - Campaign not found

---

## Sessions

### List Sessions by Campaign

```
GET /api/sessions?campaign_id=1
GET /api/sessions?campaign=learn_mode_dropoff_dec2024
```

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `campaign_id` | integer | Filter by campaign ID |
| `campaign` | string | Filter by campaign name |
| `email` | string | Filter by user email (if identified) |

At least one filter is required.

**Response (200):**
```json
{
  "sessions": [
    {
      "session_id": "sess_1701534000000_abc123xyz",
      "distinct_id": "uid_1701533000000_def456",
      "campaign_id": 1,
      "campaign_name": "learn_mode_dropoff_dec2024",
      "first_timestamp": 1701534000000,
      "last_timestamp": 1701534300000,
      "duration_ms": 300000,
      "chunk_count": 5,
      "playback_url": "/api/sessions/sess_1701534000000_abc123xyz/playback"
    }
  ]
}
```

---

### Get Session Playback Data

Returns merged events from all chunks for playback.

```
GET /api/sessions/:session_id/playback
```

**Response (200):**
```json
{
  "session_id": "sess_1701534000000_abc123xyz",
  "events": [...],
  "metadata": {
    "campaign_id": 1,
    "campaign_name": "learn_mode_dropoff_dec2024",
    "distinct_id": "uid_1701533000000_def456",
    "duration_ms": 300000,
    "page_urls": ["https://app.example.com/learn", "https://app.example.com/learn/step2"]
  }
}
```

**Errors:**
- `404` - Session not found

---

## Upload Session (Internal - Used by Recorder)

```
POST /upload-session
POST /upload-session?compression=gzip
```

**Request:**
```json
{
  "sessionId": "sess_1701534000000_abc123xyz",
  "distinctId": "uid_1701533000000_def456",
  "campaign": "learn_mode_dropoff_dec2024",
  "events": [...],
  "pageUrl": "https://app.example.com/learn",
  "host": "app.example.com",
  "timestamp": 1701534000000,
  "domainToken": "YOUR_SECRET_TOKEN"
}
```

**Response (200):**
```json
{
  "success": true,
  "chunk_id": 123
}
```

**Errors:**
- `400` - Invalid payload or missing required fields
- `403` - Invalid domain token
- `404` - Campaign not found (campaign name doesn't exist)

---

## Config (Internal - Used by Recorder)

```
GET /config
```

**Response:**
```json
{
  "enableConsolePlugin": true
}
```

---

## Client-Side Recorder API

### Installation

```html
<script src="https://your-server.com/recorder.js" data-domain-key="YOUR_TOKEN"></script>
```

### Methods

#### `recorder.startRecording(options)`

Starts recording. Does nothing if already recording.

```js
recorder.startRecording({
  campaign: "learn_mode_dropoff_dec2024",  // required
  timeout: 20 * 60 * 1000                   // optional, auto-stop after 20min
});
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `campaign` | string | yes | Campaign name (must exist on server) |
| `timeout` | number | no | Auto-stop after N milliseconds |

**Behavior:**
- Recording persists across page navigation (same tab)
- Timeout persists across page navigation
- If idle > 30 minutes, creates new session on next start
- Events uploaded every 60 seconds and on page unload

---

#### `recorder.stopRecording()`

Stops recording. Flushes pending events before stopping.

```js
recorder.stopRecording();
```

**Behavior:**
- Uploads any pending events
- Stop state persists for current tab session (sessionStorage)
- Closing tab clears stop state

---

#### `recorder.isRecording()`

Returns current recording state.

```js
if (recorder.isRecording()) {
  console.log("Recording in progress");
}
```

**Returns:** `boolean`

---

#### `recorder.getCampaign()`

Returns current campaign name or null.

```js
const campaign = recorder.getCampaign();
// "learn_mode_dropoff_dec2024" or null
```

**Returns:** `string | null`

---

#### `recorder.ready`

Promise that resolves when libraries are loaded and recorder is ready.

```js
recorder.ready.then(() => {
  // Safe to call startRecording now
  recorder.startRecording({ campaign: "my-campaign" });
});
```

**Returns:** `Promise<void>`

---

#### `recorder.identify(email)`

Links current device to an email address for session lookup.

```js
recorder.identify("user@example.com")
  .then(() => console.log("Identified"))
  .catch(err => console.error(err));
```

**Returns:** `Promise`

---

## Integration Example

### Frontend Code (Your App)

```js
// When user enters the funnel you want to investigate
function onLearnModeStart() {
  recorder.startRecording({
    campaign: "learn_mode_dropoff_dec2024",
    timeout: 20 * 60 * 1000  // 20 minutes max
  });
}

// When user completes successfully
function onLearnModeComplete() {
  recorder.stopRecording();
}

// Optional: identify user
function onLogin(user) {
  recorder.identify(user.email);
}
```

### Dashboard (Your Frontend)

```js
// List campaigns
const { campaigns } = await fetch('/api/campaigns').then(r => r.json());

// Get sessions for a campaign
const { sessions } = await fetch('/api/sessions?campaign_id=1').then(r => r.json());

// Get playback data
const { events, metadata } = await fetch(`/api/sessions/${sessionId}/playback`).then(r => r.json());

// Use rrweb-player to replay
new rrwebPlayer({
  target: document.getElementById('player'),
  props: { events }
});
```

---

## Error Response Format

All errors return:

```json
{
  "error": "Human-readable error message"
}
```

HTTP status codes:
- `400` - Bad request (invalid input)
- `403` - Forbidden (auth/token issues)
- `404` - Not found
- `409` - Conflict (duplicate)
- `500` - Server error
