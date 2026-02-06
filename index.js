import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";

const app = express();
app.use(cors());

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 200 * 1024 * 1024 }
});

app.get("/healthz", (req, res) => {
  res.send("OK");
});

app.get("/", (req, res) => {
  res.send("FrameBoost backend running");
});

app.post("/process-video", upload.single("video"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    const path = req.file.path;
    const name = req.file.originalname;

    res.download(path, name, () => {
      fs.unlink(path, () => {});
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Processing error");
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("FrameBoost backend started on port", PORT);
});
