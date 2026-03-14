const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
const LATEST_FILE = path.join(DATA_DIR, "latest.json");

// Make sure data folder exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ── POST /upload ─────────────────────────────────────────────────
// Python script calls this after processing a video
app.post("/upload", (req, res) => {
  try {
    const data = req.body;

    if (!data || !data.metadata || !data.person_cards) {
      return res.status(400).json({ error: "Invalid data format" });
    }

    // Save as latest.json (website always reads this)
    fs.writeFileSync(LATEST_FILE, JSON.stringify(data, null, 2));

    // Also save a timestamped archive (never deleted)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const videoName = (data.metadata.video_file || "video")
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    const archiveFile = path.join(DATA_DIR, `${videoName}_${timestamp}.json`);
    fs.writeFileSync(archiveFile, JSON.stringify(data, null, 2));

    console.log(`[✓] Received data for: ${data.metadata.video_file}`);
    console.log(`[✓] Cards: ${data.metadata.cards_generated}`);
    console.log(`[✓] Archived to: ${path.basename(archiveFile)}`);

    res.json({
      success: true,
      message: "Data saved",
      archive: path.basename(archiveFile),
    });
  } catch (err) {
    console.error("[ERROR]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /latest ──────────────────────────────────────────────────
// Website fetches this to get latest processed video data
app.get("/latest", (req, res) => {
  if (!fs.existsSync(LATEST_FILE)) {
    return res.json(null);
  }
  const data = JSON.parse(fs.readFileSync(LATEST_FILE, "utf-8"));
  res.json(data);
});

// ── GET /history ─────────────────────────────────────────────────
// Returns list of all archived JSON files
app.get("/history", (req, res) => {
  const files = fs.readdirSync(DATA_DIR)
    .filter((f) => f !== "latest.json" && f.endsWith(".json"))
    .sort()
    .reverse();
  res.json(files);
});

// ── GET /history/:filename ────────────────────────────────────────
// Returns a specific archived file
app.get("/history/:filename", (req, res) => {
  const file = path.join(DATA_DIR, req.params.filename);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "File not found" });
  }
  const data = JSON.parse(fs.readFileSync(file, "utf-8"));
  res.json(data);
});

// ── GET /health ───────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`[✓] CCTV Backend running on port ${PORT}`);
});
