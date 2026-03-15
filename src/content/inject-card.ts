import { DEFAULT_SETTINGS, getSynopsisPopupUiFlagVersion } from "../config/constants";
import { isStaleLookupResponse, trackLatestLookupRequest } from "../content/request-state";
import { getSearchOverlayPosition, shouldCaptureSearchOverlayKey } from "../content/search-overlay";
import { isShortcutMatch } from "../core/shortcut";
import type { Candidate, ExtensionSettings, LookupResult } from "../types";
import type {
  BackgroundRuntimeRequest,
  ContentScriptAckResponse,
  ContentUiMessage,
  OpenGoogleSearchResponse,
  ResolveAmbiguityResponse,
  RunLookupQueryResponse,
} from "../runtime/messages";

type CleanupHandler = () => void;
type CardAnchor = { top: number; left: number };
type ContentCardElement = HTMLElement & {
  __vsCleanup?: CleanupHandler;
  __vsAnchorPos?: CardAnchor;
};
type CardMountOptions = {
  anchorPos?: CardAnchor | null;
};
type SearchOverlayAck = Pick<ContentScriptAckResponse, "ok" | "opened" | "focused">;
type ActionButtonOptions = {
  ariaLabel?: string;
  withExternalIcon?: boolean;
};
type ResultDisplayOptions = {
  autoResolved?: boolean;
};
type LookupRunOptions = {
  widerSearch?: boolean;
};
type ErrorDisplayOptions = {
  errorCode?: string;
  lookupQuery?: string;
  allowWideSearch?: boolean;
};
type ErrorAction = {
  label: string;
  run: () => void | Promise<void>;
  secondary?: boolean;
};
type AmbiguousPayload = {
  requestId: string;
  candidates: Candidate[];
  originalQuery: string;
  note?: string;
};
type CandidateButtonGroup = {
  requestId: string;
  originalQuery: string;
  container: HTMLElement;
  items: Candidate[];
};
type LookupDisplayResult = LookupResult & {
  synopsis?: string;
  sourceAttribution?: string;
};

