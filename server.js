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

function listSubtitles() {
  return [
    { code: "en", name: "English" },
    { code: "zh-Hant", name: "Chinese (Traditional)" },
  ];
}

function fetchTranscript(videoId, lang = "en") {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-transcript-"));
    const outputTemplate = path.join(tmpDir, "sub");

    const args = [
      "-m",
      "yt_dlp",
      "--write-auto-sub",
      "--write-sub",
      "--sub-lang",
      lang,
      "--skip-download",
      "--sub-format",
      "vtt",
      "-o",
      outputTemplate,
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    execFile("python", args, { timeout: 30000 }, (err, stdout, stderr) => {
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

app.post("/api/languages", (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: "Invalid YouTube URL" });
  }

  try {
    const languages = listSubtitles();
    res.json({ videoId, languages });
  } catch (err) {
    console.error("Languages error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/transcript", async (req, res) => {
  const { url, lang } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: "Invalid YouTube URL" });
  }

  try {
    const segments = await fetchTranscript(videoId, lang || "en");
    const fullText = segments.map((s) => s.text).join(" ");
    res.json({ videoId, segments, fullText });
  } catch (err) {
    console.error("Transcript error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- YouTube Explore API ---

const YT_API_KEY = process.env.YT_API_KEY || "AIzaSyBuYl1ObeGzqO5vltYdb6iWIdPZZkgis8I";
const YT_API = "https://www.googleapis.com/youtube/v3";

const YT_CATEGORIES = {
  "1": "Film", "2": "Cars", "10": "Music", "15": "Pets",
  "17": "Sports", "18": "Short Movies", "19": "Travel",
  "20": "Gaming", "21": "Vlog", "22": "People & Blogs",
  "23": "Comedy", "24": "Entertainment", "25": "News",
  "26": "How-to", "27": "Education", "28": "Science & Tech",
  "29": "Nonprofits", "30": "Movies", "43": "Shows", "44": "Trailers",
};

async function enrichVideos(videos) {
  if (videos.length === 0) return videos;
  const ids = videos.map((v) => v.videoId).join(",");
  const url = `${YT_API}/videos?part=snippet,topicDetails&id=${ids}&key=${YT_API_KEY}`;
  const r = await fetch(url);
  const data = await r.json();
  if (data.error || !data.items) return videos;

  const details = {};
  for (const item of data.items) {
    const category = YT_CATEGORIES[item.snippet.categoryId] || null;
    const tags = (item.snippet.tags || []).slice(0, 5);
    const topics = (item.topicDetails?.topicCategories || [])
      .map((url) => {
        const parts = url.split("/");
        return parts[parts.length - 1].replace(/_/g, " ");
      });
    details[item.id] = { category, tags, topics };
  }

  return videos.map((v) => ({
    ...v,
    category: details[v.videoId]?.category || null,
    tags: details[v.videoId]?.tags || [],
    topics: details[v.videoId]?.topics || [],
  }));
}

app.get("/api/search", async (req, res) => {
  const { q, maxResults = 12 } = req.query;
  if (!q) return res.status(400).json({ error: "Query is required" });

  try {
    const url = `${YT_API}/search?part=snippet&type=video&maxResults=${maxResults}&q=${encodeURIComponent(q)}&key=${YT_API_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);

    let videos = (data.items || []).map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      description: item.snippet.description,
    }));

    videos = await enrichVideos(videos);
    res.json({ query: q, videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/related/:videoId", async (req, res) => {
  const { videoId } = req.params;
  const maxResults = req.query.maxResults || 12;

  try {
    const infoUrl = `${YT_API}/videos?part=snippet&id=${videoId}&key=${YT_API_KEY}`;
    const infoRes = await fetch(infoUrl);
    const infoData = await infoRes.json();
    if (!infoData.items || infoData.items.length === 0) {
      throw new Error("Video not found");
    }

    const title = infoData.items[0].snippet.title;
    const searchUrl = `${YT_API}/search?part=snippet&type=video&maxResults=${maxResults}&q=${encodeURIComponent(title)}&key=${YT_API_KEY}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    if (searchData.error) throw new Error(searchData.error.message);

    let videos = (searchData.items || [])
      .filter((item) => item.id.videoId !== videoId)
      .map((item) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        channel: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
        description: item.snippet.description,
      }));

    videos = await enrichVideos(videos);
    res.json({ sourceVideoId: videoId, videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
