# Next.js Integration Guide for rrweb Session Recording

## Quick Start

### 1. Add the Recorder Script to Your Next.js App

**For App Router (Next.js 13+):**

Create or edit `app/layout.tsx` (or `app/layout.js`):

```tsx
import Script from 'next/script'

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Add the recorder script */}
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

**For Pages Router (Next.js 12 and below):**

Create or edit `pages/_document.js`:

```jsx
import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html>
      <Head>
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

---

## 2. Create Campaigns First

Before recording, create campaigns via API or use existing ones:

```bash
# Create a campaign for checkout flow
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name": "checkout_flow"}'

# Create a campaign for onboarding
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name": "user_onboarding"}'
```

---

## 3. Start/Stop Recording in Your Code

### Example: Record Checkout Flow

```tsx
'use client' // or use useEffect in pages router

import { useEffect } from 'react'

export default function CheckoutPage() {
  useEffect(() => {
    // Wait for recorder to be ready
    if (window.recorder && window.recorder.ready) {
      window.recorder.ready.then(() => {
        // Start recording when user enters checkout
        window.recorder.startRecording({
          campaign: 'checkout_flow',
          timeout: 20 * 60 * 1000  // Auto-stop after 20 minutes
        })
      })
    }

    // Stop recording when checkout completes
    return () => {
      if (window.recorder && window.recorder.isRecording()) {
        window.recorder.stopRecording()
      }
    }
  }, [])

  return <div>Your checkout page...</div>
}
```

### Example: Record User Onboarding

```tsx
'use client'

import { useEffect } from 'react'

export default function OnboardingFlow() {
  useEffect(() => {
    if (window.recorder && window.recorder.ready) {
      window.recorder.ready.then(() => {
        window.recorder.startRecording({
          campaign: 'user_onboarding',
          timeout: 15 * 60 * 1000  // 15 minutes
        })
      })
    }
  }, [])

  const handleComplete = () => {
    // Stop recording when onboarding completes
    if (window.recorder) {
      window.recorder.stopRecording()
    }
  }

  return (
    <div>
      <h1>Welcome!</h1>
      <button onClick={handleComplete}>Complete Onboarding</button>
    </div>
  )
}
```

---

## 4. Identify Users (Optional)

Link sessions to user emails for easier lookup:

```tsx
'use client'

import { useEffect } from 'react'

export default function ProfilePage({ user }) {
  useEffect(() => {
    if (window.recorder && user?.email) {
      window.recorder.identify(user.email)
        .then(() => console.log('User identified:', user.email))
        .catch(err => console.error('Identification failed:', err))
    }
  }, [user])

  return <div>Profile page...</div>
}
```

---

## 5. TypeScript Declarations (Optional)

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
  RRWEB_SERVER_URL?: string
}
```

---

## 6. Environment Variables

For production, use environment variables:

```env
# .env.local
NEXT_PUBLIC_RRWEB_SERVER_URL=https://your-rrweb-server.com
NEXT_PUBLIC_RRWEB_DOMAIN_KEY=your_production_token_here
```

Then update your script tag:

```tsx
<Script
  src={`${process.env.NEXT_PUBLIC_RRWEB_SERVER_URL}/recorder.js`}
  data-domain-key={process.env.NEXT_PUBLIC_RRWEB_DOMAIN_KEY}
  strategy="afterInteractive"
/>
```

And set the server URL globally:

```tsx
// In layout or _app
useEffect(() => {
  if (typeof window !== 'undefined') {
    window.RRWEB_SERVER_URL = process.env.NEXT_PUBLIC_RRWEB_SERVER_URL + '/upload-session'
  }
}, [])
```

---

## 7. Common Patterns

### A. Automatic Recording for All Pages

```tsx
// app/layout.tsx
'use client'

import { useEffect } from 'react'

