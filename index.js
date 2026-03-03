// index.js
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

// Video processing endpoint
app.post("/process-video", upload.single("video"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Get target FPS from request body (sent by frontend)
    const targetFps = parseInt(req.body.fps) || 60;
    
    if (targetFps < 1 || targetFps > 240) {
      return res.status(400).json({ error: "FPS must be between 1 and 240" });
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
        fs.unlink(inputFile, () => {});
        
        return res.status(500).json({ 
          error: "Video processing failed",
          details: error.message 
        });
      }

      console.log(`[FFmpeg] Success: Processed to ${targetFps} FPS`);

      // Check if output file exists
      if (!fs.existsSync(outputFile)) {
        console.error("[Error] Output file not created");
        fs.unlink(inputFile, () => {});
        return res.status(500).json({ error: "Output file not created" });
      }

      // Send the processed video
      res.download(outputFile, `processed_${targetFps}fps.mp4`, (err) => {
        if (err) {
          console.error("[Download Error]", err);
        }
        
        // Clean up files after download completes
        setTimeout(() => {
          fs.unlink(inputFile, (err) => {
            if (err) console.error("Failed to delete input:", err);
          });
          fs.unlink(outputFile, (err) => {
            if (err) console.error("Failed to delete output:", err);
          });
        }, 1000);
      });
    });

  } catch (err) {
    console.error("[Server Error]", err);
    res.status(500).json({ error: "Processing error", details: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[Server] FrameBoost backend started on port ${PORT}`);
});