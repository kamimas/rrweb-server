# RecorderProvider - React Integration Guide

## Overview

The `RecorderProvider` is a React component that wraps your app and provides session recording functionality via React Context. It's inspired by PostHog's `<PostHogProvider>` and makes integration as simple as adding a provider and using hooks.

**Benefits:**
- Simple API - wrap your app and use hooks
- Auto-start recording on mount
- Auto-identify users when logged in
- TypeScript support
- Works with Next.js App Router and Pages Router

---

## Installation

### Step 1: Add Recorder Scripts to Layout

**Next.js App Router (`app/layout.tsx`):**

```tsx
import Script from 'next/script'
import { RecorderProvider } from '@/components/RecorderProvider'

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {/* Set recorder server URL BEFORE loading recorder */}
        <Script
          id="rrweb-config"
          strategy="beforeInteractive"
        >
          {`window.RRWEB_SERVER_URL = "${process.env.NEXT_PUBLIC_RECORDER_URL}/upload-session";`}
        </Script>

        {/* Load recorder script */}
        <Script
          src={`${process.env.NEXT_PUBLIC_RECORDER_URL}/recorder.js`}
          strategy="afterInteractive"
          data-domain-key={process.env.NEXT_PUBLIC_RECORDER_TOKEN}
        />

        {/* Wrap app with RecorderProvider */}
        <RecorderProvider
          campaign="my_app"
          autoStart={true}
        >
          {children}
        </RecorderProvider>
      </body>
    </html>
  )
}
```

### Step 2: Environment Variables

Create `.env.local`:

```env
NEXT_PUBLIC_RECORDER_URL=http://localhost:3000
NEXT_PUBLIC_RECORDER_TOKEN=your_domain_token_here
```

**Production:**
```env
NEXT_PUBLIC_RECORDER_URL=https://recording.yourdomain.com
NEXT_PUBLIC_RECORDER_TOKEN=production_token_here
```

---

## Basic Usage

### Example 1: Auto-Start Recording

```tsx
import { RecorderProvider } from '@/components/RecorderProvider'

export default function RootLayout({ children }) {
  return (
    <RecorderProvider
      campaign="my_app"
      autoStart={true}
      timeout={30 * 60 * 1000} // Auto-stop after 30 minutes
    >
      {children}
    </RecorderProvider>
  )
}
```

**What this does:**
- Automatically starts recording when app loads
- Campaign: `my_app`
- Auto-stops after 30 minutes of recording

---

### Example 2: Auto-Identify Logged-In Users

```tsx
import { RecorderProvider } from '@/components/RecorderProvider'
import { useUser } from '@/hooks/useUser' // your auth hook

export default function AppProvider({ children }) {
  const { user } = useUser()

  return (
    <RecorderProvider
      campaign="my_app"
      autoStart={true}
      user={user} // Pass user object with email
    >
      {children}
    </RecorderProvider>
  )
}
```

**What this does:**
- Auto-identifies user when `user.email` is available
- Links all sessions to user email
- Can search sessions by email later

---

### Example 3: Manual Control with Hooks

```tsx
'use client'

import { useRecorder } from '@/components/RecorderProvider'

export default function CheckoutPage() {
  const { startRecording, stopRecording, isRecording } = useRecorder()

  const handleCheckoutStart = () => {
    startRecording('checkout_flow', 20 * 60 * 1000) // 20 minute timeout
  }

  const handleCheckoutComplete = () => {
    stopRecording()
  }

  return (
    <div>
      <button onClick={handleCheckoutStart}>
        {isRecording ? 'Recording...' : 'Start Checkout'}
      </button>
      <button onClick={handleCheckoutComplete}>Complete</button>
    </div>
  )
}
```

**What this does:**
- Manually start/stop recording at specific points
- Show recording status in UI
- Different campaign per flow

---

## RecorderProvider Props

```typescript
interface RecorderProviderProps {
  children: React.ReactNode
  campaign?: string              // Default campaign name
  autoStart?: boolean            // Auto-start recording on mount (default: false)
  timeout?: number              // Auto-stop timeout in milliseconds
  user?: { email?: string }     // User object - auto-identifies when email present
  serverUrl?: string            // Recording server URL (usually from env var)
  token?: string                // Domain token (usually from env var)
}
```

**Props explained:**

