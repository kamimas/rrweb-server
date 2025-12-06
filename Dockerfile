# Use Node 20 with build tools for better-sqlite3 and Chromium for video rendering
FROM node:20-alpine

# Install build dependencies for better-sqlite3 + Chromium + ffmpeg for video rendering
RUN apk add --no-cache \
    python3 make g++ \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    ffmpeg

# Tell Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including native modules)
RUN npm install --omit=dev

# Copy application code
COPY server.js ./
COPY timeline-react-aware.js ./
COPY render-worker.js ./
COPY renderer.html ./
COPY src ./src/
COPY public ./public/

# Create data directory for SQLite and temp directory for video processing
RUN mkdir -p /app/data /app/temp

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/config || exit 1

# Start the application
CMD ["node", "server.js"]
