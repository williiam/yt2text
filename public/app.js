const urlInput = document.getElementById("url-input");
const fetchBtn = document.getElementById("fetch-btn");
const errorEl = document.getElementById("error");
const loadingEl = document.getElementById("loading");
const resultEl = document.getElementById("result");
const transcriptText = document.getElementById("transcript-text");
const copyBtn = document.getElementById("copy-btn");

fetchBtn.addEventListener("click", fetchTranscript);
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") fetchTranscript();
});

async function fetchTranscript() {
  const url = urlInput.value.trim();
  if (!url) return;

  errorEl.classList.add("hidden");
  resultEl.classList.add("hidden");
  loadingEl.classList.remove("hidden");
  fetchBtn.disabled = true;

  try {
    const res = await fetch("/api/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to fetch transcript");
    }

    transcriptText.textContent = data.fullText;
    resultEl.classList.remove("hidden");
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    loadingEl.classList.add("hidden");
    fetchBtn.disabled = false;
  }
}

copyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(transcriptText.textContent).then(() => {
    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.textContent = "Copy to Clipboard";
    }, 2000);
  });
});
