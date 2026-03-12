const express = require("express");
const path = require("path");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function parseVTT(vttContent) {
  const lines = vttContent.split("\n");
  const rawSegments = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const timeMatch = line.match(
      /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/
    );
    if (!timeMatch) continue;

    let text = "";
    for (let j = i + 1; j < lines.length && lines[j].trim() !== ""; j++) {
      text += lines[j] + " ";
    }

    text = text
      .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
      .replace(/<\/?c>/g, "")
      .replace(/<[^>]+>/g, "")
      .trim();

    if (text) {
      rawSegments.push({ start: timeMatch[1], end: timeMatch[2], text });
    }
  }

  // YouTube auto-subs repeat lines in rolling fashion.
  // Keep only segments whose text isn't a substring of the next segment.
  const segments = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const curr = rawSegments[i].text;
    const next = i + 1 < rawSegments.length ? rawSegments[i + 1].text : "";
    if (!next.includes(curr)) {
      segments.push(rawSegments[i]);
    }
  }

  return segments;
}

function fetchTranscript(videoId) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-transcript-"));
    const outputTemplate = path.join(tmpDir, "sub");

    const args = [
      "--write-auto-sub",
      "--write-sub",
      "--sub-lang",
      "en",
      "--skip-download",
      "--sub-format",
      "vtt",
      "-o",
      outputTemplate,
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    // Use local ./yt-dlp binary if available, otherwise fall back to python module
    const localBin = path.join(__dirname, "yt-dlp");
    const useLocal = fs.existsSync(localBin);
    const cmd = useLocal ? localBin : "python";
    const cmdArgs = useLocal ? args : ["-m", "yt_dlp", ...args];

    execFile(cmd, cmdArgs, { timeout: 30000 }, (err, stdout, stderr) => {
      // Find the VTT file
      try {
        const files = fs.readdirSync(tmpDir);
        const vttFile = files.find((f) => f.endsWith(".vtt"));

        if (!vttFile) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          return reject(
            new Error("No subtitles available for this video")
          );
        }

        const vttContent = fs.readFileSync(
          path.join(tmpDir, vttFile),
          "utf-8"
        );
        fs.rmSync(tmpDir, { recursive: true, force: true });

        const segments = parseVTT(vttContent);
        if (segments.length === 0) {
          return reject(new Error("Transcript is empty"));
        }

        resolve(segments);
      } catch (parseErr) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        reject(new Error("Failed to process subtitles"));
      }
    });
  });
}

app.post("/api/transcript", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: "Invalid YouTube URL" });
  }

  try {
    const segments = await fetchTranscript(videoId);
    const fullText = segments.map((s) => s.text).join(" ");
    res.json({ videoId, segments, fullText });
  } catch (err) {
    console.error("Transcript error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
