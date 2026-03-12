const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const trail = document.getElementById("trail");
const discoverBar = document.getElementById("discover-bar");
const discoverKeywords = document.getElementById("discover-keywords");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const grid = document.getElementById("grid");
const activeTopicsEl = document.getElementById("active-topics");
const clearTopicsBtn = document.getElementById("clear-topics");

// State
let activeTopics = []; // current active topic strings
let history = []; // { query, videos } for backtracking

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "this", "that", "are", "was",
  "be", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "can", "not", "no", "so", "if",
  "how", "what", "when", "where", "who", "which", "why", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "than",
  "too", "very", "just", "about", "above", "after", "again", "also",
  "any", "because", "been", "before", "being", "between", "during",
  "here", "into", "its", "my", "our", "out", "over", "own", "same",
  "their", "them", "then", "there", "these", "they", "those", "through",
  "under", "up", "we", "you", "your", "i", "me", "he", "she", "his",
  "her", "him", "us", "amp", "quot", "gt", "lt", "new", "get", "one",
  "two", "like", "make", "know", "see", "way", "go", "going", "got",
  "much", "many", "well", "even", "back", "still", "let", "say",
  "don", "didn", "doesn", "won", "isn", "aren", "wasn", "weren",
  "video", "videos", "watch", "channel", "subscribe", "official",
  "best", "top", "first", "last", "time", "thing", "things", "really",
  "right", "look", "take", "come", "made", "people", "need", "want",
]);

// === Topic Management ===

function addTopic(topic) {
  const t = topic.toLowerCase().trim();
  if (!t || activeTopics.includes(t)) return;
  activeTopics.push(t);
  renderTopics();
  searchByTopics();
}

function removeTopic(topic) {
  activeTopics = activeTopics.filter((t) => t !== topic);
  renderTopics();
  if (activeTopics.length > 0) {
    searchByTopics();
  } else {
    grid.innerHTML = "";
    discoverBar.classList.add("hidden");
    trail.classList.add("hidden");
  }
}

function renderTopics() {
  activeTopicsEl.innerHTML = "";
  for (const t of activeTopics) {
    const pill = document.createElement("div");
    pill.className = "topic-pill";

    const span = document.createElement("span");
    span.textContent = t;

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-topic";
    removeBtn.textContent = "\u00d7";
    removeBtn.addEventListener("click", () => removeTopic(t));

    pill.appendChild(span);
    pill.appendChild(removeBtn);
    activeTopicsEl.appendChild(pill);
  }
}

clearTopicsBtn.addEventListener("click", () => {
  activeTopics = [];
  history = [];
  renderTopics();
  grid.innerHTML = "";
  discoverBar.classList.add("hidden");
  trail.classList.add("hidden");
});

// === Search ===

