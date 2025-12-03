# Next.js App Router Integration Guide - Lessons Learned

## Project Overview

This is a **campaign-based session recording system** built as a cost-effective alternative to PostHog. It captures user interactions for targeted debugging, funnel analysis, and support.

**Key Use Cases:**
- Debug production issues by watching exact user sessions
- Analyze where users drop off in critical flows (checkout, signup, onboarding)
- Link recordings to user emails for support tickets
- Record beta users testing new features

---

## Critical Lessons Learned from Next.js Integration

### 1. **App Router vs Pages Router - IMPORTANT**

Next.js 13+ uses **App Router** (with `src/app/` directory), NOT Pages Router (`pages/` directory).

**Key Differences:**
- ❌ No `_document.js` file in App Router
- ✅ Use `src/app/layout.tsx` instead
- ❌ Can't use inline `<script>` tags in `<head>` (causes hydration errors)
- ✅ Use Next.js `Script` component with proper strategies
- All layout components are Server Components by default

---

### 2. **Script Loading Order is Critical**

The recorder needs `window.RRWEB_SERVER_URL` set **BEFORE** it loads, otherwise it tries to fetch `/config` from the Next.js app instead of the recording server.

**Wrong Approach (Causes Errors):**
```tsx
// ❌ This fails - recorder loads before RRWEB_SERVER_URL is set
<script src="http://localhost:3000/recorder.js"></script>
<script>window.RRWEB_SERVER_URL = "..."</script>
```

**Correct Approach:**
```tsx
import Script from 'next/script'

<Script
    id="rrweb-config"
    strategy="beforeInteractive"  // Loads FIRST
>
    {`window.RRWEB_SERVER_URL = "http://localhost:3000/upload-session";`}
</Script>

<Script
    src="http://localhost:3000/recorder.js"
    strategy="afterInteractive"  // Loads AFTER
    data-domain-key="YOUR_TOKEN_HERE"
/>
```

---

### 3. **CORS Must Be Enabled**

When your Next.js app runs on a different port (e.g., `localhost:3003`) than the recording server (`localhost:3000`), you need CORS.

**Server-side fix (in `server.js`):**
```javascript
// Add BEFORE other middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
```

---

### 4. **Domain Token Must Match Your App's Domain**

Each domain needs its own token in `.env`:

**Development Setup:**
```env
ALLOWED_DOMAINS={"localhost:3000":{"bucket":"session-recording-penseum","token":"TOKEN_FOR_3000"},"localhost:3003":{"bucket":"session-recording-penseum","token":"TOKEN_FOR_3003"}}
```

**Generate token:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Use the correct token** in your Next.js app:
```tsx
<Script
    src="http://localhost:3000/recorder.js"
    data-domain-key="TOKEN_FOR_3003"  // Must match localhost:3003 token
/>
```

---

### 5. **Campaigns Must Exist Before Recording**

The recorder will fail if the campaign doesn't exist. Create campaigns first:

```bash
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name": "test_nextjs"}'
```

**Check existing campaigns:**
```bash
curl http://localhost:3000/api/campaigns
```

---

### 6. **Client Component for Recording Logic**

Since you need to use React hooks and browser APIs, create a separate client component.

**File: `src/components/SessionRecorder.tsx`**
```tsx
'use client'

import { useEffect } from 'react'

export default function SessionRecorder() {
    useEffect(() => {
        if (window.recorder && window.recorder.ready) {
            window.recorder.ready.then(() => {
                window.recorder.startRecording({ campaign: 'test_nextjs' })
                console.log('Session recording started')
            })
        }
    }, [])

    return null
}
```

**Important:** This component renders nothing (`return null`) - it just starts recording.

---

### 7. **TypeScript Declarations**

Create type definitions to avoid TypeScript errors.

**File: `src/types/recorder.d.ts`**
```typescript
interface RecorderOptions {
  campaign: string
  timeout?: number
}

interface Recorder {
  ready: Promise<void>
  startRecording(options: RecorderOptions): void
  stopRecording(): void
  isRecording(): boolean
  getCampaign(): string | null
  identify(email: string): Promise<any>
}

declare global {
  interface Window {
    recorder: Recorder
    RRWEB_SERVER_URL?: string
  }
}

export {}
```

