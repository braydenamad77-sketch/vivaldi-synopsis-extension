(() => {
  const DEBUG_LOGS = true;
  const cLog = (...args) => {
    if (!DEBUG_LOGS) return;
    console.log("[VS][CONTENT]", ...args);
  };

  const previousCleanup = window.__VIVALDI_SYNOPSIS_CLEANUP__;
  if (typeof previousCleanup === "function") {
    try {
      previousCleanup();
    } catch (_error) {
      // Ignore stale cleanup handlers from prior injected instances.
    }
  }

  window.__VIVALDI_SYNOPSIS_INJECTED__ = true;
  cLog("script:boot", { href: window.location.href });
  const cleanupHandlers = [];

  function registerCleanup(fn) {
    cleanupHandlers.push(fn);
  }

  const ROOT_ID = "vivaldi-synopsis-root";
  const CARD_ID = "vivaldi-synopsis-card";
  const ENABLE_HYBRID_PANEL_BALANCE = true;
  const PANEL_HEIGHT_MIN = 390;
  const PANEL_HEIGHT_MAX = 520;
  let lastContextMenuPos = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

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
      return {
        top: window.scrollY + 24,
        left: window.scrollX + Math.max(12, window.innerWidth - 610),
      };
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    return {
      top: rect.bottom + window.scrollY + 8,
      left: rect.left + window.scrollX,
    };
  }

  function clampToViewport(rawPos, cardRect) {
    const margin = 8;
    const minLeft = window.scrollX + margin;
    const maxLeft = window.scrollX + window.innerWidth - cardRect.width - margin;
    const minTop = window.scrollY + margin;
    const maxTop = window.scrollY + window.innerHeight - cardRect.height - margin;

    return {
      left: Math.min(maxLeft, Math.max(minLeft, rawPos.left)),
      top: Math.min(maxTop, Math.max(minTop, rawPos.top)),
    };
  }

  function closeCard() {
    const existing = document.getElementById(CARD_ID);
    if (existing) {
      if (typeof existing.__vsCleanup === "function") {
        existing.__vsCleanup();
      }
      existing.remove();
    }
  }

  function readCardAnchor(card) {
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    return {
      top: window.scrollY + rect.top,
      left: window.scrollX + rect.left,
    };
  }

  function getPanelImageRatio(card) {
    const image = card.querySelector(".vs-panel-artwork-image");
    if (image?.naturalWidth && image?.naturalHeight) {
      const ratio = image.naturalWidth / image.naturalHeight;
      return clamp(ratio, 0.5, 1.8);
    }
    // Most book covers and posters are close to 2:3.
    return 2 / 3;
  }

  function applyHybridPanelHeight(card) {
    if (!ENABLE_HYBRID_PANEL_BALANCE || !card.classList.contains("vs-card--panel-hybrid")) return;

    const left = card.querySelector(".vs-panel-left");
    const right = card.querySelector(".vs-panel-right");
    if (!left || !right) return;

    card.style.removeProperty("--vs-panel-height");

    const rightStyle = window.getComputedStyle(right);
    const rightPadX = (Number.parseFloat(rightStyle.paddingLeft) || 0) + (Number.parseFloat(rightStyle.paddingRight) || 0);
    const rightPadY = (Number.parseFloat(rightStyle.paddingTop) || 0) + (Number.parseFloat(rightStyle.paddingBottom) || 0);

    const artFrame = right.querySelector(".vs-panel-artwork-image, .vs-panel-artwork-placeholder");
    const artworkWidth = artFrame?.clientWidth || Math.max(0, right.clientWidth - rightPadX);
    const ratio = getPanelImageRatio(card);

    const textIdeal = left.scrollHeight;
    const imageIdeal = artworkWidth > 0 ? artworkWidth / ratio + rightPadY : right.scrollHeight;

    // Blend text and artwork needs so neither side dominates the panel height.
    const blendedHeight = Math.round(textIdeal * 0.64 + imageIdeal * 0.36);
    const finalHeight = clamp(blendedHeight, PANEL_HEIGHT_MIN, PANEL_HEIGHT_MAX);

    card.style.setProperty("--vs-panel-height", `${finalHeight}px`);
  }

  function positionCard(card, anchorPos) {
    const rect = card.getBoundingClientRect();
    const rawPos = anchorPos || getSelectionPosition();
    const clamped = clampToViewport(rawPos, rect);

    card.style.top = `${clamped.top}px`;
    card.style.left = `${clamped.left}px`;
    card.style.visibility = "visible";
  }

  function mountCard(card, options = {}) {
    const root = createRoot();
    const existing = document.getElementById(CARD_ID);
    const existingAnchor = readCardAnchor(existing);
    closeCard();

    card.style.visibility = "hidden";
    card.style.top = `${window.scrollY}px`;
    card.style.left = `${window.scrollX}px`;

    root.appendChild(card);
    applyHybridPanelHeight(card);
    positionCard(card, options.anchorPos || existingAnchor || undefined);
  }

  const handleContextMenu = (event) => {
    lastContextMenuPos = {
      top: window.scrollY + event.clientY + 8,
      left: window.scrollX + event.clientX + 6,
    };
    cLog("contextmenu:capture", lastContextMenuPos);
  };
  document.addEventListener("contextmenu", handleContextMenu, true);
  registerCleanup(() => document.removeEventListener("contextmenu", handleContextMenu, true));

  function buildCompactShell(title = "Synopsis") {
    const card = document.createElement("section");
    card.id = CARD_ID;
    card.className = "vs-card vs-card--compact";

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

  function buildPanelShell() {
    const card = document.createElement("section");
    card.id = CARD_ID;
    card.className = "vs-card vs-card--panel";
    return card;
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

  function buildNoArtTitle(title) {
    return (title || "UNKNOWN TITLE")
      .replace(/\(\d{4}\)/g, "")
      .trim()
      .toUpperCase();
  }

  function renderPlaceholderPane(result) {
    const wrapper = document.createElement("div");
    wrapper.className = "vs-panel-artwork-placeholder";

    const title = document.createElement("p");
    title.className = "vs-panel-artwork-title";
    title.textContent = buildNoArtTitle(result.title);

    const divider = document.createElement("div");
    divider.className = "vs-panel-artwork-divider";

    const year = document.createElement("p");
    year.className = "vs-panel-artwork-year";
    year.textContent = result.year ? String(result.year) : "UNKNOWN";

    wrapper.append(title, divider, year);
    return wrapper;
  }

  function renderPanelArtwork(container, result) {
    container.textContent = "";

    if (!result.artworkUrl) {
      container.appendChild(renderPlaceholderPane(result));
      return;
    }

    const image = document.createElement("img");
    image.className = "vs-panel-artwork-image";
    image.alt = `${result.title || "Artwork"} artwork`;
    image.src = result.artworkUrl;
    image.addEventListener("load", () => {
      const card = image.closest(`#${CARD_ID}`);
      if (!card) return;
      applyHybridPanelHeight(card);
      positionCard(card);
    });
    image.addEventListener("error", () => {
      container.textContent = "";
      container.appendChild(renderPlaceholderPane(result));
      const card = container.closest(`#${CARD_ID}`);
      if (!card) return;
      applyHybridPanelHeight(card);
      positionCard(card);
    });

    container.appendChild(image);
  }

  function showLoading(query) {
    const card = buildCompactShell("Getting Synopsis");

    const sub = document.createElement("p");
    sub.className = "vs-sub";
    sub.textContent = query ? `Searching for: ${query}` : "Searching title";

    const shimmer = document.createElement("div");
    shimmer.className = "vs-shimmer";

    card.append(sub, shimmer);
    mountCard(card);
  }

  function showCompactResult(result) {
    const card = buildCompactShell(result.title || "Synopsis");

    const meta = metadataRow(result);

    const synopsis = document.createElement("p");
    synopsis.className = "vs-synopsis";
    synopsis.textContent = result.synopsis;

    const foot = document.createElement("p");
    foot.className = "vs-foot";
    foot.textContent = `Sources: ${result.sourceAttribution}${result.fromCache ? " (cached)" : ""}`;

    card.append(meta, synopsis, foot);
    mountCard(card);
  }

  function showSearchInput() {
    cLog("showSearchInput:start", { anchor: lastContextMenuPos });
    const card = document.createElement("section");
    card.id = CARD_ID;
    card.className = "vs-card vs-card--search";
    const openedAt = Date.now();

    const form = document.createElement("form");
    form.className = "vs-search-form";

    const input = document.createElement("input");
    input.className = "vs-search-input";
    input.type = "text";
    input.placeholder = "Search book, movie, or TV title...";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Search title");
    form.append(input);
    card.append(form);

    const closeIfOutside = (event) => {
      if (Date.now() - openedAt < 280) return;
      if (!card.contains(event.target)) {
        cLog("showSearchInput:close:outsideClick");
        closeCard();
      }
    };

    const cleanup = () => {
      document.removeEventListener("mousedown", closeIfOutside, true);
    };
    card.__vsCleanup = cleanup;

    setTimeout(() => {
      document.addEventListener("mousedown", closeIfOutside, true);
    }, 0);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = input.value.trim();
      if (!query) {
        cLog("showSearchInput:submit:empty");
        return;
      }

      cLog("showSearchInput:submit", { query });
      showLoading(query);

      const response = await chrome.runtime.sendMessage({
        type: "RUN_LOOKUP_QUERY",
        query,
      });
      cLog("showSearchInput:submit:response", response);

      if (response?.status === "error") {
        showError(response.message || "Lookup failed.");
      }
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cLog("showSearchInput:close:escape");
        closeCard();
      }
    });

    const fallbackPos = {
      left: window.scrollX + Math.max(20, (window.innerWidth - 520) / 2),
      top: window.scrollY + 64,
    };
    mountCard(card, { anchorPos: lastContextMenuPos || fallbackPos });

    setTimeout(() => input.focus(), 0);
  }

  function createAutoResolvedNote() {
    const note = document.createElement("p");
    note.className = "vs-auto-note";
    note.textContent = "Resolved automatically";
    setTimeout(() => note.remove(), 2400);
    return note;
  }

  function genreSourceTooltip(genreSource) {
    if (genreSource === "ai") return "Genre source: AI prediction";
    if (genreSource === "provider") return "Genre source: Provider metadata";
    return "Genre source: Unknown";
  }

  function createGenreOriginBadge(genreSource) {
    const wrap = document.createElement("span");
    wrap.className = "vs-genre-origin-wrap";

    const badge = document.createElement("span");
    badge.className = "vs-genre-origin";
    badge.setAttribute("role", "img");
    badge.setAttribute("aria-label", "Info");
    badge.textContent = "i";

    const tooltip = document.createElement("span");
    tooltip.className = "vs-genre-origin-tooltip";
    tooltip.textContent = genreSourceTooltip(genreSource);

    wrap.append(badge, tooltip);
    return wrap;
  }

  function showPanelResult(result, options = {}) {
    const card = buildPanelShell();
    if (ENABLE_HYBRID_PANEL_BALANCE) {
      card.classList.add("vs-card--panel-hybrid");
    }

    const left = document.createElement("section");
    left.className = "vs-panel-left";

    const right = document.createElement("section");
    right.className = "vs-panel-right";

    const header = document.createElement("header");
    header.className = "vs-header";

    const title = document.createElement("h2");
    title.className = "vs-title";
    title.textContent = result.title || "Synopsis";

    const close = document.createElement("button");
    close.className = "vs-close";
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close synopsis card");
    close.addEventListener("click", closeCard);

    header.append(title, close);

    const chips = document.createElement("div");
    chips.className = "vs-meta";

    const mediaTag = result.primaryTag || (result.mediaType ? String(result.mediaType).toUpperCase() : "MEDIA");
    const yearTag = result.secondaryTag || (result.year ? String(result.year) : undefined);
    const creatorTag =
      result.directorOrCreatorTag ||
      result.authorTag ||
      (result.directorOrCreator ? `DIRECTOR/CREATOR: ${String(result.directorOrCreator).toUpperCase()}` : undefined) ||
      (result.author ? `AUTHOR: ${String(result.author).toUpperCase()}` : undefined);
    const castTag =
      result.castTag ||
      (Array.isArray(result.cast) && result.cast.length
        ? `CAST: ${result.cast.slice(0, 4).join(", ").toUpperCase()}`
        : undefined);

    [mediaTag, yearTag, creatorTag, castTag].forEach((text) => {
      if (!text) return;
      const chip = document.createElement("span");
      chip.className = "vs-chip";
      chip.textContent = text;
      chips.appendChild(chip);
    });

    const autoNote = options.autoResolved ? createAutoResolvedNote() : null;

    const synopsis = document.createElement("p");
    synopsis.className = "vs-synopsis";
    synopsis.textContent = result.synopsis;

    const footerRow = document.createElement("div");
    footerRow.className = "vs-footer-row";

    const foot = document.createElement("p");
    foot.className = "vs-foot";
    foot.textContent = `Sources: ${result.sourceAttribution}${result.fromCache ? " (cached)" : ""}`;

    const genre = document.createElement("p");
    genre.className = "vs-foot vs-foot--right vs-genre-meta";

    const genreText = document.createElement("span");
    genreText.textContent = result.genreLabel || "—";
    if (!result.genreLabel) genreText.classList.add("vs-foot--placeholder");

    const genreOrigin = createGenreOriginBadge(result.genreSource || "unknown");
    genre.append(genreText, genreOrigin);

    footerRow.append(foot, genre);

    left.append(header, chips);
    if (autoNote) left.appendChild(autoNote);
    left.append(synopsis, footerRow);
    renderPanelArtwork(right, result);

    card.append(left, right);
    mountCard(card);
  }

  function showResult(result, options = {}) {
    if (result.resultUiMode === "without_image" || result.resultUiMode === "compact") {
      showCompactResult(result);
      return;
    }
    showPanelResult(result, options);
  }

  function candidateLabel(candidate) {
    const parts = [candidate.title, candidate.mediaType.toUpperCase()];
    if (candidate.year) parts.push(String(candidate.year));
    if (candidate.authorOrDirector) parts.push(candidate.authorOrDirector);
    return parts.join(" • ");
  }

  function appendCandidateButtons({ requestId, originalQuery, container, items }) {
    items.forEach((candidate) => {
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
          showResult(response.result, { autoResolved: false });
        } else {
          showError(response?.message || "Could not resolve your selection.");
        }
      });
      container.appendChild(button);
    });
  }

  function showAmbiguous({ requestId, candidates, originalQuery, note }) {
    const card = buildCompactShell("Pick the Right Title");

    const help = document.createElement("p");
    help.className = "vs-sub";
    help.textContent = `Multiple matches found for "${originalQuery}"`;

    const list = document.createElement("div");
    list.className = "vs-candidate-list";

    const moviesTv = candidates.filter((candidate) => candidate.mediaType === "movie" || candidate.mediaType === "tv");
    const books = candidates.filter((candidate) => candidate.mediaType === "book");
    const others = candidates.filter((candidate) => candidate.mediaType !== "movie" && candidate.mediaType !== "tv" && candidate.mediaType !== "book");

    if (moviesTv.length && books.length) {
      const moviesLabel = document.createElement("p");
      moviesLabel.className = "vs-group-label";
      moviesLabel.textContent = "Movies & TV";
      list.appendChild(moviesLabel);
      appendCandidateButtons({ requestId, originalQuery, container: list, items: moviesTv });

      const booksLabel = document.createElement("p");
      booksLabel.className = "vs-group-label";
      booksLabel.textContent = "Books";
      list.appendChild(booksLabel);
      appendCandidateButtons({ requestId, originalQuery, container: list, items: books });

      if (others.length) {
        const otherLabel = document.createElement("p");
        otherLabel.className = "vs-group-label";
        otherLabel.textContent = "Other";
        list.appendChild(otherLabel);
        appendCandidateButtons({ requestId, originalQuery, container: list, items: others });
      }
    } else {
      appendCandidateButtons({ requestId, originalQuery, container: list, items: candidates });
    }

    card.append(help);
    if (note) {
      const noteEl = document.createElement("p");
      noteEl.className = "vs-note";
      noteEl.textContent = note;
      card.appendChild(noteEl);
    }
    card.append(list);
    mountCard(card);
  }

  function showError(message) {
    const card = buildCompactShell("Synopsis Unavailable");

    const body = document.createElement("p");
    body.className = "vs-error";
    body.textContent = message || "Something went wrong. Try again.";

    card.appendChild(body);
    mountCard(card);
  }

  const handleRuntimeMessage = (message, _sender, sendResponse) => {
    if (!message?.type) return;
    cLog("runtime:onMessage", { type: message.type });

    if (message.type === "VS_PING") {
      if (typeof sendResponse === "function") {
        sendResponse({ ok: true });
      }
      return true;
    }

    if (message.type === "SHOW_SEARCH_INPUT") {
      showSearchInput();
      if (typeof sendResponse === "function") {
        sendResponse({ ok: true });
      }
      return true;
    }

    if (message.type === "SHOW_LOADING") {
      showLoading(message.query);
      return;
    }

    if (message.type === "SHOW_RESULT") {
      showResult(message.result, { autoResolved: message.autoResolved !== false });
      return;
    }

    if (message.type === "SHOW_AMBIGUOUS") {
      showAmbiguous(message);
      return;
    }

    if (message.type === "SHOW_ERROR") {
      showError(message.message);
    }

    return false;
  };

  if (chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    registerCleanup(() => {
      if (chrome?.runtime?.onMessage?.removeListener) {
        chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      }
    });
  }

  registerCleanup(() => {
    closeCard();
    const root = document.getElementById(ROOT_ID);
    if (root) root.remove();
  });

  window.__VIVALDI_SYNOPSIS_CLEANUP__ = () => {
    cLog("script:cleanup");
    while (cleanupHandlers.length) {
      const fn = cleanupHandlers.pop();
      try {
        fn();
      } catch (_error) {
        // Ignore cleanup errors during reinjection.
      }
    }
  };
})();