- **`campaign`** (optional): Default campaign name for recordings
- **`autoStart`** (default: `false`): If `true`, starts recording immediately on mount
- **`timeout`** (optional): Auto-stop recording after this many milliseconds
- **`user`** (optional): User object with `email` property - auto-calls `identify()` when present
- **`serverUrl`** (optional): Override server URL (for advanced use)
- **`token`** (optional): Override domain token (for advanced use)

---

## useRecorder() Hook API

```typescript
const {
  recorder,        // Raw recorder instance
  isReady,         // Boolean - is recorder loaded?
  isRecording,     // Boolean - is currently recording?
  startRecording,  // Function to start recording
  stopRecording,   // Function to stop recording
  identify,        // Function to identify user by email
} = useRecorder()
```

### Methods

#### `startRecording(campaign?, timeout?)`

Start recording with optional campaign and timeout override.

```typescript
startRecording('checkout_flow', 15 * 60 * 1000)
```

**Parameters:**
- `campaign` (optional): Campaign name - overrides provider's campaign prop
- `timeout` (optional): Timeout in milliseconds - overrides provider's timeout prop

---

#### `stopRecording()`

Stop current recording.

```typescript
stopRecording()
```

---

#### `identify(email)`

Link current device to user email.

```typescript
await identify('user@example.com')
```

**Returns:** Promise that resolves when identification succeeds

---

## Common Use Cases

### 1. Record Checkout Flow Only

```tsx
// app/checkout/layout.tsx
import { RecorderProvider } from '@/components/RecorderProvider'

export default function CheckoutLayout({ children }) {
  return (
    <RecorderProvider
      campaign="checkout_flow"
      autoStart={true}
      timeout={20 * 60 * 1000}
    >
      {children}
    </RecorderProvider>
  )
}
```

**Result:** Only records when users are in `/checkout/*` pages

---

### 2. Record Beta Users Only

```tsx
import { RecorderProvider } from '@/components/RecorderProvider'
import { useUser } from '@/hooks/useUser'

export default function AppProvider({ children }) {
  const { user } = useUser()
  const shouldRecord = user?.isBetaTester || false

  return (
    <RecorderProvider
      campaign="beta_testing"
      autoStart={shouldRecord}
      user={user}
    >
      {children}
    </RecorderProvider>
  )
}
```

**Result:** Only beta testers are recorded, automatically identified

---

### 3. Conditional Recording (10% Sample)

```tsx
'use client'

import { RecorderProvider } from '@/components/RecorderProvider'
import { useState, useEffect } from 'react'

export default function AppProvider({ children }) {
  const [shouldRecord, setShouldRecord] = useState(false)

  useEffect(() => {
    // Record 10% of sessions
    setShouldRecord(Math.random() < 0.1)
  }, [])

  return (
    <RecorderProvider
      campaign="sampled_sessions"
      autoStart={shouldRecord}
    >
      {children}
    </RecorderProvider>
  )
}
```

**Result:** 10% of users are recorded randomly

---

### 4. Record After Error

```tsx
'use client'

import { useRecorder } from '@/components/RecorderProvider'
import { useEffect } from 'react'

export default function ErrorBoundary({ error, children }) {
  const { startRecording } = useRecorder()

  useEffect(() => {
    if (error) {
      // Start recording when error occurs
      startRecording('error_recovery', 5 * 60 * 1000)
    }
  }, [error, startRecording])

  return children
}
```

**Result:** Recording starts when errors happen, captures recovery actions

---

### 5. Manual Control in Component

```tsx
'use client'

import { useRecorder } from '@/components/RecorderProvider'

export default function FeaturePage() {
  const { startRecording, stopRecording, isRecording, identify } = useRecorder()

  const handleFeatureStart = () => {
    startRecording('feature_x_usage')
  }

  const handleFeatureComplete = async (userEmail: string) => {
    await identify(userEmail) // Link to user
    stopRecording() // Stop recording
  }

  return (
    <div>
      <button onClick={handleFeatureStart}>
        {isRecording ? 'Recording...' : 'Start Feature X'}
      </button>
      <p>Status: {isRecording ? 'Recording' : 'Not recording'}</p>
    </div>
  )
}
```

---

## Next.js App Router Setup (Complete Example)

### File: `app/layout.tsx`

