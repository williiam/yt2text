const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const modelSelect = document.getElementById("model-select");
const orderSelect = document.getElementById("order-select");
const regionSelect = document.getElementById("region-select");
const trail = document.getElementById("trail");
const discoverBar = document.getElementById("discover-bar");
const discoverKeywords = document.getElementById("discover-keywords");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const grid = document.getElementById("grid");
const activeTopicsEl = document.getElementById("active-topics");
const clearTopicsBtn = document.getElementById("clear-topics");
const relatedPanel = document.getElementById("related-panel");
const relatedList = document.getElementById("related-list");
const relatedSource = document.getElementById("related-source");
const closeRelatedBtn = document.getElementById("close-related");

// State
let activeTopics = []; // current active topic strings
let history = []; // { query, videos } for backtracking
let nextPageToken = null; // for infinite scroll pagination
let isLoadingMore = false; // prevent duplicate loads
let currentSearchQuery = ""; // track current search for pagination

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
  currentSearchQuery = query;
  nextPageToken = null;
  errorEl.classList.add("hidden");
  loadingEl.classList.remove("hidden");
  grid.innerHTML = "";
  discoverBar.classList.add("hidden");

  try {
    const order = orderSelect.value;
    const region = regionSelect.value;
    let searchUrl = `/api/search?q=${encodeURIComponent(query)}&maxResults=15&order=${order}`;
    if (region) searchUrl += `&region=${region}`;
    const res = await fetch(searchUrl);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    nextPageToken = data.nextPageToken || null;
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

async function loadMoreResults() {
  if (isLoadingMore || !nextPageToken || !currentSearchQuery) return;
  isLoadingMore = true;

  // Show loading indicator at bottom
  const loader = document.createElement("div");
  loader.className = "load-more-spinner";
  loader.innerHTML = '<div class="spinner"></div><span>Loading more...</span>';
  grid.parentElement.appendChild(loader);

  try {
    const order = orderSelect.value;
    const region = regionSelect.value;
    let searchUrl = `/api/search?q=${encodeURIComponent(currentSearchQuery)}&maxResults=15&order=${order}&pageToken=${nextPageToken}`;
    if (region) searchUrl += `&region=${region}`;
    const res = await fetch(searchUrl);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    nextPageToken = data.nextPageToken || null;

    // Append new results (don't clear existing)
    appendResults(data.videos);

    // Update history entry with combined videos
    if (history.length > 0) {
      history[history.length - 1].videos.push(...data.videos);
    }
  } catch (err) {
    console.error("Load more error:", err.message);
  } finally {
    loader.remove();
    isLoadingMore = false;
  }
}

async function exploreVideo(videoId, videoTitle) {
  // Open related panel on the right side
  relatedPanel.classList.remove("hidden");
  relatedList.innerHTML = '<div class="related-loading"><div class="spinner"></div><span>Loading related...</span></div>';
  relatedSource.textContent = videoTitle || videoId;

  try {
    const res = await fetch(`/api/related/${videoId}?maxResults=20`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    relatedList.innerHTML = "";
    for (const v of data.videos) {
      const item = document.createElement("div");
      item.className = "related-item";
      item.innerHTML = `
        <div class="related-row">
          <img src="${v.thumbnail}" alt="" loading="lazy" class="related-thumb" />
          <div class="related-info">
            <div class="related-title">${v.title}</div>
            <div class="related-channel">${v.channel}</div>
          </div>
        </div>
      `;

      // Click related item -> open actions menu
      item.addEventListener("click", () => {
        // Remove active from all items
        relatedList.querySelectorAll(".related-item.active").forEach((el) => el.classList.remove("active"));
        item.classList.add("active");
      });

      // Watch on hover/click area
      const actions = document.createElement("div");
      actions.className = "related-actions";
      actions.innerHTML = `
        <button class="related-action-btn" data-action="watch" title="Watch on YouTube">Watch</button>
        <button class="related-action-btn" data-action="transcript" title="Get Transcript">Transcript</button>
        <button class="related-action-btn" data-action="explore" title="Find related">Related</button>
      `;

      actions.querySelector('[data-action="watch"]').addEventListener("click", (e) => {
        e.stopPropagation();
        window.open(`https://www.youtube.com/watch?v=${v.videoId}`, "_blank");
      });

      actions.querySelector('[data-action="transcript"]').addEventListener("click", (e) => {
        e.stopPropagation();
        const url = encodeURIComponent(`https://www.youtube.com/watch?v=${v.videoId}`);
        window.open(`/?url=${url}`, "_blank");
      });

      actions.querySelector('[data-action="explore"]').addEventListener("click", (e) => {
        e.stopPropagation();
        exploreVideo(v.videoId, v.title);
      });

      item.appendChild(actions);
      relatedList.appendChild(item);
    }

    if (data.videos.length === 0) {
      relatedList.innerHTML = '<p class="related-empty">No related videos found.</p>';
    }
  } catch (err) {
    relatedList.innerHTML = `<p class="related-empty">Error: ${err.message}</p>`;
  }
}

closeRelatedBtn.addEventListener("click", () => {
  relatedPanel.classList.add("hidden");
});

// === Keyword Extraction ===

// Spam/junk patterns to filter from discover keywords
const SPAM_PATTERNS = [
  /^\d+$/, // pure numbers
  /^[a-z0-9]{1,2}$/, // too short (English)
  /微信|whatsapp|telegram|加好友|添加|回覆|回复|領取|领取|免費|免费|優惠|优惠|點擊|点击|薅羊毛/,
  /subscribe|giveaway|discount|coupon|promo|unboxing/,
  /@/, // social handles
  /^[a-z]+\d{3,}$/, // usernames like ethan05027
  /\d{4,}/, // 4+ digit number sequences (catches 888, phone numbers, IDs)
  /https?|www\.|\.com|\.cn|\.tw/, // URLs
  /好友|實戰攻略|指令|變現|賺錢|赚钱|秒殺|付費|频道|頻道/, // promo Chinese
  /^\d{1,3}$/, // short numbers like "55"
  /^.{30,}$/, // overly long strings (likely spam sentences)
];

function isSpamKeyword(word) {
  return SPAM_PATTERNS.some((p) => p.test(word));
}

function extractGlobalKeywords(videos) {
  const freq = {};
  // Prefer tags and topics from YouTube API (higher quality)
  for (const v of videos) {
    const ytKeywords = [
      ...(v.tags || []),
      ...(v.topics || []),
      v.category,
    ].filter(Boolean);

    for (const kw of ytKeywords) {
      const k = kw.toLowerCase().trim();
      if (!k || activeTopics.includes(k) || isSpamKeyword(k)) continue;
      freq[k] = (freq[k] || 0) + 2; // boost YT-sourced keywords
    }
  }

  // Also extract from titles (not descriptions — too spammy)
  for (const v of videos) {
    const text = v.title.toLowerCase();
    const clean = text
      .replace(/&[^;]+;/g, " ")
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff\u3400-\u4dbf\s]/g, " ");
    const words = clean.split(/\s+/).filter((w) => w.length > 2);
    const seen = new Set();
    for (const w of words) {
      if (STOP_WORDS.has(w) || seen.has(w) || activeTopics.includes(w)) continue;
      if (isSpamKeyword(w)) continue;
      seen.add(w);
      freq[w] = (freq[w] || 0) + 1;
    }
  }

  return Object.entries(freq)
    .filter(([w, c]) => c >= 2 && !isSpamKeyword(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);
}

function getVideoTags(video) {
  const result = [];

  if (video.category) {
    result.push({ text: video.category, type: "category" });
  }

  if (video.topics) {
    for (const t of video.topics.slice(0, 3)) {
      result.push({ text: t, type: "topic" });
    }
  }

  if (video.tags) {
    for (const t of video.tags.slice(0, 3)) {
      result.push({ text: t, type: "tag" });
    }
  }

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

// === AI Functions ===

async function fetchCardTranscript(videoId) {
  const res = await fetch("/api/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to fetch transcript");
  return data;
}

async function handleAISummary(videoId, videoTitle, card) {
  const aiSection = card.querySelector(".card-ai-section");
  const summaryText = card.querySelector(".ai-summary-text");
  const topicsWrap = card.querySelector(".ai-topics");
  const keywordsWrap = card.querySelector(".ai-keywords");
  const qaInput = card.querySelector(".ai-qa-input");
  const qaSend = card.querySelector(".ai-qa-send");
  const qaAnswer = card.querySelector(".ai-qa-answer");
  const summaryBtn = card.querySelector(".ai-summary-btn");

  // If already expanded, toggle off
  if (!aiSection.classList.contains("hidden")) {
    aiSection.classList.add("hidden");
    return;
  }

  summaryBtn.textContent = "Loading...";
  summaryBtn.disabled = true;

  try {
    // Step 1: Get transcript
    const transcriptData = await fetchCardTranscript(videoId);
    const fullText = transcriptData.fullText;

    // Store transcript on the card for Q&A
    card._transcriptText = fullText;
    card._videoTitle = videoTitle;

    // Step 2: Get AI summary
    const model = modelSelect.value;
    const aiRes = await fetch("/api/ai/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: fullText, model, videoTitle }),
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) throw new Error(aiData.error || "AI summarize failed");

    // Render summary
    summaryText.textContent = aiData.summary;

    // Render topics
    topicsWrap.innerHTML = "";
    for (const t of aiData.topics || []) {
      const span = document.createElement("span");
      span.className = "ai-tag ai-tag-topic";
      span.textContent = t;
      span.addEventListener("click", (e) => {
        e.stopPropagation();
        addTopic(t);
      });
      topicsWrap.appendChild(span);
    }

    // Render keywords
    keywordsWrap.innerHTML = "";
    for (const k of aiData.keywords || []) {
      const span = document.createElement("span");
      span.className = "ai-tag ai-tag-keyword";
      span.textContent = k;
      keywordsWrap.appendChild(span);
    }

    // Show section
    aiSection.classList.remove("hidden");

    // Setup Q&A handler
    const doAsk = async () => {
      const question = qaInput.value.trim();
      if (!question) return;

      qaSend.disabled = true;
      qaAnswer.textContent = "Thinking...";

      try {
        const askRes = await fetch("/api/ai/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: card._transcriptText,
            model: modelSelect.value,
            question,
            videoTitle: card._videoTitle,
          }),
        });
        const askData = await askRes.json();
        if (!askRes.ok) throw new Error(askData.error || "AI ask failed");
        qaAnswer.textContent = askData.answer;
      } catch (err) {
        qaAnswer.textContent = "Error: " + err.message;
      } finally {
        qaSend.disabled = false;
      }
    };

    // Remove old listeners by replacing elements
    const newSend = qaSend.cloneNode(true);
    qaSend.replaceWith(newSend);
    newSend.addEventListener("click", doAsk);

    const newInput = qaInput.cloneNode(true);
    qaInput.replaceWith(newInput);
    newInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doAsk();
    });
  } catch (err) {
    summaryText.textContent = "Error: " + err.message;
    aiSection.classList.remove("hidden");
  } finally {
    summaryBtn.textContent = "AI Summary";
    summaryBtn.disabled = false;
  }
}

