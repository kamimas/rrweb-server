# Session Recording Integration Guide for Frontend Team

## What This Is For

We're implementing **targeted session recording** to capture user interactions for debugging and analysis. This is NOT for recording all users - it's for specific flows we want to investigate (like checkout issues, feature adoption, bug reports, etc.).

### Key Benefits:
- **Debug production issues** - Watch exactly what users did before encountering errors
- **Funnel analysis** - See where users drop off in critical flows
- **Support tickets** - Link recordings to user emails to see what happened
- **Feature testing** - Record beta users trying new features

---

## How It Works

1. **Campaign-Based Recording**: You create a "campaign" (like `checkout_flow` or `signup_funnel`)
2. **Selective Recording**: You manually start/stop recording in specific user flows
3. **User Identification**: Optionally link recordings to user emails
4. **Playback**: View recordings in a player to see exactly what users did

**Important**: Recording only happens when you explicitly call `startRecording()`. Nothing is recorded automatically.

---

## Integration Steps

### Step 1: Add the Recorder Script

**For Next.js App Router (v13+):**

Edit `app/layout.tsx` or `app/layout.js`:

```tsx
import Script from 'next/script'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Session Recorder */}
        <Script
          src="http://localhost:3000/recorder.js"
          data-domain-key="6d4a8cd0fb6b363742837691f30f5fe852c507446ee6f1199521a9b445465596"
          strategy="afterInteractive"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

**For Next.js Pages Router (v12 and below):**

Edit `pages/_document.js` or create it if it doesn't exist:

```jsx
import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html>
      <Head>
        {/* Session Recorder */}
        <script
          src="http://localhost:3000/recorder.js"
          data-domain-key="6d4a8cd0fb6b363742837691f30f5fe852c507446ee6f1199521a9b445465596"
        ></script>
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
```

**For Plain React / Other Frameworks:**

Add to your `public/index.html` in the `<head>`:

```html
<script
  src="http://localhost:3000/recorder.js"
  data-domain-key="6d4a8cd0fb6b363742837691f30f5fe852c507446ee6f1199521a9b445465596"
></script>
```

---

### Step 2: Create Campaigns (Backend Task)

**Before recording**, campaigns must be created via API. Work with your backend team or run this yourself:

```bash
# Create campaign for checkout flow
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name": "checkout_flow"}'

# Create campaign for signup
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name": "user_signup"}'

# Create campaign for bug reports
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name": "bug_reports"}'
```

**List all campaigns:**
```bash
curl http://localhost:3000/api/campaigns
```

---

### Step 3: Start Recording in Your Code

#### Example 1: Record Checkout Flow

```tsx
'use client' // or useEffect in pages router

import { useEffect } from 'react'

export default function CheckoutPage() {
  useEffect(() => {
    // Start recording when user enters checkout
    if (window.recorder && window.recorder.ready) {
      window.recorder.ready.then(() => {
        window.recorder.startRecording({
          campaign: 'checkout_flow',
          timeout: 20 * 60 * 1000  // Auto-stop after 20 minutes
        })
      })
    }

    // Stop recording when component unmounts or checkout completes
    return () => {
      if (window.recorder && window.recorder.isRecording()) {
        window.recorder.stopRecording()
      }
    }
  }, [])

  const handleCheckoutComplete = () => {
    // Stop recording on success
    if (window.recorder) {
      window.recorder.stopRecording()
    }
    // ... your checkout logic
  }

  return <div>Your checkout UI...</div>
}
```

#### Example 2: Record User Signup

```tsx
'use client'

import { useEffect } from 'react'

export default function SignupFlow() {
  useEffect(() => {
    if (window.recorder && window.recorder.ready) {
      window.recorder.ready.then(() => {
        window.recorder.startRecording({
          campaign: 'user_signup',
          timeout: 15 * 60 * 1000  // 15 minutes
        })
      })
    }
  }, [])

  const handleSignupComplete = async (email: string) => {
    // Link this recording to the user's email
    if (window.recorder) {
      await window.recorder.identify(email)
      window.recorder.stopRecording()
    }
    // ... your signup logic
  }

  return <div>Signup form...</div>
}
```

#### Example 3: Record When User Reports a Bug

```tsx
const handleBugReport = () => {
  // Start recording when user clicks "Report Bug"
  if (window.recorder && window.recorder.ready) {
    window.recorder.ready.then(() => {
      window.recorder.startRecording({
        campaign: 'bug_reports',
        timeout: 10 * 60 * 1000  // 10 minutes
      })
    })
  }

  // Show bug report modal...
}
```

#### Example 4: Identify Logged-In Users

```tsx
'use client'

import { useEffect } from 'react'
import { useUser } from '@/hooks/useUser' // your auth hook

export default function AppLayout({ children }) {
  const { user } = useUser()

  useEffect(() => {
    // Link recordings to user email when they log in
    if (user?.email && window.recorder) {
      window.recorder.identify(user.email)
        .then(() => console.log('User identified for session recording'))
        .catch(err => console.error('Failed to identify user:', err))
    }
  }, [user])

  return <div>{children}</div>
}
```

---

## API Reference

### `window.recorder` Methods

```typescript
// Wait for recorder to be ready (always use this)
await window.recorder.ready

