const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
const LATEST_FILE = path.join(DATA_DIR, "latest.json");
const LIVE_FILE = path.join(DATA_DIR, "live.json");
const VIDEO_FILE = path.join(DATA_DIR, "current_video.mp4");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

app.use(cors());

// Raw body parser for video upload
app.use("/upload/video", express.raw({ type: "video/mp4", limit: "200mb" }));
app.use(express.json({ limit: "10mb" }));

// ── HEALTH ────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ── UPLOAD VIDEO FILE ─────────────────────────────────────────────
app.post("/upload/video", (req, res) => {
  try {
    fs.writeFileSync(VIDEO_FILE, req.body);
    const size = (req.body.length / 1024 / 1024).toFixed(2);
    console.log(`[✓] Video uploaded: ${size}MB`);
    res.json({ success: true, message: `Video uploaded (${size}MB)` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── STREAM VIDEO ──────────────────────────────────────────────────
app.get("/video/stream", (req, res) => {
  if (!fs.existsSync(VIDEO_FILE))
    return res.status(404).json({ error: "No video available" });

  const stat = fs.statSync(VIDEO_FILE);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const file = fs.createReadStream(VIDEO_FILE, { start, end });
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": "video/mp4",
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
    });
    fs.createReadStream(VIDEO_FILE).pipe(res);
  }
});

// ── VIDEO STATUS ──────────────────────────────────────────────────
app.get("/video/status", (req, res) => {
  res.json({ available: fs.existsSync(VIDEO_FILE) });
});

// ── DELETE VIDEO ──────────────────────────────────────────────────
app.delete("/video", (req, res) => {
  if (fs.existsSync(VIDEO_FILE)) {
    fs.unlinkSync(VIDEO_FILE);
    console.log("[✓] Video deleted");
  }
  res.json({ success: true });
});

// ── LIVE: START SESSION ───────────────────────────────────────────
app.post("/live/start", (req, res) => {
  const { video_file, fps, resolution, total_frames, model } = req.body;
  const session = {
    status: "processing",
    started_at: new Date().toISOString(),
    video_file: video_file || "unknown",
    fps: fps || 0,
    resolution: resolution || "",
    total_frames: total_frames || 0,
    current_frame: 0,
    progress_pct: 0,
    model: model || "yolov8m",
    active_persons: [],
    confirmed_cards: [],
    frame_boxes: [],
    total_tracked: 0,
    faces_detected: 0,
  };
  fs.writeFileSync(LIVE_FILE, JSON.stringify(session, null, 2));
  console.log(`[LIVE] Started: ${video_file}`);
  res.json({ success: true });
});

// ── LIVE: PUSH FRAME BOXES ────────────────────────────────────────
// Send bounding boxes per frame (no image — browser plays actual video)
app.post("/live/frame", (req, res) => {
  try {
    if (!fs.existsSync(LIVE_FILE))
      return res.status(400).json({ error: "No live session" });

    const { current_frame, total_frames, active_persons, total_tracked, timestamp_ms } = req.body;
    const session = JSON.parse(fs.readFileSync(LIVE_FILE, "utf-8"));

    session.current_frame = current_frame || 0;
    session.total_frames = total_frames || session.total_frames;
    session.progress_pct = total_frames ? Math.round((current_frame / total_frames) * 100) : 0;
    session.active_persons = active_persons || [];
    session.total_tracked = total_tracked || 0;
    session.timestamp_ms = timestamp_ms || 0;

    fs.writeFileSync(LIVE_FILE, JSON.stringify(session, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LIVE: ADD CONFIRMED CARD ──────────────────────────────────────
app.post("/live/card", (req, res) => {
  try {
    if (!fs.existsSync(LIVE_FILE))
      return res.status(400).json({ error: "No live session" });

    const card = req.body;
    const session = JSON.parse(fs.readFileSync(LIVE_FILE, "utf-8"));
    const idx = session.confirmed_cards.findIndex(c => c.person_id === card.person_id);
    if (idx === -1) {
      session.confirmed_cards.push(card);
      if (card.face_detected) session.faces_detected += 1;
      console.log(`[LIVE] Card: SBJ_${String(card.person_id).padStart(3,"0")} | ${card.duration_seconds}s`);
    } else {
      session.confirmed_cards[idx] = card;
    }
    fs.writeFileSync(LIVE_FILE, JSON.stringify(session, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LIVE: END SESSION ─────────────────────────────────────────────
app.post("/live/end", (req, res) => {
  try {
    if (!fs.existsSync(LIVE_FILE))
      return res.status(400).json({ error: "No live session" });

    const session = JSON.parse(fs.readFileSync(LIVE_FILE, "utf-8"));
    session.status = "complete";
    session.completed_at = new Date().toISOString();
    session.progress_pct = 100;
    session.active_persons = [];
    fs.writeFileSync(LIVE_FILE, JSON.stringify(session, null, 2));

    // Auto delete video after processing
    setTimeout(() => {
      if (fs.existsSync(VIDEO_FILE)) {
        fs.unlinkSync(VIDEO_FILE);
        console.log("[✓] Video auto-deleted after processing");
      }
    }, 5000); // 5 second delay so browser can finish playing

    console.log(`[LIVE] Complete: ${session.confirmed_cards.length} cards`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LIVE: STATUS ──────────────────────────────────────────────────
app.get("/live/status", (req, res) => {
  if (!fs.existsSync(LIVE_FILE)) return res.json(null);
  try {
    res.json(JSON.parse(fs.readFileSync(LIVE_FILE, "utf-8")));
  } catch { res.json(null); }
});

// ── FULL UPLOAD ───────────────────────────────────────────────────
app.post("/upload", (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.metadata || !data.person_cards)
      return res.status(400).json({ error: "Invalid data" });

    fs.writeFileSync(LATEST_FILE, JSON.stringify(data, null, 2));
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const videoName = (data.metadata.video_file || "video")
      .replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    const archiveFile = path.join(DATA_DIR, `${videoName}_${timestamp}.json`);
    fs.writeFileSync(archiveFile, JSON.stringify(data, null, 2));
    console.log(`[✓] Uploaded: ${data.metadata.cards_generated} cards`);
    res.json({ success: true, message: "Data saved", archive: path.basename(archiveFile) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET LATEST ────────────────────────────────────────────────────
app.get("/latest", (req, res) => {
  if (!fs.existsSync(LATEST_FILE)) return res.json(null);
  res.json(JSON.parse(fs.readFileSync(LATEST_FILE, "utf-8")));
});

// ── HISTORY ───────────────────────────────────────────────────────
app.get("/history", (req, res) => {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f !== "latest.json" && f !== "live.json" && f.endsWith(".json"))
    .sort().reverse();
  res.json(files);
});

app.get("/history/:filename", (req, res) => {
  const file = path.join(DATA_DIR, req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Not found" });
  res.json(JSON.parse(fs.readFileSync(file, "utf-8")));
});

app.delete("/history/:filename", (req, res) => {
  const file = path.join(DATA_DIR, req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Not found" });
  fs.unlinkSync(file);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`[✓] CCTV Backend on port ${PORT}`));