```tsx
import Script from 'next/script'
import { RecorderProvider } from '@/components/RecorderProvider'
import { getUserFromSession } from '@/lib/auth'

export default async function RootLayout({ children }) {
  const user = await getUserFromSession()

  return (
    <html lang="en">
      <body>
        {/* Recorder config */}
        <Script
          id="rrweb-config"
          strategy="beforeInteractive"
        >
          {`window.RRWEB_SERVER_URL = "${process.env.NEXT_PUBLIC_RECORDER_URL}/upload-session";`}
        </Script>

        {/* Recorder script */}
        <Script
          src={`${process.env.NEXT_PUBLIC_RECORDER_URL}/recorder.js`}
          strategy="afterInteractive"
          data-domain-key={process.env.NEXT_PUBLIC_RECORDER_TOKEN}
        />

        {/* App with recording */}
        <RecorderProvider
          campaign="my_app"
          autoStart={true}
          timeout={30 * 60 * 1000}
          user={user}
        >
          {children}
        </RecorderProvider>
      </body>
    </html>
  )
}
```

### File: `.env.local`

```env
NEXT_PUBLIC_RECORDER_URL=http://localhost:3000
NEXT_PUBLIC_RECORDER_TOKEN=1ad944890363deae9f927265856e5e597342907633206ab0f5067d1df17a6783
```

---

## Next.js Pages Router Setup

### File: `pages/_app.tsx`

```tsx
import type { AppProps } from 'next/app'
import { RecorderProvider } from '@/components/RecorderProvider'
import { useUser } from '@/hooks/useUser'

export default function App({ Component, pageProps }: AppProps) {
  const { user } = useUser()

  return (
    <RecorderProvider
      campaign="my_app"
      autoStart={true}
      user={user}
    >
      <Component {...pageProps} />
    </RecorderProvider>
  )
}
```

### File: `pages/_document.tsx`

```tsx
import { Html, Head, Main, NextScript } from 'next/document'
import Script from 'next/script'

export default function Document() {
  return (
    <Html>
      <Head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.RRWEB_SERVER_URL = "${process.env.NEXT_PUBLIC_RECORDER_URL}/upload-session";`
          }}
        />
        <script
          src={`${process.env.NEXT_PUBLIC_RECORDER_URL}/recorder.js`}
          data-domain-key={process.env.NEXT_PUBLIC_RECORDER_TOKEN}
        />
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

## Plain React Setup

### File: `src/main.tsx` or `src/index.tsx`

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { RecorderProvider } from './components/RecorderProvider'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RecorderProvider
      campaign="my_app"
      autoStart={true}
    >
      <App />
    </RecorderProvider>
  </React.StrictMode>
)
```

### File: `public/index.html`

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>My App</title>

    <!-- Recorder config -->
    <script>
      window.RRWEB_SERVER_URL = "http://localhost:3000/upload-session";
    </script>

    <!-- Recorder script -->
    <script
      src="http://localhost:3000/recorder.js"
      data-domain-key="your_token_here"
    ></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

---

## TypeScript Support

The RecorderProvider includes full TypeScript definitions. No additional setup needed!

```tsx
import { useRecorder } from '@/components/RecorderProvider'

const { startRecording, identify } = useRecorder()

// TypeScript knows the signature
startRecording('campaign', 60000) // ✅
identify('user@example.com')      // ✅
```

---

## Comparison: Before vs After

### Before (Manual Integration)

```tsx
'use client'

import { useEffect } from 'react'

export default function SessionRecorder() {
  useEffect(() => {
    if (window.recorder && window.recorder.ready) {
      window.recorder.ready.then(() => {
        window.recorder.startRecording({ campaign: 'test' })
      })
    }
  }, [])

  return null
}
```

**Issues:**
- ❌ Boilerplate in every component
- ❌ Manual ready checks
- ❌ No TypeScript safety
- ❌ Hard to control recording state

---

### After (RecorderProvider)

```tsx
import { RecorderProvider } from '@/components/RecorderProvider'

<RecorderProvider campaign="test" autoStart={true}>
  {children}
</RecorderProvider>
```

**Benefits:**
- ✅ One-line integration
- ✅ Auto-handles ready state
- ✅ Full TypeScript support
- ✅ React Context for state management
- ✅ Simple hooks API

---

## Advanced Patterns

### Pattern 1: Multiple Campaigns

```tsx
'use client'

import { useRecorder } from '@/components/RecorderProvider'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