// === Render ===

function createVideoCard(video) {
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
      <button class="card-btn ai-summary-btn">AI Summary</button>
    </div>
    <div class="card-ai-section hidden">
      <div class="ai-section-inner">
        <h4 class="ai-section-title">Summary</h4>
        <div class="ai-summary-text"></div>
        <div class="ai-tags-row">
          <div class="ai-tags-group">
            <span class="ai-tags-label">Topics:</span>
            <div class="ai-topics"></div>
          </div>
          <div class="ai-tags-group">
            <span class="ai-tags-label">Keywords:</span>
            <div class="ai-keywords"></div>
          </div>
        </div>
        <div class="ai-qa-section">
          <h4 class="ai-section-title">Ask a Question</h4>
          <div class="ai-qa-row">
            <input type="text" class="ai-qa-input" placeholder="Ask about this video..." />
            <button class="ai-qa-send">Ask</button>
          </div>
          <div class="ai-qa-answer"></div>
        </div>
      </div>
    </div>
  `;

  card.querySelector(".thumb-wrap").addEventListener("click", () => {
    exploreVideo(video.videoId, video.title);
  });

  card.querySelectorAll(".vtag").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      addTopic(el.dataset.tag);
    });
  });

  card.querySelector(".watch-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    window.open(`https://www.youtube.com/watch?v=${video.videoId}`, "_blank");
  });

  card.querySelector(".transcript-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const url = encodeURIComponent(`https://www.youtube.com/watch?v=${video.videoId}`);
    window.open(`/?url=${url}`, "_blank");
  });

  card.querySelector(".ai-summary-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    handleAISummary(video.videoId, video.title, card);
  });

  return card;
}

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
    grid.appendChild(createVideoCard(video));
  }
}

function appendResults(videos) {
  for (const video of videos) {
    grid.appendChild(createVideoCard(video));
  }
}

// === Infinite Scroll ===

window.addEventListener("scroll", () => {
  // Trigger when user scrolls near the bottom (200px from end)
  const scrollBottom = window.innerHeight + window.scrollY;
  const docHeight = document.documentElement.scrollHeight;
  if (docHeight - scrollBottom < 300) {
    loadMoreResults();
  }
});

// === Init ===

searchBtn.addEventListener("click", () => {
  const q = searchInput.value.trim();
  if (!q) return;
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