export default function RootLayout({ children }) {
  useEffect(() => {
    if (window.recorder && window.recorder.ready) {
      window.recorder.ready.then(() => {
        // Check if not already recording
        if (!window.recorder.isRecording()) {
          window.recorder.startRecording({
            campaign: 'general_usage',
            timeout: 30 * 60 * 1000  // 30 minutes
          })
        }
      })
    }
  }, [])

  return <html><body>{children}</body></html>
}
```

### B. Conditional Recording (Only for Specific Users)

```tsx
useEffect(() => {
  // Only record for beta users
  if (user?.isBetaTester && window.recorder) {
    window.recorder.ready.then(() => {
      window.recorder.startRecording({
        campaign: 'beta_testing'
      })
    })
  }
}, [user])
```

### C. Record Only on Errors

```tsx
useEffect(() => {
  const handleError = (error) => {
    // Start recording when error occurs
    if (window.recorder && !window.recorder.isRecording()) {
      window.recorder.ready.then(() => {
        window.recorder.startRecording({
          campaign: 'error_sessions',
          timeout: 5 * 60 * 1000  // 5 minutes
        })
      })
    }
  }

  window.addEventListener('error', handleError)
  return () => window.removeEventListener('error', handleError)
}, [])
```

---

## 8. View Recordings

### List Sessions by Campaign

```bash
curl http://localhost:3000/api/sessions?campaign=checkout_flow
```

### List Sessions by Email

```bash
curl http://localhost:3000/api/sessions?email=user@example.com
```

### Play Recording

1. Open [http://localhost:3000/player.html](http://localhost:3000/player.html)
2. Use the session playback URL from the API response
3. Or use the quick access buttons to list/load sessions

---

## API Reference

### Recorder Methods

```javascript
// Wait for recorder to load
await window.recorder.ready

// Start recording
window.recorder.startRecording({
  campaign: 'my_campaign',     // required
  timeout: 20 * 60 * 1000      // optional (milliseconds)
})

// Stop recording
window.recorder.stopRecording()

// Check recording status
window.recorder.isRecording()  // returns boolean

// Get current campaign
window.recorder.getCampaign()  // returns string | null

// Link device to email
await window.recorder.identify('user@example.com')
```

### Server Endpoints

```bash
# Create campaign
POST /api/campaigns
Body: { "name": "campaign_name" }

# List campaigns
GET /api/campaigns

# Get campaign by ID
GET /api/campaigns/:id

# Delete campaign
DELETE /api/campaigns/:id

# List sessions (requires filter)
GET /api/sessions?campaign_id=1
GET /api/sessions?campaign=campaign_name
GET /api/sessions?email=user@example.com

# Get playback data
GET /api/sessions/:session_id/playback
```

---

## Troubleshooting

### Recorder not loading

```javascript
// Check if recorder loaded
console.log('Recorder available:', window.recorder)

// Check for errors in console
window.recorder.ready
  .then(() => console.log('Recorder ready!'))
  .catch(err => console.error('Recorder failed:', err))
```

### Campaign not found error

Make sure the campaign exists before recording:

```bash
# Create it first
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"name": "your_campaign_name"}'
```

### CORS Issues

If your Next.js app runs on a different port (e.g., 3001), update `.env`:

```json
"localhost:3001": {
  "bucket": "session-recording-penseum",
  "token": "generate_a_new_token_for_this_domain"
}
```

---

## Production Deployment

1. **Update domain token** in `.env` for your production domain
2. **Update ALLOWED_DOMAINS** with your production URL
3. **Use HTTPS** for the recorder script in production
4. **Rotate AWS credentials** if they were exposed
5. **Consider privacy**: Only record sessions with user consent
6. **Set up retention policy**: Delete old sessions regularly

---

## Need Help?

- Server logs: Check the terminal running `node server.js`
- Browser console: Check for recorder errors
- Database: `sqlite3 db.sqlite` to inspect stored data
- API testing: Use the test pages at `/test.html` and `/test-identify.html`