export default function DynamicRecorder() {
  const { startRecording, stopRecording } = useRecorder()
  const pathname = usePathname()

  useEffect(() => {
    // Different campaign per route
    if (pathname.startsWith('/checkout')) {
      startRecording('checkout_flow')
    } else if (pathname.startsWith('/signup')) {
      startRecording('signup_flow')
    } else {
      stopRecording()
    }

    return () => stopRecording()
  }, [pathname, startRecording, stopRecording])

  return null
}
```

---

### Pattern 2: Recording with Feature Flags

```tsx
import { RecorderProvider } from '@/components/RecorderProvider'
import { useFeatureFlag } from '@/hooks/useFeatureFlag'

export default function AppProvider({ children }) {
  const recordingEnabled = useFeatureFlag('session_recording')

  return (
    <RecorderProvider
      campaign="my_app"
      autoStart={recordingEnabled}
    >
      {children}
    </RecorderProvider>
  )
}
```

---

### Pattern 3: Recording with Analytics

```tsx
'use client'

import { useRecorder } from '@/components/RecorderProvider'
import { useEffect } from 'react'

export default function AnalyticsIntegration() {
  const { startRecording, identify } = useRecorder()

  useEffect(() => {
    // When analytics identifies user, also identify in recorder
    window.analytics?.ready(() => {
      const userId = window.analytics.user().id()
      const userEmail = window.analytics.user().traits().email

      if (userEmail) {
        identify(userEmail)
      }
    })
  }, [identify])

  return null
}
```

---

## Troubleshooting

### RecorderProvider not working

**Check:**
1. Recorder script is loaded in HTML
2. `window.RRWEB_SERVER_URL` is set before recorder loads
3. Campaign exists on server
4. Domain token is correct

**Debug:**
```tsx
const { recorder, isReady } = useRecorder()

console.log('Recorder:', recorder)
console.log('Is ready:', isReady)
```

---

### "useRecorder must be used within RecorderProvider"

**Cause:** Using `useRecorder()` outside RecorderProvider

**Fix:**
```tsx
// ❌ Wrong
export default function App() {
  const { startRecording } = useRecorder() // Error!
  return <div>...</div>
}

// ✅ Correct
export default function App() {
  return (
    <RecorderProvider campaign="my_app">
      <MyComponent /> {/* Can use useRecorder here */}
    </RecorderProvider>
  )
}
```

---

### Auto-identification not working

**Check:**
1. User prop has `email` field
2. Email is not undefined/null
3. Check browser console for errors

**Debug:**
```tsx
<RecorderProvider
  campaign="my_app"
  user={user}
>
  {user?.email && <p>Will identify as: {user.email}</p>}
  {children}
</RecorderProvider>
```

---

## API Reference Summary

### RecorderProvider Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `campaign` | `string` | - | Default campaign name |
| `autoStart` | `boolean` | `false` | Auto-start on mount |
| `timeout` | `number` | - | Auto-stop timeout (ms) |
| `user` | `{ email?: string }` | - | User object for auto-identify |
| `serverUrl` | `string` | - | Server URL override |
| `token` | `string` | - | Domain token override |

### useRecorder() Returns

| Property | Type | Description |
|----------|------|-------------|
| `recorder` | `Recorder \| null` | Raw recorder instance |
| `isReady` | `boolean` | Is recorder loaded? |
| `isRecording` | `boolean` | Currently recording? |
| `startRecording` | `(campaign?, timeout?) => void` | Start recording |
| `stopRecording` | `() => void` | Stop recording |
| `identify` | `(email) => Promise<void>` | Identify user |

---

## Migration Guide

### From Manual Integration

**Before:**
```tsx
// app/layout.tsx
<SessionRecorder />

// components/SessionRecorder.tsx
export default function SessionRecorder() {
  useEffect(() => {
    if (window.recorder?.ready) {
      window.recorder.ready.then(() => {
        window.recorder.startRecording({ campaign: 'my_app' })
      })
    }
  }, [])
  return null
}
```

**After:**
```tsx
// app/layout.tsx
<RecorderProvider campaign="my_app" autoStart={true}>
  {children}
</RecorderProvider>

// Delete components/SessionRecorder.tsx
```

---

## Summary

✅ **One-line integration** - Add provider and you're done
✅ **Auto-start** - Optionally start recording on mount
✅ **Auto-identify** - Pass user object to link sessions
✅ **React hooks** - `useRecorder()` for manual control
✅ **TypeScript** - Full type safety
✅ **Flexible** - Auto or manual control
✅ **Simple API** - Similar to PostHog

**Result:** Session recording integration as simple as:
```tsx
<RecorderProvider campaign="my_app" autoStart={true}>
  {children}
</RecorderProvider>
```