// Start recording
window.recorder.startRecording({
  campaign: string,      // Required - must exist on backend
  timeout?: number       // Optional - auto-stop after N milliseconds
})

// Stop recording
window.recorder.stopRecording()

// Check if currently recording
window.recorder.isRecording()  // returns boolean

// Get current campaign name
window.recorder.getCampaign()  // returns string | null

// Link device to user email
await window.recorder.identify('user@example.com')
```

---

## TypeScript Support (Optional)

Create `types/recorder.d.ts`:

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

interface Window {
  recorder: Recorder
}
```

---

## How Recording Works

### Automatic Behavior:
- **Events upload every 60 seconds** automatically
- **Events upload on page close/refresh** automatically
- **Recording persists across page navigation** (same tab/session)
- **New session created after 30 minutes of inactivity**
- **Compression enabled** - uses gzip to reduce upload size by ~80%

### What Gets Recorded:
- Mouse movements and clicks
- Keyboard inputs (text entered in forms)
- Scroll events
- Page navigation
- DOM changes
- Window resizing
- Form submissions

### What's NOT Recorded:
- Password fields are masked automatically
- Nothing is recorded until you call `startRecording()`
- Recording stops when you call `stopRecording()` or timeout expires

---

## Viewing Recordings

### Option 1: Search by Campaign
```bash
# Get all sessions for a campaign
curl 'http://localhost:3000/api/sessions?campaign=checkout_flow'
```

### Option 2: Search by Email
```bash
# Get all sessions for a user
curl 'http://localhost:3000/api/sessions?email=user@example.com'
```

### Option 3: Use the Player
1. Open: `http://localhost:3000/player.html`
2. Paste a session playback URL
3. Watch the recording

---

## Common Use Cases

### 1. Debug Production Issues
```tsx
// When error boundary catches an error
componentDidCatch(error, errorInfo) {
  // Start recording to capture user's next actions
  if (window.recorder) {
    window.recorder.ready.then(() => {
      window.recorder.startRecording({
        campaign: 'error_recovery',
        timeout: 5 * 60 * 1000
      })
    })
  }
}
```

### 2. Record Beta Users Only
```tsx
useEffect(() => {
  if (user?.isBetaTester && window.recorder) {
    window.recorder.ready.then(() => {
      window.recorder.startRecording({
        campaign: 'beta_testing'
      })
    })
  }
}, [user])
```

### 3. Record Specific Feature Usage
```tsx
const handleFeatureXClick = () => {
  // Start recording when user tries new feature
  if (window.recorder) {
    window.recorder.ready.then(() => {
      window.recorder.startRecording({
        campaign: 'feature_x_usage',
        timeout: 10 * 60 * 1000
      })
    })
  }
  // ... feature logic
}
```

### 4. Conditional Recording (A/B Test)
```tsx
useEffect(() => {
  // Only record 10% of users
  if (Math.random() < 0.1 && window.recorder) {
    window.recorder.ready.then(() => {
      window.recorder.startRecording({
        campaign: 'ab_test_variant_a'
      })
    })
  }
}, [])
```

---

## Troubleshooting

### Recorder not loading
Open browser console and check for:
```javascript
console.log('Recorder available:', window.recorder)
window.recorder.ready
  .then(() => console.log('Recorder ready!'))
  .catch(err => console.error('Recorder failed:', err))
```

### Campaign not found error
Make sure the campaign exists:
```bash
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name": "your_campaign_name"}'
```

### No sessions appearing
- Check browser console for errors
- Make sure you closed the tab (triggers upload)
- Or wait 60 seconds for auto-upload
- Check server logs for upload confirmation

---

## Production Checklist

Before deploying to production:

- [ ] Update recorder URL to production server (not localhost)
- [ ] Get production domain token from backend team
- [ ] Create campaigns on production server
- [ ] Test that recordings work on production domain
- [ ] Consider privacy - only record with user consent if needed
- [ ] Set reasonable timeouts to avoid long recordings
- [ ] Add error handling around recorder calls
- [ ] Document which flows are being recorded

---

## Questions?

**Backend Team Contact**: [Your backend lead]
**Recording Server**: `http://localhost:3000` (dev) / `https://your-production-url.com` (prod)
**API Docs**: See `docs/API.md` in the rrweb-server repo

---

## Examples Summary

```tsx
// ✅ DO: Start recording for specific flows
window.recorder.startRecording({ campaign: 'checkout_flow' })

// ✅ DO: Stop when done
window.recorder.stopRecording()

// ✅ DO: Link to user email
await window.recorder.identify(user.email)

// ❌ DON'T: Forget to create campaigns first
// ❌ DON'T: Record everything (use targeted campaigns)
// ❌ DON'T: Record sensitive pages without user consent
```
