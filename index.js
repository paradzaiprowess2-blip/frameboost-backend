import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import { execFile } from "child_process";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup file upload
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 200 * 1024 * 1024 }
});

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads", { recursive: true });
}

app.get("/healthz", (req, res) => {
  res.send("OK");
});

app.get("/", (req, res) => {
  res.send("FrameBoost backend running");
});

app.post("/process-video", upload.single("video"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // ✅ FIX: Read targetFps from form field (sent by frontend)
    const targetFps = parseInt(req.body.targetFps) || 60;
    
    console.log(`[Backend] Received: video=${req.file.originalname}, targetFps=${targetFps}`);

    if (targetFps < 1 || targetFps > 240) {
      return res.status(400).json({ error: "FPS must be between 1 and 240" });
    }

    const inputFile = req.file.path;
    const outputFile = path.join("uploads", `converted_${Date.now()}_${req.file.originalname}`);

    req.setTimeout(10 * 60 * 1000);

    console.log(`[FFmpeg] Processing: ${inputFile} → ${outputFile} at ${targetFps} FPS`);

    execFile('ffmpeg', [
      '-i', inputFile,
      '-filter:v', `minterpolate=fps=${targetFps}`,
      '-y',
      outputFile
    ], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error("[FFmpeg Error]", error.message);
        fs.unlink(inputFile, () => {});
        return res.status(500).json({ error: "Video processing failed", details: error.message });
      }

      if (!fs.existsSync(outputFile)) {
        console.error("[Error] Output file not created");
        fs.unlink(inputFile, () => {});
        return res.status(500).json({ error: "Output file not created" });
      }

      console.log(`[FFmpeg] Success: Processed to ${targetFps} FPS`);

      res.download(outputFile, `processed_${targetFps}fps.mp4`, (err) => {
        if (err) console.error("[Download Error]", err);
        
        setTimeout(() => {
          fs.unlink(inputFile, () => {});
          fs.unlink(outputFile, () => {});
        }, 1000);
      });
    });

  } catch (err) {
    console.error("[Server Error]", err);
    res.status(500).json({ error: "Processing error", details: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`[Server] FrameBoost backend started on port ${PORT}`);
});
