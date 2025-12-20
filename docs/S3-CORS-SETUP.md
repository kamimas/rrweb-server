# S3 CORS Configuration for Direct Uploads

Starting with recorder v2.0.0, session recording data is uploaded directly from the browser to S3 using presigned URLs. This bypasses the Node.js server for heavy payloads, significantly improving performance and scalability.

## Required CORS Configuration

Your S3 bucket must be configured to accept PUT requests from your frontend domain(s).

### AWS Console Setup

1. Go to **S3** > **Your Bucket** > **Permissions** > **Cross-origin resource sharing (CORS)**
2. Click **Edit** and paste the following JSON configuration:

```json
[
    {
        "AllowedHeaders": [
            "Content-Type",
            "Content-Encoding"
        ],
        "AllowedMethods": [
            "PUT"
        ],
        "AllowedOrigins": [
            "https://yourdomain.com",
            "https://www.yourdomain.com"
        ],
        "ExposeHeaders": [
            "ETag"
        ],
        "MaxAgeSeconds": 3600
    }
]
```

### AWS CLI Setup

```bash
aws s3api put-bucket-cors --bucket your-bucket-name --cors-configuration '{
  "CORSRules": [
    {
      "AllowedHeaders": ["Content-Type", "Content-Encoding"],
      "AllowedMethods": ["PUT"],
      "AllowedOrigins": ["https://yourdomain.com", "https://www.yourdomain.com"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}'
```

## Configuration Options

### AllowedOrigins

Replace with your actual frontend domain(s). For development, you can add:
- `http://localhost:3000` (or your dev port)
- `http://localhost:5173` (Vite default)

**Security Note:** Never use `"*"` in production. Always specify exact origins.

### Multiple Domains

If you have multiple frontend domains uploading to the same bucket:

```json
{
    "AllowedOrigins": [
        "https://app.example.com",
        "https://dashboard.example.com",
        "https://staging.example.com"
    ]
}
```

## Verifying Your Configuration

### 1. Check CORS Headers

```bash
curl -I -X OPTIONS \
  -H "Origin: https://yourdomain.com" \
  -H "Access-Control-Request-Method: PUT" \
  "https://your-bucket.s3.amazonaws.com/test"
```

Expected response headers:
```
Access-Control-Allow-Origin: https://yourdomain.com
Access-Control-Allow-Methods: PUT
```

### 2. Browser DevTools Check

1. Open Chrome DevTools > Network tab
2. Start a recording on your site
3. Look for requests to `*.s3.*.amazonaws.com`
4. Verify the request succeeds (200 OK)

### Common Errors

#### `Access to fetch at 's3...' from origin '...' has been blocked by CORS policy`

**Cause:** CORS not configured or AllowedOrigins doesn't match.

**Fix:**
1. Verify the exact origin (including protocol and port)
2. Check for trailing slashes
3. Ensure the CORS config is saved

#### `403 Forbidden` on PUT

**Cause:** Presigned URL expired or bucket policy blocks the upload.

**Fix:**
1. Presigned URLs expire in 60 seconds - ensure upload starts immediately
2. Check bucket policy allows `s3:PutObject` for the IAM user/role

## How Direct Upload Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Direct Upload Flow                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Browser                    Server                    S3             │
│    │                          │                        │             │
│    │  1. POST /upload-url     │                        │             │
│    │  (tiny JSON: ~200B)      │                        │             │
│    │─────────────────────────>│                        │             │
│    │                          │                        │             │
│    │  2. { uploadUrl, s3Key } │                        │             │
│    │<─────────────────────────│                        │             │
│    │                          │                        │             │
│    │  3. PUT uploadUrl        │                        │             │
│    │  (gzipped events: ~50KB) │                        │             │
│    │────────────────────────────────────────────────>│             │
│    │                          │                        │             │
│    │  4. 200 OK               │                        │             │
│    │<────────────────────────────────────────────────│             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Benefits:**
- Node.js server handles only lightweight metadata requests (~200 bytes)
- Heavy event payloads (50KB-500KB) go directly to S3
- No CPU blocking from JSON.parse or gzip decompression on server
- Better horizontal scaling (stateless presigned URL generation)

## Troubleshooting

### Uploads Work in Development but Not Production

1. Check that production domain is in AllowedOrigins
2. Verify HTTPS is used (HTTP won't work with most CORS configs)
3. Check for CDN/proxy headers that might change the Origin

### Partial Upload Failures

The system is designed to be resilient:
- If presigned URL generation fails, the upload is skipped (events may be lost)
- If S3 upload fails, the DB record exists but points to missing file
- The playback system gracefully handles missing chunks

### Debugging

Enable verbose logging in recorder.js:
```javascript
window.RRWEB_DEBUG = true;
```

Check browser console for:
- `🎫 Got presigned URL for: ...` - URL generation succeeded
- `✅ Direct upload complete` - S3 upload succeeded
- `❌ Direct upload failed` - Check error message