---

## Complete Working Implementation

### Step 1: Add Scripts to Layout

**File: `src/app/layout.tsx`**

```tsx
import Script from 'next/script'
import SessionRecorder from "@/components/SessionRecorder"

export default async function RootLayout({ children }) {
    // ... your existing code

    return (
        <html lang={locale}>
            <head>
                {/* Your existing head content */}
            </head>
            <body>
                {/* Set recorder server URL FIRST */}
                <Script
                    id="rrweb-config"
                    strategy="beforeInteractive"
                >
                    {`window.RRWEB_SERVER_URL = "http://localhost:3000/upload-session";`}
                </Script>

                {/* Load recorder script SECOND */}
                <Script
                    src="http://localhost:3000/recorder.js"
                    strategy="afterInteractive"
                    data-domain-key="1ad944890363deae9f927265856e5e597342907633206ab0f5067d1df17a6783"
                />

                {/* Your app content */}
                <YourProviders>
                    <SessionRecorder />  {/* Add this */}
                    {children}
                </YourProviders>
            </body>
        </html>
    )
}
```

### Step 2: Create SessionRecorder Component

**File: `src/components/SessionRecorder.tsx`**

```tsx
'use client'

import { useEffect } from 'react'

export default function SessionRecorder() {
    useEffect(() => {
        if (window.recorder && window.recorder.ready) {
            window.recorder.ready.then(() => {
                window.recorder.startRecording({ campaign: 'test_nextjs' })
                console.log('Session recording started')
            })
        }
    }, [])

    return null
}
```

### Step 3: Create TypeScript Declarations

**File: `src/types/recorder.d.ts`**

```typescript
interface RecorderOptions {
  campaign: string
  timeout?: number
}

interface Recorder {
  ready: Promise<void>
  startRecording(options: RecorderOptions): void
  stopRecording(): void
  isRecording(): boolean
  getCampaign(): string | null
  identify(email: string): Promise<any>
}

declare global {
  interface Window {
    recorder: Recorder
    RRWEB_SERVER_URL?: string
  }
}

export {}
```

### Step 4: Create Campaign on Server

```bash
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name": "test_nextjs"}'
```

---

## User Identification Integration

To link sessions to user emails (for searching sessions by email):

### Option 1: Identify on Login

```tsx
'use client'

export default function LoginPage() {
  const handleLogin = async (email: string, password: string) => {
    const user = await login(email, password)

    // Identify user for session recording
    if (window.recorder && user?.email) {
      window.recorder.identify(user.email)
        .then(() => console.log('User identified:', user.email))
        .catch(err => console.error('Identify failed:', err))
    }
  }

  return <div>Login form...</div>
}
```

### Option 2: Identify in SessionRecorder (If Already Logged In)

```tsx
'use client'

import { useEffect } from 'react'
import { useUser } from '@/hooks/useUser' // your auth hook

export default function SessionRecorder() {
    const { user } = useUser()

    // Start recording
    useEffect(() => {
        if (window.recorder && window.recorder.ready) {
            window.recorder.ready.then(() => {
                window.recorder.startRecording({ campaign: 'test_nextjs' })
                console.log('Session recording started')
            })
        }
    }, [])

    // Identify user when logged in
    useEffect(() => {
        if (user?.email && window.recorder) {
            window.recorder.identify(user.email)
                .then(() => console.log('User identified:', user.email))
                .catch(err => console.error('Identify failed:', err))
        }
    }, [user])

    return null
}
```

**Search sessions by email:**
```bash
curl 'http://localhost:3000/api/sessions?email=user@example.com'
```

---

## Testing Checklist

### 1. Verify Recorder Loads
Open browser console and type:
```javascript
window.recorder
```
Should return an object with methods: `startRecording`, `stopRecording`, etc.

### 2. Verify Server URL is Set
```javascript
window.RRWEB_SERVER_URL
```
Should return: `"http://localhost:3000/upload-session"`

