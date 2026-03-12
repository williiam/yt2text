const urlInput = document.getElementById("url-input");
const fetchBtn = document.getElementById("fetch-btn");
const errorEl = document.getElementById("error");
const loadingEl = document.getElementById("loading");
const resultEl = document.getElementById("result");
const transcriptText = document.getElementById("transcript-text");
const copyBtn = document.getElementById("copy-btn");
const historyEl = document.getElementById("history");
const historyList = document.getElementById("history-list");
const clearHistoryBtn = document.getElementById("clear-history-btn");
const langSelect = document.getElementById("lang-select");
const playerWrap = document.getElementById("player-wrap");
const aiBar = document.getElementById("ai-bar");
const toggleViewBtn = document.getElementById("toggle-view-btn");

const HISTORY_KEY = "yt-transcriber-history";
let viewMode = "segments"; // "segments" or "fulltext"

const AI_URLS = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
  claude: "https://claude.ai/new",
  grok: "https://grok.com/",
};

let ytPlayer = null;
let ytPlayerReady = false;
let currentVideoId = null;
let currentSegments = [];

// YouTube IFrame API callback
window.onYouTubeIframeAPIReady = () => {
  ytPlayerReady = true;
};

function initPlayer(videoId) {
  currentVideoId = videoId;
  playerWrap.classList.remove("hidden");

  if (ytPlayer) {
    ytPlayer.loadVideoById(videoId);
    return;
  }

  function create() {
    ytPlayer = new YT.Player("yt-player", {
      videoId,
      playerVars: { autoplay: 0, rel: 0 },
    });
  }

  if (ytPlayerReady) {
    create();
  } else {
    // Wait for API to be ready
    const interval = setInterval(() => {
      if (typeof YT !== "undefined" && YT.Player) {
        ytPlayerReady = true;
        clearInterval(interval);
        create();
      }
    }, 200);
  }
}

function seekTo(seconds) {
  if (ytPlayer && ytPlayer.seekTo) {
    ytPlayer.seekTo(seconds, true);
    ytPlayer.playVideo();
  }
}

function parseTimestamp(ts) {
  // Handle "HH:MM:SS.mmm" or numeric seconds
  if (typeof ts === "number") return ts;
  const parts = String(ts).split(":");
  if (parts.length === 3) {
    return (
      parseFloat(parts[0]) * 3600 +
      parseFloat(parts[1]) * 60 +
      parseFloat(parts[2])
    );
  }
  return parseFloat(ts) || 0;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function renderSegments(segments) {
  currentSegments = segments;
  transcriptText.innerHTML = "";

  for (const seg of segments) {
    const div = document.createElement("div");
    div.className = "segment";

    const seconds = parseTimestamp(seg.start);

    const timeSpan = document.createElement("span");
    timeSpan.className = "segment-time";
    timeSpan.textContent = formatTime(seconds);

    const textSpan = document.createElement("span");
    textSpan.className = "segment-text";
    textSpan.textContent = seg.text;

    div.appendChild(timeSpan);
    div.appendChild(textSpan);

    div.addEventListener("click", () => {
      document.querySelectorAll(".segment.active").forEach((el) =>
        el.classList.remove("active")
      );
      div.classList.add("active");
      seekTo(seconds);
    });

    transcriptText.appendChild(div);
  }
}

function getFullText(segments) {
  return segments.map((s) => s.text).join(" ");
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

fetchBtn.addEventListener("click", fetchTranscript);
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") fetchTranscript();
});

async function fetchTranscript() {
  const url = urlInput.value.trim();
  const lang = langSelect.value;
  if (!url) return;

  errorEl.classList.add("hidden");
  resultEl.classList.add("hidden");
  loadingEl.classList.remove("hidden");
  loadingEl.textContent = "Fetching transcript...";
  fetchBtn.disabled = true;

  try {
    const res = await fetch("/api/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, lang }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to fetch transcript");
    }

    const videoId = extractVideoId(url) || data.videoId;
    if (videoId) {
      initPlayer(videoId);
    }

    renderSegments(data.segments);
    aiBar.classList.remove("hidden");
    resultEl.classList.remove("hidden");

    const langName =
      langSelect.options[langSelect.selectedIndex]?.textContent || lang;
    saveToHistory(url, data.videoId, data.segments, data.fullText, lang, langName);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    loadingEl.classList.add("hidden");
    fetchBtn.disabled = false;
  }
}

copyBtn.addEventListener("click", () => {
  const text = getFullText(currentSegments);
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.textContent = "Copy to Clipboard";
    }, 2000);
  });
});

toggleViewBtn.addEventListener("click", () => {
  if (viewMode === "segments") {
    viewMode = "fulltext";
    toggleViewBtn.textContent = "Timestamps";
    transcriptText.innerHTML = "";
    transcriptText.classList.add("fulltext-mode");
    transcriptText.textContent = getFullText(currentSegments);
  } else {
    viewMode = "segments";
    toggleViewBtn.textContent = "Full Text";
    transcriptText.classList.remove("fulltext-mode");
    renderSegments(currentSegments);
  }
});

// --- History ---

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveToHistory(url, videoId, segments, fullText, lang, langName) {
  const history = getHistory();
  const key = `${videoId}_${lang}`;
  const filtered = history.filter(
    (h) => `${h.videoId}_${h.lang}` !== key
  );
  filtered.unshift({
    url,
    videoId,
    segments,
    fullText,
    lang,
    langName,
    date: new Date().toISOString(),
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, 20)));
  renderHistory();
}

function renderHistory() {
  const history = getHistory();
  if (history.length === 0) {
    historyEl.classList.add("hidden");
    return;
  }

  historyEl.classList.remove("hidden");
  historyList.innerHTML = "";

  for (const item of history) {
    const li = document.createElement("li");
    li.className = "history-item";

    const title = document.createElement("span");
    title.className = "history-item-title";
    title.textContent = item.url;

    const meta = document.createElement("span");
    meta.className = "history-item-date";
    const langLabel = item.langName || item.lang || "";
    meta.textContent = `${langLabel}  ${new Date(item.date).toLocaleDateString()}`;

    li.appendChild(title);
    li.appendChild(meta);

    li.addEventListener("click", () => {
      urlInput.value = item.url;
      errorEl.classList.add("hidden");


      const videoId = extractVideoId(item.url) || item.videoId;
      if (videoId) {
        initPlayer(videoId);
      }

      if (item.segments) {
        renderSegments(item.segments);
      } else {
        // Legacy history without segments
        transcriptText.innerHTML = "";
        transcriptText.textContent = item.fullText;
      }
      aiBar.classList.remove("hidden");
      resultEl.classList.remove("hidden");
    });

    historyList.appendChild(li);
  }
}

clearHistoryBtn.addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

// --- AI Summary Buttons ---

document.querySelectorAll(".ai-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const ai = btn.dataset.ai;
    const url = AI_URLS[ai];
    if (!url) return;

    const text = getFullText(currentSegments);
    const prompt = `Please summarize the following YouTube video transcript into key points:\n\n${text}`;

    navigator.clipboard.writeText(prompt).then(() => {
      btn.classList.add("copied");
      const originalText = btn.textContent;
      btn.textContent = originalText + " (copied!)";
      setTimeout(() => {
        btn.classList.remove("copied");
        btn.textContent = originalText;
      }, 3000);
      window.open(url, "_blank");
    });
  });
});

renderHistory();

// --- Auto-fill from URL param (from Explorer) ---
const params = new URLSearchParams(window.location.search);
const prefillUrl = params.get("url");
if (prefillUrl) {
  urlInput.value = prefillUrl;
  fetchTranscript();
}
