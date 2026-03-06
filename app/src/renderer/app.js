const els = {
  statusText: document.getElementById("statusText"),
  searchInput: document.getElementById("searchInput"),
  resultsList: document.getElementById("resultsList"),
  detailEmpty: document.getElementById("detailEmpty"),
  detailCard: document.getElementById("detailCard"),
  detailArtwork: document.getElementById("detailArtwork"),
  detailMeta: document.getElementById("detailMeta"),
  detailTitle: document.getElementById("detailTitle"),
  detailSource: document.getElementById("detailSource"),
  detailSynopsis: document.getElementById("detailSynopsis"),
  detailJson: document.getElementById("detailJson"),
};

let activeCacheKey = "";
let rows = [];

function formatTime(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function resultRowThumb(entry) {
  if (entry.artworkUrl) {
    return `<img class="result-thumb" src="${entry.artworkUrl}" alt="" />`;
  }
  return `<div class="result-thumb placeholder">${entry.mediaType || "media"}</div>`;
}

function renderList() {
  if (!rows.length) {
    els.resultsList.innerHTML = `<div class="empty-state">No cached results yet. Run lookups in the extension and they will appear here.</div>`;
    return;
  }

  els.resultsList.innerHTML = rows
    .map(
      (entry) => `
        <button type="button" class="result-row ${entry.cacheKey === activeCacheKey ? "active" : ""}" data-cache-key="${entry.cacheKey}">
          ${resultRowThumb(entry)}
          <div>
            <p class="result-title">${entry.title || "Untitled"}</p>
            <p class="result-meta">${[entry.mediaType, entry.year].filter(Boolean).join(" • ")}</p>
            <p class="result-source">${[entry.sourceAttribution, formatTime(entry.updatedAt)].filter(Boolean).join(" • ")}</p>
          </div>
        </button>
      `,
    )
    .join("");

  els.resultsList.querySelectorAll("[data-cache-key]").forEach((button) => {
    button.addEventListener("click", () => {
      showDetail(button.dataset.cacheKey).catch((error) => {
        els.statusText.textContent = error?.message || "Could not load cached result.";
      });
    });
  });
}

async function refreshList() {
  rows = await window.companionApp.listCacheEntries(els.searchInput.value || "");
  renderList();
  els.statusText.textContent = `${rows.length} cached result${rows.length === 1 ? "" : "s"} in the local app database.`;
}

async function showDetail(cacheKey) {
  const entry = await window.companionApp.getCacheEntry(cacheKey);
  activeCacheKey = cacheKey;
  renderList();

  if (!entry) {
    els.detailCard.hidden = true;
    els.detailEmpty.hidden = false;
    return;
  }

  els.detailEmpty.hidden = true;
  els.detailCard.hidden = false;
  els.detailTitle.textContent = entry.title || "Untitled";
  els.detailMeta.textContent = [entry.mediaType, entry.year, entry.genreLabel].filter(Boolean).join(" • ");
  els.detailSource.textContent = [entry.sourceAttribution, `Updated ${formatTime(entry.updatedAt)}`].filter(Boolean).join(" • ");
  els.detailSynopsis.textContent = entry.synopsis || "(empty)";
  els.detailJson.textContent = JSON.stringify(entry.result || {}, null, 2);

  if (entry.artworkUrl) {
    els.detailArtwork.hidden = false;
    els.detailArtwork.src = entry.artworkUrl;
  } else {
    els.detailArtwork.hidden = true;
    els.detailArtwork.removeAttribute("src");
  }
}

let debounceTimer;
els.searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    refreshList().catch((error) => {
      els.statusText.textContent = error?.message || "Could not refresh cache list.";
    });
  }, 120);
});

window.companionApp
  .getStatus()
  .then((status) => {
    els.statusText.textContent = `Server ready at ${status.serverUrl}. Loading local cache…`;
    return refreshList();
  })
  .catch((error) => {
    els.statusText.textContent = error?.message || "Could not connect to the companion app.";
  });