export function startSynopsisContentScript() {
  const DEBUG_LOGS = false;
  const cLog = (...args: unknown[]) => {
    if (!DEBUG_LOGS) return;
    console.log("[VS][CONTENT]", ...args);
  };

  const windowWithCleanup = window as Window & {
    __VIVALDI_SYNOPSIS_CLEANUP__?: () => void;
    __VIVALDI_SYNOPSIS_INJECTED__?: boolean;
  };

  const previousCleanup = windowWithCleanup.__VIVALDI_SYNOPSIS_CLEANUP__;
  if (typeof previousCleanup === "function") {
    try {
      previousCleanup();
    } catch (_error) {
      // Ignore stale cleanup handlers from prior injected instances.
    }
  }

  windowWithCleanup.__VIVALDI_SYNOPSIS_INJECTED__ = true;
  cLog("script:boot", { href: window.location.href });
  const cleanupHandlers: CleanupHandler[] = [];

  function registerCleanup(fn: CleanupHandler) {
    cleanupHandlers.push(fn);
  }

  const ROOT_ID = "vivaldi-synopsis-root";
  const CARD_ID = "vivaldi-synopsis-card";
  const ENABLE_HYBRID_PANEL_BALANCE = true;
  const PANEL_HEIGHT_MIN = 390;
  const PANEL_HEIGHT_MAX = 520;
  const FOCUSABLE_SELECTOR =
    ".vs-search-input, .vs-candidate, .vs-chip--action, .vs-header-action, .vs-genre-origin, .vs-close, .vs-button";
  const SEARCH_INPUT_SELECTOR = ".vs-search-input";
  let searchShortcutKey = "\\";
  const synopsisUiFlagVersion = getSynopsisPopupUiFlagVersion();
  let activeLookupRequestId = "";
  let restoreFocusTarget: HTMLElement | null = null;

  function applyExtensionSettings(rawSettings: Partial<ExtensionSettings> | undefined) {
    const settings = {
      ...DEFAULT_SETTINGS,
      ...(rawSettings || {}),
    };

    const shortcutKey = String(settings.searchShortcutKey || "\\").trim();
    searchShortcutKey = shortcutKey || "\\";
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  function nextTask() {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }

  function isEditableTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
    return Boolean(target.closest("[contenteditable]:not([contenteditable='false'])"));
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

  function clampToViewport(rawPos: CardAnchor, cardRect: DOMRect) {
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

  function mergeCardCleanup(card: ContentCardElement, fn: CleanupHandler) {
    const previous = typeof card.__vsCleanup === "function" ? card.__vsCleanup : null;
    card.__vsCleanup = () => {
      if (previous) previous();
      fn();
    };
  }

  function rememberFocusTarget(existingCard: HTMLElement | null) {
    if (existingCard) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest(`#${CARD_ID}`)) {
      restoreFocusTarget = active;
    }
  }

  function restorePreviousFocus() {
    if (!(restoreFocusTarget instanceof HTMLElement)) return;
    if (!restoreFocusTarget.isConnected) return;
    restoreFocusTarget.focus({ preventScroll: true });
  }

  function getSearchInput(card: ParentNode | null | undefined) {
    const input = card?.querySelector?.(SEARCH_INPUT_SELECTOR);
    return input instanceof HTMLInputElement ? input : null;
  }

  function getExistingSearchCard() {
    const existing = document.getElementById(CARD_ID) as ContentCardElement | null;
    if (!existing?.classList.contains("vs-card--search")) return null;
    return existing;
  }

  function focusElement(target: HTMLElement | null) {
    if (!(target instanceof HTMLElement) || !target.isConnected) return false;

    try {
      target.focus({ preventScroll: true });
    } catch {
      target.focus();
    }

    if (target instanceof HTMLInputElement) {
      const caret = target.value.length;
      try {
        target.setSelectionRange(caret, caret);
      } catch {
        // Some input types do not support selection ranges.
      }
    }

    return document.activeElement === target;
  }

  async function settleFocus(target: HTMLElement | null) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (focusElement(target)) return true;
      await nextTask();
    }
    return false;
  }

  function focusCard(card: HTMLElement) {
    const target = card.querySelector(FOCUSABLE_SELECTOR);
    if (target instanceof HTMLElement) return focusElement(target);
    if (card instanceof HTMLElement) return focusElement(card);
    return false;
  }

  function closeCard(options: { restoreFocus?: boolean } = {}) {
    const { restoreFocus = true } = options;
    const existing = document.getElementById(CARD_ID) as ContentCardElement | null;
    if (existing) {
      if (typeof existing.__vsCleanup === "function") {
        existing.__vsCleanup();
      }
      existing.remove();
    }

    if (restoreFocus) {
      restorePreviousFocus();
      restoreFocusTarget = null;
    }
  }

  function shouldIgnoreLookupMessage(requestId: string | undefined) {
    return isStaleLookupResponse(activeLookupRequestId, requestId);
  }

  function beginLookup(requestId: string | undefined) {
    activeLookupRequestId = trackLatestLookupRequest(activeLookupRequestId, requestId);
  }

  function readCardAnchor(card: HTMLElement | null) {
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    return {
      top: window.scrollY + rect.top,
      left: window.scrollX + rect.left,
    };
  }

  function getPanelImageRatio(card: HTMLElement) {
    const image = card.querySelector<HTMLImageElement>(".vs-panel-artwork-image");
    if (image?.naturalWidth && image?.naturalHeight) {
      const ratio = image.naturalWidth / image.naturalHeight;
      return clamp(ratio, 0.5, 1.8);
    }
    // Most book covers and posters are close to 2:3.
    return 2 / 3;
  }

  function applyHybridPanelHeight(card: HTMLElement) {
    if (!ENABLE_HYBRID_PANEL_BALANCE || !card.classList.contains("vs-card--panel-hybrid")) return;

    const left = card.querySelector<HTMLElement>(".vs-panel-left");
    const right = card.querySelector<HTMLElement>(".vs-panel-right");
    if (!left || !right) return;

    card.style.removeProperty("--vs-panel-height");

    const rightStyle = window.getComputedStyle(right);
    const rightPadX = (Number.parseFloat(rightStyle.paddingLeft) || 0) + (Number.parseFloat(rightStyle.paddingRight) || 0);
    const rightPadY = (Number.parseFloat(rightStyle.paddingTop) || 0) + (Number.parseFloat(rightStyle.paddingBottom) || 0);

    const artFrame = right.querySelector<HTMLElement>(".vs-panel-artwork-image, .vs-panel-artwork-placeholder");
    const artworkWidth = artFrame?.clientWidth || Math.max(0, right.clientWidth - rightPadX);
    const ratio = getPanelImageRatio(card);

    const textIdeal = left.scrollHeight;
    const imageIdeal = artworkWidth > 0 ? artworkWidth / ratio + rightPadY : right.scrollHeight;

    // Blend text and artwork needs so neither side dominates the panel height.
    const blendedHeight = Math.round(textIdeal * 0.64 + imageIdeal * 0.36);
    const finalHeight = clamp(blendedHeight, PANEL_HEIGHT_MIN, PANEL_HEIGHT_MAX);

    card.style.setProperty("--vs-panel-height", `${finalHeight}px`);
  }

  function positionCard(card: ContentCardElement, anchorPos?: CardAnchor) {
    const rect = card.getBoundingClientRect();
    const rawPos = anchorPos || card.__vsAnchorPos || getSelectionPosition();
    const clamped = clampToViewport(rawPos, rect);

    card.style.top = `${clamped.top}px`;
    card.style.left = `${clamped.left}px`;
    card.style.visibility = "visible";
    card.__vsAnchorPos = clamped;
  }

  function positionSearchOverlay(card: ContentCardElement) {
    const rect = card.getBoundingClientRect();
    const pos = getSearchOverlayPosition(
      {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      {
        width: rect.width,
        height: rect.height,
      },
    );

    card.style.top = `${pos.top}px`;
    card.style.left = `${pos.left}px`;
    card.style.visibility = "visible";
  }

  function installEscapeHandler(card: ContentCardElement) {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      closeCard();
    };

    document.addEventListener("keydown", handleEscape, true);
    mergeCardCleanup(card, () => document.removeEventListener("keydown", handleEscape, true));
  }

  function mountAnchoredCard(card: ContentCardElement, options: CardMountOptions = {}) {
    const root = createRoot();
    const existing = document.getElementById(CARD_ID) as ContentCardElement | null;
    const existingAnchor = readCardAnchor(existing);
    rememberFocusTarget(existing);
    closeCard({ restoreFocus: false });

    card.style.visibility = "hidden";
    card.style.top = `${window.scrollY}px`;
    card.style.left = `${window.scrollX}px`;
    card.style.removeProperty("position");
    card.style.removeProperty("transform");
    installEscapeHandler(card);

    root.appendChild(card);
    applyHybridPanelHeight(card);
    positionCard(card, options.anchorPos || existingAnchor || undefined);
    setTimeout(() => focusCard(card), 0);
  }

  async function mountSearchOverlay(card: ContentCardElement) {
    const existing = getExistingSearchCard();
    if (existing) {
      positionSearchOverlay(existing);
      const focused = await settleFocus(getSearchInput(existing));
      return {
        card: existing,
        input: getSearchInput(existing),
        opened: true,
        focused,
      };
    }

    const root = createRoot();
    const existingCard = document.getElementById(CARD_ID) as ContentCardElement | null;
    rememberFocusTarget(existingCard);
    closeCard({ restoreFocus: false });

    card.style.visibility = "hidden";
    card.style.top = "0px";
    card.style.left = "0px";
    card.style.position = "fixed";
    card.style.transform = "translate3d(0, 0, 0)";

    installEscapeHandler(card);

    const handleResize = () => {
      positionSearchOverlay(card);
    };
    window.addEventListener("resize", handleResize);
    mergeCardCleanup(card, () => window.removeEventListener("resize", handleResize));

    root.appendChild(card);
    positionSearchOverlay(card);

    const input = getSearchInput(card);
    const focused = await settleFocus(input);

    return {
      card,
      input,
      opened: true,
      focused,
    };
  }

  async function hydrateSettings() {
    const payload = await chrome.storage.local.get("settings");
    applyExtensionSettings(payload?.settings as Partial<ExtensionSettings> | undefined);
  }

  hydrateSettings().catch(() => {
    applyExtensionSettings(DEFAULT_SETTINGS);
  });

  if (chrome?.storage?.onChanged?.addListener) {
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: chrome.storage.AreaName) => {
      const settingsChange = changes.settings;
      if (areaName !== "local" || !settingsChange) return;
      applyExtensionSettings(settingsChange.newValue as Partial<ExtensionSettings> | undefined);
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    registerCleanup(() => chrome.storage.onChanged.removeListener(handleStorageChange));
  }

  const handleSlashShortcut = (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) return;
    if (!isShortcutMatch(event, searchShortcutKey)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    cLog("shortcut:manualSearch:open", { shortcutKey: searchShortcutKey });
    void showSearchInput();
  };
  document.addEventListener("keydown", handleSlashShortcut, true);
  registerCleanup(() => document.removeEventListener("keydown", handleSlashShortcut, true));

  async function openGoogleSearch(query: string): Promise<OpenGoogleSearchResponse> {
    return (await chrome.runtime.sendMessage({
      type: "OPEN_GOOGLE_RESULT_SEARCH",
      query,
    } satisfies Extract<BackgroundRuntimeRequest, { type: "OPEN_GOOGLE_RESULT_SEARCH" }>)) as OpenGoogleSearchResponse;
  }

  async function runLookupRequest(query: string, options: LookupRunOptions = {}): Promise<RunLookupQueryResponse> {
    return (await chrome.runtime.sendMessage({
      type: "RUN_LOOKUP_QUERY",
      query,
      widerSearch: Boolean(options.widerSearch),
    } satisfies Extract<BackgroundRuntimeRequest, { type: "RUN_LOOKUP_QUERY" }>)) as RunLookupQueryResponse;
  }

  async function resolveAmbiguityRequest(
    requestId: string,
    selectedCandidateId: string,
    originalQuery: string,
  ): Promise<ResolveAmbiguityResponse> {
    return (await chrome.runtime.sendMessage({
      type: "RESOLVE_AMBIGUITY",
      requestId,
      selectedCandidateId,
      originalQuery,
    } satisfies Extract<BackgroundRuntimeRequest, { type: "RESOLVE_AMBIGUITY" }>)) as ResolveAmbiguityResponse;
  }

  async function requestAlternativesForResult(result: LookupResult): Promise<ResolveAmbiguityResponse> {
    const query = String(result.lookupQuery || result.title || "").trim();
    return (await chrome.runtime.sendMessage({
      type: "REQUEST_ALTERNATIVES",
      requestId: result.reselectRequestId,
      query,
    } satisfies Extract<BackgroundRuntimeRequest, { type: "REQUEST_ALTERNATIVES" }>)) as ResolveAmbiguityResponse;
  }

  function buildCompactShell(title = "Synopsis") {
    const card = document.createElement("section");
    card.id = CARD_ID;
    card.className = "vs-card vs-card--compact";
    card.tabIndex = -1;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", title);

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
    close.addEventListener("click", () => closeCard());

    header.append(h, close);
    card.appendChild(header);

    return card;
  }

  function buildPanelShell() {
    const card = document.createElement("section");
    card.id = CARD_ID;
    card.className = "vs-card vs-card--panel";
    card.tabIndex = -1;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Synopsis result");
    return card;
  }

  function metadataLine(result: LookupDisplayResult) {
    const line = document.createElement("p");
    line.className = "vs-meta-line";

    const parts: string[] = [];
    if (result.year) parts.push(String(result.year));
    if (result.directorOrCreator) parts.push(`Dir. ${result.directorOrCreator}`);
    else if (result.author) parts.push(result.author);

    line.textContent = parts.join(" · ");
    return line;
  }

  function buildGoogleSearchQuery(result: LookupDisplayResult) {
    const title = String(result?.title || "").trim();
    const year = String(result?.year || "").trim();
    return [title, year].filter(Boolean).join(" ");
  }

  function createSvgIcon(viewBox: string, pathD: string, className: string) {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", viewBox);
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    icon.classList.add(className);

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathD);
    path.setAttribute("fill", "currentColor");

    icon.appendChild(path);
    return icon;
  }

  function createExternalLinkIcon() {
    return createSvgIcon(
      "0 0 16 16",
      "M9.5 2h4v4h-1.5V4.56L7.28 9.28 6.22 8.22 10.94 3.5H9.5V2ZM3.5 4.5h4V6h-4A.5.5 0 0 0 3 6.5v6a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5v-4h1.5v4A2 2 0 0 1 9.5 14h-6A2 2 0 0 1 1.5 12.5v-6A2 2 0 0 1 3.5 4.5Z",
      "vs-chip-icon",
    );
  }

  function createActionChip(label: string, onClick: () => void | Promise<void>, options: ActionButtonOptions = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vs-chip vs-chip--action";
    button.setAttribute("aria-label", options.ariaLabel || label);

    const text = document.createElement("span");
    text.textContent = label;
    button.appendChild(text);

    if (options.withExternalIcon) {
      button.appendChild(createExternalLinkIcon());
    }

    button.addEventListener("click", () => {
      void onClick();
    });
    return button;
  }

  function createHeaderIconButton(
    ariaLabel: string,
    iconViewBox: string,
    iconPathD: string,
    onClick: () => void | Promise<void>,
    extraClass?: string,
  ) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vs-header-action${extraClass ? ` ${extraClass}` : ""}`;
    button.setAttribute("aria-label", ariaLabel);

    button.appendChild(createSvgIcon(iconViewBox, iconPathD, "vs-header-action-icon"));

    button.addEventListener("click", () => {
      void onClick();
    });
    return button;
  }

  function createGoogleSearchButton(result: LookupDisplayResult) {
    return createHeaderIconButton(
      `Search Google for ${buildGoogleSearchQuery(result) || "this title"}`,
      "0 0 16 16",
      "M9.5 2h4v4h-1.5V4.56L7.28 9.28 6.22 8.22 10.94 3.5H9.5V2ZM3.5 4.5h4V6h-4A.5.5 0 0 0 3 6.5v6a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5v-4h1.5v4A2 2 0 0 1 9.5 14h-6A2 2 0 0 1 1.5 12.5v-6A2 2 0 0 1 3.5 4.5Z",
      async () => {
        const query = buildGoogleSearchQuery(result);
        const response = await openGoogleSearch(query);
        if (response?.status !== "ok") {
          showError(response?.message || "Could not open Google search.");
        }
      },
      "vs-header-action--google",
    );
  }

  function createWrongMatchButton(result: LookupDisplayResult) {
    // Refresh/swap icon (two arrows forming a cycle)
    return createHeaderIconButton(
      "Wrong match? See alternatives",
      "0 0 16 16",
      "M13.65 2.35a1 1 0 0 0-1.3 0L10 4.71V3a1 1 0 0 0-2 0v4a1 1 0 0 0 1 1h4a1 1 0 0 0 0-2h-1.71l2.36-2.35a1 1 0 0 0 0-1.3ZM2.35 13.65a1 1 0 0 0 1.3 0L6 11.29V13a1 1 0 0 0 2 0V9a1 1 0 0 0-1-1H3a1 1 0 0 0 0 2h1.71l-2.36 2.35a1 1 0 0 0 0 1.3Z",
      () => {
        showAlternativeMatches(result).catch((error) => {
          cLog("wrongMatch:error", { message: error?.message || String(error) });
          showError("Could not load alternative matches.");
        });
      },
      "vs-header-action--reselect",
    );
  }

  function createGoogleSearchChip(result: LookupDisplayResult) {
    return createActionChip(
      "Google",
      async () => {
        const query = buildGoogleSearchQuery(result);
        const response = await openGoogleSearch(query);

        if (response?.status !== "ok") {
          showError(response?.message || "Could not open Google search.");
        }
      },
      {
        ariaLabel: `Search Google for ${buildGoogleSearchQuery(result) || "this title"}`,
        withExternalIcon: true,
      },
    );
  }

  function buildNoArtTitle(title: string | undefined) {
    return (title || "UNKNOWN TITLE")
      .replace(/\(\d{4}\)/g, "")
      .trim()
      .toUpperCase();
  }

  function renderPlaceholderPane(result: LookupDisplayResult) {
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

  function renderPanelArtwork(container: HTMLElement, result: LookupDisplayResult) {
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
      const card = image.closest(`#${CARD_ID}`) as ContentCardElement | null;
      if (!card) return;
      const anchor = readCardAnchor(card);
      applyHybridPanelHeight(card);
      positionCard(card, anchor || undefined);
    });
    image.addEventListener("error", () => {
      container.textContent = "";
      container.appendChild(renderPlaceholderPane(result));
      const card = container.closest(`#${CARD_ID}`) as ContentCardElement | null;
      if (!card) return;
      const anchor = readCardAnchor(card);
      applyHybridPanelHeight(card);
      positionCard(card, anchor || undefined);
    });

    container.appendChild(image);
  }

  function showLoading(query: string) {
    const card = buildCompactShell("Getting Synopsis");

    const sub = document.createElement("p");
    sub.className = "vs-sub";
    sub.textContent = query ? `Searching for: ${query}` : "Searching title";

    const shimmer = document.createElement("div");
    shimmer.className = "vs-shimmer";

    card.append(sub, shimmer);
    mountAnchoredCard(card);
  }

  function showCompactResult(result: LookupDisplayResult) {
    const card = buildCompactShell(result.title || "Synopsis");

    const meta = metadataLine(result);

    const synopsis = document.createElement("p");
    synopsis.className = "vs-synopsis";
    synopsis.textContent = result.synopsis || "";

    const foot = document.createElement("p");
    foot.className = "vs-foot";
    foot.textContent = `Sources: ${result.sourceAttribution}${result.fromCache ? " (cached)" : ""}`;

    card.append(meta, synopsis, foot);
    mountAnchoredCard(card);
  }

  function installSearchKeyboardIsolation(card: ContentCardElement) {
    const captureTypes: Array<"keydown" | "keypress" | "keyup"> = ["keydown", "keypress", "keyup"];

    const stopSearchKeyPropagation = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !card.contains(event.target)) return;
      if (!shouldCaptureSearchOverlayKey(event)) return;
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    captureTypes.forEach((eventName) => {
      window.addEventListener(eventName, stopSearchKeyPropagation, true);
      document.addEventListener(eventName, stopSearchKeyPropagation, true);
    });

    mergeCardCleanup(card, () => {
      captureTypes.forEach((eventName) => {
        window.removeEventListener(eventName, stopSearchKeyPropagation, true);
        document.removeEventListener(eventName, stopSearchKeyPropagation, true);
      });
    });
  }

  async function showSearchInput(): Promise<SearchOverlayAck> {
    const existing = getExistingSearchCard();
    if (existing) {
      positionSearchOverlay(existing);
      const focused = await settleFocus(getSearchInput(existing));
      return {
        ok: focused,
        opened: true,
        focused,
      };
    }

    const card = document.createElement("section");
    card.id = CARD_ID;
    card.className = "vs-card vs-card--search vs-card--search-overlay";
    card.tabIndex = -1;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Manual synopsis search");
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
    input.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      void settleFocus(input);
    });
    input.addEventListener("click", (event) => {
      event.stopPropagation();
      void settleFocus(input);
    });
    form.append(input);
    card.append(form);
    installSearchKeyboardIsolation(card);

    const refocusSearchInput = (event: Event) => {
      if (!(event.target instanceof Node) || !card.contains(event.target)) return;
      event.stopPropagation();
      if (event.target !== input) {
        event.preventDefault();
      }
      void settleFocus(input);
    };
    card.addEventListener("pointerdown", refocusSearchInput, true);
    card.addEventListener("mousedown", refocusSearchInput, true);
    card.addEventListener("click", refocusSearchInput, true);

    const closeIfOutside = (event: MouseEvent) => {
      if (Date.now() - openedAt < 280) return;
      if (!(event.target instanceof Node) || !card.contains(event.target)) {
        closeCard();
      }
    };

    const cleanup = () => {
      document.removeEventListener("mousedown", closeIfOutside, true);
      card.removeEventListener("pointerdown", refocusSearchInput, true);
      card.removeEventListener("mousedown", refocusSearchInput, true);
      card.removeEventListener("click", refocusSearchInput, true);
    };
    mergeCardCleanup(card, cleanup);

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

      await runLookupQuery(query);
    });

    const mounted = await mountSearchOverlay(card);
    return {
      ok: mounted.opened && mounted.focused,
      opened: mounted.opened,
      focused: mounted.focused,
    };
  }

  async function runLookupQuery(query: string, options: LookupRunOptions = {}) {
    cLog("lookup:submit", { query, widerSearch: Boolean(options.widerSearch) });
    showLoading(query);

    const response = await runLookupRequest(query, options);
    cLog("lookup:submit:response", response);

    if (response?.status === "error") {
      showError(response.message || "Lookup failed.", {
        errorCode: response.errorCode,
        lookupQuery: query,
        allowWideSearch: Boolean(response.allowWideSearch ?? options.widerSearch),
      });
    }
  }

  function createAutoResolvedNote() {
    const note = document.createElement("p");
    note.className = "vs-auto-note";
    note.textContent = "Resolved automatically";
    setTimeout(() => note.remove(), 2400);
    return note;
  }

  function genreSourceTooltip(genreSource: string) {
    if (genreSource === "ai") return "Genre source: AI prediction";
    if (genreSource === "provider") return "Genre source: Provider metadata";
    return "Genre source: Unknown";
  }

  function createGenreOriginBadge(genreSource: string) {
    const wrap = document.createElement("span");
    wrap.className = "vs-genre-origin-wrap";

    const badge = document.createElement("button");
    badge.className = "vs-genre-origin";
    badge.type = "button";
    badge.setAttribute("aria-label", genreSourceTooltip(genreSource));
    badge.textContent = "i";

    const tooltip = document.createElement("span");
    tooltip.className = "vs-genre-origin-tooltip";
    tooltip.textContent = genreSourceTooltip(genreSource);

    wrap.append(badge, tooltip);
    return wrap;
  }

  function buildErrorActions(errorCode: string | undefined, options: ErrorDisplayOptions = {}): ErrorAction[] {
    const lookupQuery = String(options.lookupQuery || "").trim();
    const actions: ErrorAction[] = [
      {
        label: "Search manually",
        run: () => void showSearchInput(),
      },
    ];

    if (errorCode === "LOCAL_ONLY_MISS" || errorCode === "TMDB_KEY_MISSING") {
      actions.push({
        label: "Open Settings",
        run: () => chrome.runtime.openOptionsPage(),
        secondary: true,
      });
    }

    if (options.allowWideSearch && lookupQuery) {
      actions.unshift({
        label: "Wider Search",
        run: () => {
          runLookupQuery(lookupQuery, { widerSearch: true }).catch((error) => {
            cLog("widerSearch:error", { message: error?.message || String(error) });
            showError("Could not run wider search.", { errorCode: "WIDER_SEARCH_FAILED", lookupQuery });
          });
        },
      });
    }

    return actions;
  }

  async function showAlternativeMatches(result: LookupDisplayResult) {
    const query = String(result.lookupQuery || result.title || "").trim();
    showLoading(query || "Finding alternatives");

    const response = await requestAlternativesForResult(result);

    if (response?.status === "ambiguous" && response.requestId) {
      showAmbiguous({
        requestId: response.requestId,
        candidates: response.candidates || [],
        originalQuery: query || result.title || "your selection",
        note: response.note,
      });
      return;
    }

    showError(response?.message || "Could not load alternative matches.", { errorCode: response?.errorCode });
  }

  function showPanelResult(result: LookupDisplayResult, options: ResultDisplayOptions = {}) {
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

    const headerActions = document.createElement("div");
    headerActions.className = "vs-header-actions";

    headerActions.appendChild(createGoogleSearchButton(result));

    const canShowWrongMatch =
      options.autoResolved &&
      (result.canChooseAnother !== false || Boolean(result.reselectRequestId) || Boolean(result.lookupQuery));

    if (canShowWrongMatch) {
      headerActions.appendChild(createWrongMatchButton(result));
    }

    const close = document.createElement("button");
    close.className = "vs-close";
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close synopsis card");
    close.addEventListener("click", () => closeCard());

    headerActions.appendChild(close);
    header.append(title, headerActions);

    const meta = metadataLine(result);

    const autoNote = options.autoResolved ? createAutoResolvedNote() : null;

    const synopsis = document.createElement("p");
    synopsis.className = "vs-synopsis";
    synopsis.textContent = result.synopsis || "";

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

    left.append(header, meta);
    if (autoNote) left.appendChild(autoNote);
    left.append(synopsis, footerRow);
    renderPanelArtwork(right, result);

    card.append(left, right);
    mountAnchoredCard(card);
  }

  function showResult(result: LookupDisplayResult, options: ResultDisplayOptions = {}) {
    if (result.resultUiMode === "without_image" || result.resultUiMode === "compact") {
      showCompactResult(result);
      return;
    }
    showPanelResult(result, options);
  }

  function candidateLabel(candidate: Candidate) {
    const parts = [candidate.title, candidate.mediaType.toUpperCase()];
    if (candidate.year) parts.push(String(candidate.year));
    if (candidate.authorOrDirector) parts.push(candidate.authorOrDirector);
    return parts.join(" • ");
  }

  function buildCandidateButtonContent(button: HTMLButtonElement, candidate: Candidate, rank: number) {
    const label = document.createElement("span");
    label.className = "vs-candidate-text";
    label.textContent = candidateLabel(candidate);

    const rankLabel = document.createElement("span");
    rankLabel.className = "vs-candidate-rank";
    rankLabel.textContent = `#${rank}`;
    rankLabel.setAttribute("aria-hidden", "true");

    button.append(label, rankLabel);
    button.setAttribute("aria-label", `${label.textContent}. Match ${rank} in this section.`);
  }

  function appendCandidateButtons({ requestId, originalQuery, container, items }: CandidateButtonGroup) {
    items.forEach((candidate: Candidate, index: number) => {
      const button = document.createElement("button");
      button.className = "vs-candidate";
      button.type = "button";
      buildCandidateButtonContent(button, candidate, index + 1);
      button.addEventListener("click", async () => {
        showLoading(candidate.title);

        const response = await resolveAmbiguityRequest(requestId, candidate.id, originalQuery);

        if (response?.status === "ok" && response.result) {
          showResult(response.result, { autoResolved: false });
        } else {
          showError(response?.message || "Could not resolve your selection.", { errorCode: response?.errorCode });
        }
      });
      container.appendChild(button);
    });
  }

  function showAmbiguous({ requestId, candidates, originalQuery, note }: AmbiguousPayload) {
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
    mountAnchoredCard(card);
  }

  function showError(message: string, options: ErrorDisplayOptions = {}) {
    const card = buildCompactShell("Synopsis Unavailable");
    const actions = buildErrorActions(options.errorCode, options);

    const body = document.createElement("p");
    body.className = "vs-error";
    body.textContent = message || "Something went wrong. Try again.";

    card.appendChild(body);
    if (actions.length) {
      const row = document.createElement("div");
      row.className = "vs-actions";

      actions.forEach((action) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `vs-button${action.secondary ? " vs-button--ghost" : ""}`;
        button.textContent = action.label;
        button.addEventListener("click", action.run);
        row.appendChild(button);
      });

      card.appendChild(row);
    }

    mountAnchoredCard(card);
  }

  const handleRuntimeMessage = (
    message: ContentUiMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: ContentScriptAckResponse) => void,
  ) => {
    if (!message?.type) return;
    cLog("runtime:onMessage", { type: message.type });

    if (message.type === "VS_PING") {
      if (typeof sendResponse === "function") {
        sendResponse({ ok: true, uiFlagVersion: synopsisUiFlagVersion });
      }
      return true;
    }

    if (message.type === "SHOW_SEARCH_INPUT") {
      void showSearchInput()
        .then((ack) => {
          if (typeof sendResponse === "function") {
            sendResponse(ack);
          }
        })
        .catch(() => {
          if (typeof sendResponse === "function") {
            sendResponse({ ok: false, opened: false, focused: false });
          }
        });
      return true;
    }

    if (message.type === "SHOW_LOADING") {
      beginLookup(message.requestId);
      showLoading(message.query);
      return;
    }

    if (message.type === "SHOW_RESULT") {
      if (shouldIgnoreLookupMessage(message.requestId)) return;
      showResult(message.result, { autoResolved: message.autoResolved !== false });
      return;
    }

    if (message.type === "SHOW_AMBIGUOUS") {
      if (shouldIgnoreLookupMessage(message.requestId)) return;
      showAmbiguous({
        requestId: String(message.ambiguityRequestId || message.requestId || ""),
        candidates: Array.isArray(message.candidates) ? (message.candidates as Candidate[]) : [],
        originalQuery: String(message.originalQuery || ""),
        note: typeof message.note === "string" ? message.note : undefined,
      });
      return;
    }

    if (message.type === "SHOW_ERROR") {
      if (shouldIgnoreLookupMessage(message.requestId)) return;
      showError(message.message, {
        errorCode: message.errorCode,
        lookupQuery: message.lookupQuery,
        allowWideSearch: message.allowWideSearch,
      });
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
    closeCard({ restoreFocus: false });
    const root = document.getElementById(ROOT_ID);
    if (root) root.remove();
  });

  windowWithCleanup.__VIVALDI_SYNOPSIS_CLEANUP__ = () => {
    cLog("script:cleanup");
    while (cleanupHandlers.length) {
      const fn = cleanupHandlers.pop();
      if (!fn) continue;
      try {
        fn();
      } catch (_error) {
        // Ignore cleanup errors during reinjection.
      }
    }
  };
}
