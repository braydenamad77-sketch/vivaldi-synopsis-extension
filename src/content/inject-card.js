(() => {
  if (window.__VIVALDI_SYNOPSIS_INJECTED__) {
    return;
  }
  window.__VIVALDI_SYNOPSIS_INJECTED__ = true;

  const ROOT_ID = "vivaldi-synopsis-root";
  const CARD_ID = "vivaldi-synopsis-card";

  function createRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.setAttribute("aria-live", "polite");
      document.documentElement.appendChild(root);
    }
    return root;
  }

  function getSelectionPosition() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { top: 24, left: window.innerWidth - 360 };
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const top = Math.max(12, rect.bottom + window.scrollY + 8);
    const left = Math.min(window.innerWidth - 360, Math.max(12, rect.left + window.scrollX));

    return { top, left };
  }

  function closeCard() {
    const existing = document.getElementById(CARD_ID);
    if (existing) existing.remove();
  }

  function buildShell(title = "Synopsis") {
    const card = document.createElement("section");
    card.id = CARD_ID;
    card.className = "vs-card";

    const header = document.createElement("header");
    header.className = "vs-header";

    const h = document.createElement("h2");
    h.className = "vs-title";
    h.textContent = title;

    const close = document.createElement("button");
    close.className = "vs-close";
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close synopsis card");
    close.addEventListener("click", closeCard);

    header.append(h, close);
    card.appendChild(header);

    return card;
  }

  function mountCard(card) {
    const root = createRoot();
    closeCard();

    const pos = getSelectionPosition();
    card.style.top = `${pos.top}px`;
    card.style.left = `${pos.left}px`;

    root.appendChild(card);
  }

  function metadataRow(result) {
    const row = document.createElement("div");
    row.className = "vs-meta";

    const chips = [];
    chips.push(result.mediaType?.toUpperCase() || "MEDIA");
    if (result.year) chips.push(String(result.year));
    if (result.author) chips.push(`Author: ${result.author}`);
    if (result.directorOrCreator) chips.push(`Director/Creator: ${result.directorOrCreator}`);
    if (Array.isArray(result.cast) && result.cast.length) chips.push(`Cast: ${result.cast.slice(0, 3).join(", ")}`);

    chips.forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "vs-chip";
      chip.textContent = text;
      row.appendChild(chip);
    });

    return row;
  }

  function showLoading(query) {
    const card = buildShell("Getting Synopsis");

    const sub = document.createElement("p");
    sub.className = "vs-sub";
    sub.textContent = query ? `Searching for: ${query}` : "Searching title";

    const shimmer = document.createElement("div");
    shimmer.className = "vs-shimmer";

    card.append(sub, shimmer);
    mountCard(card);
  }

  function showResult(result) {
    const card = buildShell(result.title || "Synopsis");

    const meta = metadataRow(result);

    const synopsis = document.createElement("p");
    synopsis.className = "vs-synopsis";
    synopsis.textContent = result.synopsis;

    const foot = document.createElement("p");
    foot.className = "vs-foot";
    foot.textContent = `Source: ${result.sourceAttribution}${result.fromCache ? " (cached)" : ""}`;

    card.append(meta, synopsis, foot);
    mountCard(card);
  }

  function candidateLabel(candidate) {
    const parts = [candidate.title, candidate.mediaType.toUpperCase()];
    if (candidate.year) parts.push(String(candidate.year));
    if (candidate.authorOrDirector) parts.push(candidate.authorOrDirector);
    return parts.join(" • ");
  }

  function showAmbiguous({ requestId, candidates, originalQuery }) {
    const card = buildShell("Pick the Right Title");

    const help = document.createElement("p");
    help.className = "vs-sub";
    help.textContent = `Multiple matches found for "${originalQuery}"`;

    const list = document.createElement("div");
    list.className = "vs-candidate-list";

    candidates.forEach((candidate) => {
      const button = document.createElement("button");
      button.className = "vs-candidate";
      button.type = "button";
      button.textContent = candidateLabel(candidate);
      button.addEventListener("click", async () => {
        showLoading(candidate.title);

        const response = await chrome.runtime.sendMessage({
          type: "RESOLVE_AMBIGUITY",
          requestId,
          selectedCandidateId: candidate.id,
          originalQuery,
        });

        if (response?.status === "ok") {
          showResult(response.result);
        } else {
          showError(response?.message || "Could not resolve your selection.");
        }
      });
      list.appendChild(button);
    });

    card.append(help, list);
    mountCard(card);
  }

  function showError(message) {
    const card = buildShell("Synopsis Unavailable");

    const body = document.createElement("p");
    body.className = "vs-error";
    body.textContent = message || "Something went wrong. Try again.";

    card.appendChild(body);
    mountCard(card);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message?.type) return;

    if (message.type === "SHOW_LOADING") {
      showLoading(message.query);
      return;
    }

    if (message.type === "SHOW_RESULT") {
      showResult(message.result);
      return;
    }

    if (message.type === "SHOW_AMBIGUOUS") {
      showAmbiguous(message);
      return;
    }

    if (message.type === "SHOW_ERROR") {
      showError(message.message);
    }
  });
})();