### 3. Manual Start Recording Test
```javascript
window.recorder.startRecording({ campaign: 'test_nextjs' })
```
Should see: `"Recorder: Recording started, campaign: test_nextjs session: sess_xxxxx"`

### 4. Check Server Logs
After recording and closing tab, server should show:
```
✅ Session saved locally: sess_xxxxx.json
📋 Campaign: test_nextjs
📊 Events captured: X
🌐 Page URL: http://localhost:3003/...
📇 Indexed session chunk: sess_xxxxx -> campaign:test_nextjs
☁️  Uploaded to S3: sessions/sess_xxxxx.json
```

### 5. Verify Session is Stored
```bash
curl 'http://localhost:3000/api/sessions?campaign=test_nextjs'
```

---

## Common Errors and Solutions

### Error: "Failed to fetch /config" or "Unexpected token '<'"
**Cause:** `window.RRWEB_SERVER_URL` not set before recorder.js loads
**Solution:** Use `Script` component with `strategy="beforeInteractive"` for config

### Error: "CORS policy: No 'Access-Control-Allow-Origin'"
**Cause:** Next.js app on different port than recording server
**Solution:** Add CORS middleware to server.js (see section 3 above)

### Error: "Campaign not found: test_nextjs"
**Cause:** Campaign doesn't exist on server
**Solution:** Create campaign via API first

### Error: "Domain not allowed or token invalid"
**Cause:** Domain token mismatch
**Solution:** Ensure token in `data-domain-key` matches the token for your app's domain in `.env`

### Error: Hydration mismatch warnings
**Cause:** Using inline `<script>` tags in `<head>` with server-rendered content
**Solution:** Use Next.js `Script` component in `<body>` instead

### No recording happening (no errors)
**Cause:** SessionRecorder component not calling startRecording
**Solution:**
1. Check SessionRecorder is imported in layout.tsx
2. Check it's rendered in the component tree
3. Check browser console for "Session recording started" message

---

## Production Deployment Considerations

### 1. Environment Variables
Create `.env.local` for development and use env vars in production:

```env
# .env.local (development)
NEXT_PUBLIC_RECORDER_URL=http://localhost:3000
NEXT_PUBLIC_RECORDER_TOKEN=1ad944890363deae9f927265856e5e597342907633206ab0f5067d1df17a6783

# .env.production
NEXT_PUBLIC_RECORDER_URL=https://recording.penseum.com
NEXT_PUBLIC_RECORDER_TOKEN=production_token_here
```

**Use in layout.tsx:**
```tsx
<Script id="rrweb-config" strategy="beforeInteractive">
    {`window.RRWEB_SERVER_URL = "${process.env.NEXT_PUBLIC_RECORDER_URL}/upload-session";`}
</Script>

<Script
    src={`${process.env.NEXT_PUBLIC_RECORDER_URL}/recorder.js`}
    strategy="afterInteractive"
    data-domain-key={process.env.NEXT_PUBLIC_RECORDER_TOKEN}
/>
```

### 2. Production Domain Token
Generate a new token for production domain:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to server `.env`:
```env
ALLOWED_DOMAINS={"penseum.com":{"bucket":"session-recording-penseum","token":"PRODUCTION_TOKEN_HERE"}}
```

### 3. HTTPS Required
In production, recording server must use HTTPS. Self-signed certificates won't work - browsers will block mixed content.

### 4. Subdomain Setup (Recommended)
Deploy recording server on subdomain like `recording.penseum.com` to avoid CORS issues entirely.

---

## Performance Considerations

### What Gets Recorded:
- Mouse movements and clicks
- Keyboard inputs (passwords are automatically masked)
- Scroll events
- Page navigation
- DOM changes
- Form submissions

### Upload Behavior:
- **Auto-upload every 60 seconds**
- **Upload on page close/refresh**
- **Gzip compression** (reduces payload by ~80%)
- Recording persists across page navigation in same tab
- New session created after 30 minutes of inactivity

### Data Size:
Real example from testing:
- 151 events from `/explore` page
- Compressed: 121KB → Uncompressed: 964KB
- Compression saved 87.4%

