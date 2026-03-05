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

// Setup file upload
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 200 * 1024 * 1024 } // 200 MB
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

// Video processing endpoint
app.post("/process-video", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Get target FPS from request body (sent by frontend)
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

    // Run FFmpeg with proper escaping
    execFile('ffmpeg', [
      '-i', inputFile,
      '-filter:v', `minterpolate=fps=${targetFps}`,
      '-y', // Overwrite output file
      outputFile
    ], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
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
      
      res.download(outputFile, `processed_${targetFps}fps.mp4`, (err) => {
        if (err) {
          console.error("[Download Error]", err);
        }
        
        // Clean up files after download completes
        setTimeout(() => {
          fs.unlink(inputFile, (err) => {
            if (err) console.error("[Cleanup Error] Failed to delete input:", err);
          });
          fs.unlink(outputFile, (err) => {
            if (err) console.error("[Cleanup Error] Failed to delete output:", err);
          });
        }, 1000);
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