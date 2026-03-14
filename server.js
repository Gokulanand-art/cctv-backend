const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
const LATEST_FILE = path.join(DATA_DIR, "latest.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.get("/health", (req, res) => res.json({ status: "ok" }));
app.post("/upload", (req, res) => { try { const data = req.body; if (!data || !data.metadata || !data.person_cards) return res.status(400).json({ error: "Invalid data" }); fs.writeFileSync(LATEST_FILE, JSON.stringify(data, null, 2)); const timestamp = new Date().toISOString().replace(/[:.]/g, "-"); const videoName = (data.metadata.video_file || "video").replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_"); const archiveFile = path.join(DATA_DIR, `${videoName}_${timestamp}.json`); fs.writeFileSync(archiveFile, JSON.stringify(data, null, 2)); res.json({ success: true, message: "Data saved", archive: path.basename(archiveFile) }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get("/latest", (req, res) => { if (!fs.existsSync(LATEST_FILE)) return res.json(null); res.json(JSON.parse(fs.readFileSync(LATEST_FILE, "utf-8"))); });
app.get("/history", (req, res) => { const files = fs.readdirSync(DATA_DIR).filter(f => f !== "latest.json" && f.endsWith(".json")).sort().reverse(); res.json(files); });
app.get("/history/:filename", (req, res) => { const file = path.join(DATA_DIR, req.params.filename); if (!fs.existsSync(file)) return res.status(404).json({ error: "Not found" }); res.json(JSON.parse(fs.readFileSync(file, "utf-8"))); });
app.listen(PORT, () => console.log(`[✓] CCTV Backend running on port ${PORT}`));
// force Sat Mar 14 05:23:16 PM UTC 2026
