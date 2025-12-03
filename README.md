# rrweb Server 

This is an application for capturing rrweb sessions with enhanced plugins and multi-domain support.  

It allows website owners to simply add a recorder script to their site and start capturing user sessions.  

The backend validates each session using a pre-shared domain token and routes session data to the correct AWS S3 bucket.  

Optional console log recording and replay can be enabled via configuration.

## Quick Start (React/Next.js)

The fastest way to add session recording to your React or Next.js app:

```tsx
// 1. Add scripts to your layout
<Script id="rrweb-config" strategy="beforeInteractive">
  {`window.RRWEB_SERVER_URL = "http://localhost:3000/upload-session";`}
</Script>
<Script
  src="http://localhost:3000/recorder.js"
  strategy="afterInteractive"
  data-domain-key="YOUR_TOKEN_HERE"
/>

// 2. Wrap your app
import { RecorderProvider } from '@/components/RecorderProvider'

<RecorderProvider campaign="my_app" autoStart={true}>
  {children}
</RecorderProvider>
```

That's it! Sessions are now being recorded. See [RECORDER_PROVIDER_GUIDE.md](./RECORDER_PROVIDER_GUIDE.md) for full documentation.

## Features

- **Campaign-Based Recording:** Organize recordings by purpose (checkout_flow, bug_reports, etc.)
- **React Integration:** `RecorderProvider` component with hooks for seamless React/Next.js integration
- **Lazy Loading:** Libraries load on-demand (92% reduction in initial page load: 130KB → 10KB)
- **User Identification:** Link sessions to user emails for support and debugging
- **Continuous Session Capture:** Uses localStorage to merge events across page navigations
- **Enhanced Recording:**
  - **rrdom & rrdom-nodejs** for DOM snapshot handling
  - **rrvideo** for video operations
  - **Sequential ID Plugins** for recording and replay
  - **Optional Console Plugins** for recording/replaying console logs
- **Multi-Domain Support:** Backend verifies incoming sessions via pre-shared tokens
- **Secure Uploads:** Sessions stored in AWS S3 with signed URLs (valid for 1 hour)
- **SQLite Indexing:** Fast session lookup by campaign, email, or session ID
- **Gzip Compression:** ~80% reduction in upload payload size
- **Playback Interface:** Simple player to load and replay sessions
- **Dockerized:** Easily build and deploy via Docker
- **TypeScript Support:** Full type definitions for React integration



## Setup

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/alokemajumder/rrweb-server.git
   cd rrweb-server
   
Configure Environment Variables:
   ```bash 
Rename .env.example to .env.
Update AWS credentials, allowed domains, and other settings.
Set ENABLE_CONSOLE_PLUGIN to "true" or "false" as desired.
```
Build and Run with Docker:

   ```bash 
docker build -t rrweb-session-capture .
docker run -p 3000:3000 --env-file .env rrweb-session-capture
```

## Recorder Script Integration

### Option 1: React/Next.js (Recommended)

For React and Next.js projects, use the `RecorderProvider` component for the simplest integration:

```tsx
import { RecorderProvider } from '@/components/RecorderProvider'

<RecorderProvider campaign="my_app" autoStart={true}>
  {children}
</RecorderProvider>
```

**Benefits:**
- One-line integration
- Auto-start recording
- Auto-identify users
- TypeScript support
- React hooks API

See [RECORDER_PROVIDER_GUIDE.md](./RECORDER_PROVIDER_GUIDE.md) for complete React integration guide.

### Option 2: Plain HTML/JavaScript (Self-Hosted)

Download the `recorder.js` file from the repository and host it on your own server. Then, on your website, include the recorder script in your `<head>` tag as follows:
```html
<script  src="https://yourdomain.com/path/to/recorder.js"
data-domain-key="YOUR_DOMAIN_TOKEN_FOR_DOMAIN_COM"></script>
```
Replace `https://yourdomain.com/path/to/recorder.js` with the actual URL where you host the file, and update the `data-domain-key` value with the token for your domain.

