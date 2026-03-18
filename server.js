const express = require("express");
const path = require("path");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyCc5OFcFWvPvAxhm7i5CfdiG9HBn47BKHo";

app.use(express.json({ limit: "5mb" }));
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

// --- Whisper Fallback ---

function transcribeWithWhisper(videoId, lang = "en") {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-whisper-"));
    const audioPath = path.join(tmpDir, `${videoId}.wav`);

    // Step 1: Download audio with yt-dlp and convert to wav (best for Whisper)
    const dlArgs = [
      "-m",
      "yt_dlp",
      "-f", "bestaudio",
      "-x",
      "--audio-format", "wav",
      "-o", audioPath,
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    console.log("Whisper fallback: downloading audio...");
    execFile("python3", dlArgs, { timeout: 120000 }, (dlErr, dlStdout, dlStderr) => {
      // Check if audio file exists (try multiple extensions in case conversion didn't work)
      const files = fs.readdirSync(tmpDir);
      const audioFile = files.find((f) => f.endsWith(".wav") || f.endsWith(".mp3") || f.endsWith(".webm") || f.endsWith(".m4a") || f.endsWith(".opus"));

      if (!audioFile) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return reject(new Error("Failed to download audio for Whisper transcription"));
      }

      const actualAudioPath = path.join(tmpDir, audioFile);

      // Step 2: Run Whisper transcription
      // Map language codes for Whisper
      const whisperLang = lang === "zh-Hant" ? "zh" : lang;
      const whisperScript = path.join(__dirname, "whisper_transcribe.py");
      const whisperArgs = [whisperScript, actualAudioPath];
      if (whisperLang) whisperArgs.push(whisperLang);

      console.log("Whisper fallback: transcribing with Whisper...");
      execFile("python3", whisperArgs, { timeout: 300000 }, (wErr, wStdout, wStderr) => {
        // Clean up temp files
        fs.rmSync(tmpDir, { recursive: true, force: true });

        if (wErr) {
          return reject(new Error("Whisper transcription failed: " + (wErr.message || "timeout")));
        }

        try {
          const result = JSON.parse(wStdout);
          if (result.error) {
            return reject(new Error("Whisper error: " + result.error));
          }

          // Convert to standard segment format
          const segments = result.map((seg) => ({
            start: formatTimestamp(seg.start),
            end: formatTimestamp(seg.end),
            text: seg.text,
          }));

          if (segments.length === 0) {
            return reject(new Error("Whisper produced empty transcript"));
          }

          resolve(segments);
        } catch (parseErr) {
          reject(new Error("Failed to parse Whisper output"));
        }
      });
    });
  });
}

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${h}:${m}:${s}`;
}

function fetchSubtitles(videoId, lang = "en") {
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

    execFile("python3", args, { timeout: 30000 }, (err, stdout, stderr) => {
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

async function fetchTranscript(videoId, lang = "en") {
  try {
    const segments = await fetchSubtitles(videoId, lang);
    return { segments, source: "subtitle" };
  } catch (subtitleErr) {
    console.log(`Subtitle fetch failed: ${subtitleErr.message}. Trying Whisper fallback...`);
    try {
      const segments = await transcribeWithWhisper(videoId, lang);
      return { segments, source: "whisper" };
    } catch (whisperErr) {
      throw new Error(
        `No subtitles available and Whisper fallback failed: ${whisperErr.message}`
      );
    }
  }
}

// --- API Routes ---

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
    const { segments, source } = await fetchTranscript(videoId, lang || "en");
    const fullText = segments.map((s) => s.text).join(" ");
    res.json({ videoId, segments, fullText, source });
  } catch (err) {
    console.error("Transcript error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- AI Endpoints ---

async function callGemini(prompt, retries = 3) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 },
      }),
    });

    if (res.status === 429) {
      // Rate limited — wait and retry
      const waitMs = (attempt + 1) * 3000; // 3s, 6s, 9s
      console.log(`Gemini rate limited, retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${retries})...`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (!res.ok) {
      throw new Error(`Gemini API error: ${res.status}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty response from Gemini");
    return text;
  }

  throw new Error("Gemini API rate limited. Please wait a moment and try again.");
}

app.post("/api/ai/summarize", async (req, res) => {
  const { text, model = "gemini", videoTitle = "" } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  const truncatedText = text.slice(0, 30000);

  const prompt = `You are analyzing a YouTube video transcript.
${videoTitle ? `Video title: "${videoTitle}"` : ""}

Please analyze the following transcript and respond with ONLY a valid JSON object (no markdown, no code fences) in this exact format:
{
  "summary": "A comprehensive summary of the video content in 3-5 paragraphs",
  "topics": ["topic1", "topic2", "topic3"],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]
}

Provide 3-6 topics and 5-10 keywords. Write the summary in the same language as the transcript.

Transcript:
${truncatedText}`;

  try {
    if (model !== "gemini") {
      return res.status(400).json({ error: `Model "${model}" is not yet supported. Currently only "gemini" is available.` });
    }

    const raw = await callGemini(prompt);

    // Try to parse JSON from response
    let result;
    try {
      // Strip potential markdown code fences
      const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      result = JSON.parse(cleaned);
    } catch {
      result = { summary: raw, topics: [], keywords: [] };
    }

    res.json({
      summary: result.summary || raw,
      topics: result.topics || [],
      keywords: result.keywords || [],
    });
  } catch (err) {
    console.error("AI summarize error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/ai/ask", async (req, res) => {
  const { text, model = "gemini", question, videoTitle = "" } = req.body;

  if (!text || !question) {
    return res.status(400).json({ error: "Text and question are required" });
  }

  const truncatedText = text.slice(0, 30000);

  const prompt = `You are a helpful assistant analyzing a YouTube video transcript.
${videoTitle ? `Video title: "${videoTitle}"` : ""}

Based on the following transcript, please answer the user's question. Be specific and reference relevant parts of the transcript when possible. Answer in the same language as the question.

Transcript:
${truncatedText}

User's question: ${question}`;

  try {
    if (model !== "gemini") {
      return res.status(400).json({ error: `Model "${model}" is not yet supported. Currently only "gemini" is available.` });
    }

    const answer = await callGemini(prompt);
    res.json({ answer });
  } catch (err) {
    console.error("AI ask error:", err.message);
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
  const { q, maxResults = 12, order = "relevance", region, pageToken } = req.query;
  if (!q) return res.status(400).json({ error: "Query is required" });

  try {
    let url = `${YT_API}/search?part=snippet&type=video&maxResults=${maxResults}&q=${encodeURIComponent(q)}&order=${order}&key=${YT_API_KEY}`;
    if (region) {
      url += `&regionCode=${region}`;
    }
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }
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
    res.json({
      query: q,
      videos,
      nextPageToken: data.nextPageToken || null,
    });
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
