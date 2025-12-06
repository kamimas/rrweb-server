const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

// Render settings
const FPS = 3;  // 3 frames per second
const WIDTH = 1280;
const HEIGHT = 720;

// Path to renderer.html (relative to this script)
const RENDERER_HTML = path.join(__dirname, 'renderer.html');

/**
 * Render rrweb events to an MP4 video.
 *
 * @param {string} inputJsonPath - Path to the events JSON file
 * @param {string} outputDir - Directory to write video.mp4
 * @returns {Promise<string>} - Path to the output video file
 */
async function renderVideo(inputJsonPath, outputDir) {
    const events = JSON.parse(fs.readFileSync(inputJsonPath, 'utf-8'));

    if (!events || events.length === 0) {
        throw new Error('No events to render');
    }

    const durationMs = events[events.length - 1].timestamp - events[0].timestamp;
    const totalFrames = Math.ceil((durationMs / 1000) * FPS);
    const outputPath = path.join(outputDir, 'video.mp4');

    console.log(`[Render] Starting: ${totalFrames} frames @ ${FPS} FPS (720p)`);
    console.log(`[Render] Duration: ${(durationMs / 1000).toFixed(1)}s`);

    // Spawn FFMPEG process
    const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        '-r', String(FPS),
        '-i', '-',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'ultrafast',
        outputPath
    ]);

    // Handle FFMPEG errors
    ffmpeg.stderr.on('data', (data) => {
        // FFMPEG outputs progress info to stderr, ignore unless it's an error
        const msg = data.toString();
        if (msg.includes('Error') || msg.includes('error')) {
            console.error(`[FFMPEG] ${msg}`);
        }
    });

    // Launch browser
    const browser = await puppeteer.launch({
        headless: 'shell',
        args: [
            `--window-size=${WIDTH},${HEIGHT}`,
            '--no-sandbox',
            '--disable-gpu',
            '--hide-scrollbars'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT });

    // Load renderer HTML
    if (!fs.existsSync(RENDERER_HTML)) {
        throw new Error(`Renderer HTML not found: ${RENDERER_HTML}`);
    }
    await page.goto(`file://${RENDERER_HTML}`);

    // Initialize rrweb replayer with events
    await page.evaluate((data) => window.initSession(data), events);

    // Render loop with progress logging
    const startTime = performance.now();
    let lastProgressLog = 0;
    let errorCount = 0;
    let lastSuccessfulFrame = null;

    for (let i = 0; i < totalFrames; i++) {
        const timeOffset = (i / FPS) * 1000;

        try {
            // Seek to timestamp
            await page.evaluate((t) => window.seekTo(t), timeOffset);
        } catch (seekError) {
            // rrweb can fail on navigation boundaries or malformed events
            // Continue with the last successful frame
            errorCount++;
            if (errorCount === 1) {
                console.log(`[Render] Warning: seek failed at ${(timeOffset/1000).toFixed(1)}s, using previous frame`);
            }
        }

        // Capture frame (will capture current state even if seek failed)
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 80 });
        lastSuccessfulFrame = screenshot;

        // Pipe to FFMPEG
        if (!ffmpeg.stdin.write(screenshot)) {
            await new Promise(resolve => ffmpeg.stdin.once('drain', resolve));
        }

        // Progress logging every 10% (prevents timeout kills)
        const progress = Math.floor((i / totalFrames) * 100);
        if (progress >= lastProgressLog + 10) {
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
            console.log(`[Render] Progress: ${progress}% (${i}/${totalFrames} frames, ${elapsed}s elapsed)`);
            lastProgressLog = progress;
        }
    }

    if (errorCount > 0) {
        console.log(`[Render] Completed with ${errorCount} seek error(s) (frames recovered from previous state)`);
    }

    // Finalize
    ffmpeg.stdin.end();
    await new Promise((resolve, reject) => {
        ffmpeg.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`FFMPEG exited with code ${code}`));
        });
    });

    await browser.close();

    const totalTime = ((performance.now() - startTime) / 1000).toFixed(1);
    console.log(`[Render] Complete: ${outputPath} (${totalTime}s)`);

    return outputPath;
}

// Export for Worker usage
module.exports = { renderVideo };

// CLI Support: node render-worker.js <input.json> [output_dir]
if (require.main === module) {
    const inputFile = process.argv[2] || 'recording.json';
    const outputDir = process.argv[3] || __dirname;

    if (!fs.existsSync(inputFile)) {
        console.error(`Usage: node render-worker.js <events.json> [output_dir]`);
        console.error(`File not found: ${inputFile}`);
        process.exit(1);
    }

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    renderVideo(inputFile, outputDir)
        .then((outputPath) => {
            console.log(`Success: ${outputPath}`);
            process.exit(0);
        })
        .catch((err) => {
            console.error('Render failed:', err.message);
            process.exit(1);
        });
}