---

## API Quick Reference

### Recorder Methods
```javascript
// Wait for recorder to load
await window.recorder.ready

// Start recording (required: campaign must exist)
window.recorder.startRecording({
  campaign: 'test_nextjs',
  timeout: 20 * 60 * 1000  // Optional: auto-stop after 20 minutes
})

// Stop recording
window.recorder.stopRecording()

// Check status
window.recorder.isRecording()  // returns boolean

// Get current campaign
window.recorder.getCampaign()  // returns string | null

// Link to user email
await window.recorder.identify('user@example.com')
```

### Server API Endpoints
```bash
# Create campaign
POST /api/campaigns
Body: { "name": "campaign_name" }

# List campaigns
GET /api/campaigns

# List sessions by campaign
GET /api/sessions?campaign=test_nextjs
GET /api/sessions?campaign_id=1

# List sessions by user email
GET /api/sessions?email=user@example.com

# Get playback data (merged events from all chunks)
GET /api/sessions/:session_id/playback
```

---

## Viewing Recordings

### Method 1: Simple Player
1. Copy session file: `cp public/sessions/sess_xxx.json session.json`
2. Open: `http://localhost:3000/player-simple.html`
3. Recording plays automatically

### Method 2: Full Player
1. Open: `http://localhost:3000/player.html`
2. Enter session URL: `http://localhost:3000/api/sessions/sess_xxx/playback`
3. Click "Load Session"

### Method 3: API Query + Player
```bash
# Get sessions
curl 'http://localhost:3000/api/sessions?campaign=test_nextjs'

# Copy playback_url from response
# Paste into player.html
```

---

## Troubleshooting Development

### Enable Debug Logging
Check browser console for:
```javascript
// Recorder loaded?
console.log('Recorder:', window.recorder)

// Server URL set?
console.log('Server URL:', window.RRWEB_SERVER_URL)

// Recording active?
console.log('Is recording:', window.recorder?.isRecording())

// Current campaign?
console.log('Campaign:', window.recorder?.getCampaign())
```

### Check Network Tab
Look for:
- `recorder.js` - should be 200 or 304 (cached)
- `/config` - should go to `localhost:3000/config` (not your Next.js app)
- `/upload-session` - should POST to `localhost:3000/upload-session`

### Check Server Logs
Server logs show detailed info:
```
📥 Upload received - Session: sess_xxx, Host: localhost:3003, Campaign: test_nextjs, Events: 151
✅ Campaign validated: test_nextjs (ID: 3)
✅ Domain verified: localhost:3003
✅ Session saved locally: sess_xxx.json
📋 Campaign: test_nextjs
📊 Events captured: 151
🌐 Page URL: http://localhost:3003/explore
📇 Indexed session chunk
☁️  Uploaded to S3
```

---

## Security Best Practices

1. **Never commit `.env` file** - it's already in `.gitignore`
2. **Rotate domain tokens** if exposed in git history
3. **Use different tokens** for dev/staging/production
4. **Consider user consent** - add opt-in for recording if required by privacy policy
5. **Don't record sensitive pages** - payment pages, settings with PII, etc.
6. **Set reasonable timeouts** to avoid long recordings
7. **Regular cleanup** - delete old sessions to save storage

---

## Summary: What Works

✅ **Next.js App Router** with Server Components
✅ **Script component** with `beforeInteractive` and `afterInteractive` strategies
✅ **Client component** (SessionRecorder) for recording logic
✅ **CORS enabled** for cross-origin requests
✅ **Domain token** matching Next.js app domain
✅ **Campaign-based recording** with pre-created campaigns
✅ **User identification** via email
✅ **TypeScript support** with proper declarations
✅ **Automatic uploads** every 60 seconds + on page close
✅ **Gzip compression** reducing payload by ~80%
✅ **S3 storage** with local fallback
✅ **SQLite indexing** for fast session lookup
✅ **Cross-page recording** - maintains session across navigation

**Result:** Full session recording working in Next.js 13+ App Router with minimal code and zero performance impact.