See [FRONTEND_INTEGRATION_GUIDE.md](./FRONTEND_INTEGRATION_GUIDE.md) for detailed integration examples.


## Playback

Access the playback interface at http://yourserver:3000/playback.html and enter a session URL to view recordings.

## Documentation

- **[RECORDER_PROVIDER_GUIDE.md](./RECORDER_PROVIDER_GUIDE.md)** - Complete React/Next.js integration guide with RecorderProvider
- **[FRONTEND_INTEGRATION_GUIDE.md](./FRONTEND_INTEGRATION_GUIDE.md)** - Manual integration guide for all frameworks
- **[NEXTJS_APP_ROUTER_INTEGRATION.md](./NEXTJS_APP_ROUTER_INTEGRATION.md)** - Next.js 13+ App Router specific lessons and troubleshooting
- **[LAZY_LOADING_IMPLEMENTATION.md](./LAZY_LOADING_IMPLEMENTATION.md)** - Performance optimization details and lazy loading implementation
- **[docs/API.md](./docs/API.md)** - Complete API reference for server endpoints and recorder methods

## Contributing

Contributions to this project are very welcome! Whether you’re fixing bugs, suggesting improvements, or adding new features, please follow these guidelines:

-   **Fork the Repository:**  
    Create a fork on GitHub and clone your fork locally.
    
-   **Create a Branch:**  
    Use a descriptive branch name (e.g., `fix/bug-description` or `feature/new-enhancement`).
    
-   **Write Clear Commit Messages:**  
    Ensure your commit messages accurately describe the changes you have made.
    
-   **Submit a Pull Request:**  
    Once your changes are ready, submit a pull request against the `main` branch. Please provide a detailed description of your changes and reference any issues or feature requests.
    
    
-   **Report Issues:**  
    If you find a bug or have a feature request, please open an issue on GitHub with as much detail as possible.
    
-   **Testing:**  
    If you add new functionality, include tests to cover your changes, ensuring the project remains stable.
    

Thank you for considering contributing to **rrweb Server**. Your help is appreciated!

## About rrweb

[rrweb](https://github.com/rrweb-io/rrweb) is an open-source web session recording library that enables you to capture, store, and replay user interactions on web applications. It is designed to help developers understand user behavior, debug issues, and analyze sessions without compromising performance.

### Key Features

- **Comprehensive Recording & Replay:**  
  rrweb captures a wide variety of events (such as clicks, scrolls, mouse movements, input changes, etc.) and DOM snapshots, allowing you to faithfully replay user sessions.
  
- **Lightweight and Efficient:**  
  Optimized to minimize the impact on user experience while recording sessions in real time.
  
- **Extensible Architecture:**  
  Supports a plugin-based architecture, enabling additional functionalities such as:
  - **Sequential ID Plugins:**  
    Ensuring consistent assignment of identifiers to DOM nodes for accurate replays.
  - **Console Record/Replay Plugins:**  
    Optionally capture and replay console logs, providing insights into client-side errors or debugging information.
  - **DOM Snapshot Plugins:**  
    With tools like `rrdom` and `rrdom-nodejs`, it efficiently captures the state of the DOM.
  - **Video Operations:**  
    Integrated via packages like `rrvideo` for enhanced multimedia support.

### rrweb in This Project

In our project, rrweb is a core component that powers both the recording and replay functionalities:

- **Client-Side Recorder:**  
  The self-hosted recorder script uses rrweb to capture user sessions. It merges events across page navigations using localStorage and integrates additional plugins (sequential ID, optional console record, and video plugins) to enhance the recording experience.
  
- **Server-Side Integration:**  
  Although primarily used for session storage and retrieval, the backend includes packages such as `rrdom` and `rrdom-nodejs` for potential advanced DOM processing if required.
  
- **Session Playback:**  
  The playback interface leverages `rrweb-player` to recreate recorded sessions accurately. It also utilizes the sequential ID replay and, optionally, the console replay plugins to provide a comprehensive playback experience.

For more detailed information and usage examples, please visit the [rrweb GitHub repository](https://github.com/rrweb-io/rrweb).