async function searchByTopics() {
  const query = activeTopics.join(" ");
  if (!query) return;

  searchInput.value = query;
  errorEl.classList.add("hidden");
  loadingEl.classList.remove("hidden");
  grid.innerHTML = "";
  discoverBar.classList.add("hidden");

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&maxResults=15`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    history.push({ query, videos: data.videos, topics: [...activeTopics] });
    renderTrail();
    renderResults(data.videos);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    loadingEl.classList.add("hidden");
  }
}

async function exploreVideo(videoId) {
  errorEl.classList.add("hidden");
  loadingEl.classList.remove("hidden");
  grid.innerHTML = "";
  discoverBar.classList.add("hidden");

  try {
    const res = await fetch(`/api/related/${videoId}?maxResults=15`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const query = activeTopics.join(" ") + " (related)";
    history.push({ query, videos: data.videos, topics: [...activeTopics] });
    renderTrail();
    renderResults(data.videos);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    loadingEl.classList.add("hidden");
  }
}

// === Keyword Extraction ===

function extractGlobalKeywords(videos) {
  const freq = {};
  for (const v of videos) {
    const text = (v.title + " " + v.description).toLowerCase();
    const clean = text
      .replace(/&[^;]+;/g, " ")
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf\s]/g, " ");
    const words = clean.split(/\s+/).filter((w) => w.length > 2);
    const seen = new Set();
    for (const w of words) {
      if (STOP_WORDS.has(w) || seen.has(w) || activeTopics.includes(w)) continue;
      seen.add(w);
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);
}

function getVideoTags(video) {
  const result = [];

  // Category (most accurate)
  if (video.category) {
    result.push({ text: video.category, type: "category" });
  }

  // Topics from YouTube (Wikipedia-based)
  if (video.topics) {
    for (const t of video.topics.slice(0, 3)) {
      result.push({ text: t, type: "topic" });
    }
  }

  // Uploader tags
  if (video.tags) {
    for (const t of video.tags.slice(0, 3)) {
      result.push({ text: t, type: "tag" });
    }
  }

  // Fallback: extract from title if nothing else
  if (result.length <= 1) {
    const text = video.title.toLowerCase()
      .replace(/&[^;]+;/g, " ")
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf\s]/g, " ");
    const words = text.split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
      .slice(0, 3);
    for (const w of words) {
      result.push({ text: w, type: "title" });
    }
  }

  return result;
}

// === Trail (Breadcrumb) ===

function renderTrail() {
  if (history.length <= 1) {
    trail.classList.add("hidden");
    return;
  }
  trail.classList.remove("hidden");
  trail.innerHTML = "";

  history.forEach((entry, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "trail-sep";
      sep.textContent = "\u203a";
      trail.appendChild(sep);
    }
    const node = document.createElement("span");
    node.className = "trail-node";
    const label = entry.topics.join("+");
    node.textContent = label.length > 25 ? label.slice(0, 25) + "..." : label;

    if (i === history.length - 1) {
      node.classList.add("current");
    } else {
      node.addEventListener("click", () => {
        // Backtrack
        history.length = i + 1;
        activeTopics = [...entry.topics];
        renderTopics();
        renderTrail();
        renderResults(entry.videos);
      });
    }
    trail.appendChild(node);
  });
}

// === Render ===

function renderResults(videos) {
  grid.innerHTML = "";

  if (videos.length === 0) {
    grid.innerHTML = '<p style="color:#555;text-align:center;padding:60px;">No videos found. Try different topics.</p>';
    return;
  }

  // Discover keywords
  const keywords = extractGlobalKeywords(videos);
  if (keywords.length > 0) {
    discoverBar.classList.remove("hidden");
    discoverKeywords.innerHTML = "";
    for (const kw of keywords) {
      const span = document.createElement("span");
      span.className = "disc-kw";
      span.textContent = kw;
      span.addEventListener("click", () => addTopic(kw));
      discoverKeywords.appendChild(span);
    }
  }

  for (const video of videos) {
    const card = document.createElement("div");
    card.className = "video-card";
    const tags = getVideoTags(video);

    card.innerHTML = `
      <div class="thumb-wrap">
        <img src="${video.thumbnail}" alt="" loading="lazy" />
        <div class="thumb-overlay"><span>Explore Related</span></div>
      </div>
      <div class="video-info">
        <div class="video-title">${video.title}</div>
        <div class="video-channel">${video.channel}</div>
        <div class="video-tags">
          ${tags.map((t) => `<span class="vtag vtag-${t.type}" data-tag="${t.text}">${t.text}</span>`).join("")}
        </div>
      </div>
      <div class="card-actions">
        <button class="card-btn watch-btn">Watch</button>
        <button class="card-btn transcript-btn">Transcript</button>
      </div>
    `;

    // Click thumbnail -> explore related
    card.querySelector(".thumb-wrap").addEventListener("click", () => {
      exploreVideo(video.videoId);
    });

    // Click tags -> add to topics
    card.querySelectorAll(".vtag").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        addTopic(el.dataset.tag);
      });
    });

    // Watch button -> open YouTube
    card.querySelector(".watch-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(`https://www.youtube.com/watch?v=${video.videoId}`, "_blank");
    });

    // Transcript button -> open transcriber with URL
    card.querySelector(".transcript-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const url = encodeURIComponent(`https://www.youtube.com/watch?v=${video.videoId}`);
      window.open(`/?url=${url}`, "_blank");
    });

    grid.appendChild(card);
  }
}

// === Init ===

searchBtn.addEventListener("click", () => {
  const q = searchInput.value.trim();
  if (!q) return;
  // Parse input as topics
  const newTopics = q.split(/[,\s]+/).filter((t) => t.length > 1);
  for (const t of newTopics) {
    if (!activeTopics.includes(t.toLowerCase())) {
      activeTopics.push(t.toLowerCase());
    }
  }
  renderTopics();
  searchByTopics();
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchBtn.click();
});
