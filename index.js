import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup file upload with streaming
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = "uploads/";
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      // Generate unique filename
      const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}-${file.originalname}`;
      cb(null, uniqueName);
    }
  })
});

// Ensure uploads directory exists
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads", { recursive: true });
}

// Health check
app.get("/healthz", (req, res) => {
  res.send("OK");
});

// Root endpoint
app.get("/", (req, res) => {
  res.send("FrameBoost backend running");
});

// Check if FFmpeg is available
function checkFFmpegAvailable() {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], (error) => {
      resolve(!error);
    });
  });
}

// Get video info endpoint (returns FPS, duration, resolution)
app.post("/video-info", upload.single("video"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const inputFile = req.file.path;

    console.log(`[FFprobe] Analyzing: ${inputFile}`);

    // Use ffprobe to get video information
    execFile('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=r_frame_rate,width,height,duration',
      '-of', 'json',
      inputFile
    ], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Clean up input file
      fs.unlink(inputFile, (err) => {
        if (err) console.error("[Cleanup Error]", err);
      });

      if (error) {
        console.error("[FFprobe Error]", error.message);
        return res.status(500).json({ 
          error: "Failed to analyze video",
          details: error.message 
        });
      }

      try {
        const data = JSON.parse(stdout);
        const stream = data.streams?.[0];

        if (!stream) {
          return res.status(400).json({ error: "No video stream found" });
        }

        // Parse frame rate (e.g., "30/1" or "24000/1001")
        let fps = 30;
        if (stream.r_frame_rate) {
          const [num, den] = stream.r_frame_rate.split('/').map(Number);
          fps = Math.round(num / den);
        }

        const videoInfo = {
          fps: fps,
          width: stream.width || 0,
          height: stream.height || 0,
          duration: stream.duration ? parseFloat(stream.duration) : 0,
        };

        console.log(`[FFprobe] Video info:`, videoInfo);
        res.json(videoInfo);
      } catch (parseError) {
        console.error("[Parse Error]", parseError);
        res.status(500).json({ error: "Failed to parse video info" });
      }
    });

  } catch (err) {
    console.error("[Server Error]", err);
    res.status(500).json({ error: "Processing error", details: err.message });
  }
});

// Video processing endpoint (optimized for streaming)
app.post("/process-video", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Get target FPS from request body
    const targetFps = parseInt(req.body.targetFps) || 60;
    
    console.log(`[Backend] Received: video=${req.file.originalname}, targetFps=${targetFps}`);

    // Validate FPS range
    if (targetFps < 1 || targetFps > 240) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: "FPS must be between 1 and 240" });
    }

    // Check if FFmpeg is available
    const ffmpegAvailable = await checkFFmpegAvailable();
    if (!ffmpegAvailable) {
      console.error("[Error] FFmpeg is not installed on this system");
      fs.unlink(req.file.path, () => {});
      return res.status(500).json({ 
        error: "FFmpeg not available",
        details: "Video processing service is not properly configured"
      });
    }

    // Paths
    const inputFile = req.file.path;
    const outputFile = path.join("uploads", `converted_${Date.now()}_${req.file.originalname}`);

    // Set longer timeout for large videos
    req.setTimeout(10 * 60 * 1000); // 10 minutes

    console.log(`[FFmpeg] Processing: ${inputFile} → ${outputFile} at ${targetFps} FPS`);

    // Use streaming FFmpeg command to avoid memory issues
    // -c:v libx264 = H.264 codec (good compression)
    // -preset fast = faster encoding (less CPU intensive)
    // -crf 23 = quality (lower = better, 23 is default)
    // -c:a aac = audio codec
    // -movflags +faststart = optimize for streaming
    execFile('ffmpeg', [
      '-i', inputFile,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-filter:v', `fps=${targetFps}`,
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', // Overwrite output file
      outputFile
    ], { 
      maxBuffer: 10 * 1024 * 1024,
      timeout: 10 * 60 * 1000 // 10 minutes
    }, (error, stdout, stderr) => {
      if (error) {
        console.error("[FFmpeg Error]", error.message);
        console.error("[FFmpeg Stderr]", stderr);
        
        // Clean up input file
        fs.unlink(inputFile, (err) => {
          if (err) console.error("[Cleanup Error] Failed to delete input:", err);
        });
        
        return res.status(500).json({ 
          error: "Video processing failed",
          details: error.message 
        });
      }

      console.log(`[FFmpeg] Success: Processed to ${targetFps} FPS`);

      // Check if output file exists
      if (!fs.existsSync(outputFile)) {
        console.error("[Error] Output file not created");
        fs.unlink(inputFile, (err) => {
          if (err) console.error("[Cleanup Error] Failed to delete input:", err);
        });
        return res.status(500).json({ error: "Output file not created" });
      }

      // Get file size for logging
      const stats = fs.statSync(outputFile);
      console.log(`[FFmpeg] Output file size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);

      // Send the processed video with proper headers
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="processed_${targetFps}fps.mp4"`);
      res.setHeader('Content-Length', stats.size);
      
      // Use streaming to avoid loading entire file into memory
      const fileStream = fs.createReadStream(outputFile);
      
      fileStream.on('error', (err) => {
        console.error("[Stream Error]", err);
        res.status(500).json({ error: "Failed to stream video" });
      });

      fileStream.pipe(res);

      // Clean up files after streaming completes
      res.on('finish', () => {
        console.log("[Cleanup] Response finished, cleaning up files");
        setTimeout(() => {
          fs.unlink(inputFile, (err) => {
            if (err) console.error("[Cleanup Error] Failed to delete input:", err);
            else console.log("[Cleanup] Input file deleted");
          });
          fs.unlink(outputFile, (err) => {
            if (err) console.error("[Cleanup Error] Failed to delete output:", err);
            else console.log("[Cleanup] Output file deleted");
          });
        }, 1000);
      });

      res.on('error', (err) => {
        console.error("[Response Error]", err);
      });
    });

  } catch (err) {
    console.error("[Server Error]", err);
    
    // Clean up uploaded file on error
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("[Cleanup Error]", err);
      });
    }
    
    res.status(500).json({ error: "Processing error", details: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[Server] FrameBoost backend started on port ${PORT}`);
  console.log(`[Server] Listening on http://localhost:${PORT}`);
});