import { DEFAULT_SETTINGS, getSynopsisPopupUiFlagVersion } from "../config/constants";
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
type ActionButtonOptions = {
  ariaLabel?: string;
  withExternalIcon?: boolean;
  secondary?: boolean;
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
type EditorialChoiceGroup = {
  requestId: string;
  originalQuery: string;
  parent: HTMLElement;
  label: string;
  items: Candidate[];
};
type CandidateButtonGroup = {
  requestId: string;
  originalQuery: string;
  container: HTMLElement;
  items: Candidate[];
};
type EditorialShellOptions = {
  kind: string;
  title: string;
  subtitle?: string | null;
  ariaLabel?: string;
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
  const BRAND_ICON_URL = chrome?.runtime?.getURL ? chrome.runtime.getURL("icon-48.png") : "";
  const FOCUSABLE_SELECTOR =
    ".vs-search-input, .vs-candidate, .vs-chip--action, .vs-genre-origin, .vs-close, .vs-button, .vs-editorial-search-input, .vs-editorial-choice, .vs-editorial-close, .vs-editorial-button";
  let searchShortcutKey = "\\";
  let editorialSynopsisPopupEnabled = DEFAULT_SETTINGS.editorialSynopsisPopupEnabled;
  let synopsisUiFlagVersion = getSynopsisPopupUiFlagVersion(editorialSynopsisPopupEnabled);
  let lastContextMenuPos: CardAnchor | null = null;
  let restoreFocusTarget: HTMLElement | null = null;

  function applyExtensionSettings(rawSettings: Partial<ExtensionSettings> | undefined) {
    const settings = {
      ...DEFAULT_SETTINGS,
      ...(rawSettings || {}),
    };

    const shortcutKey = String(settings.searchShortcutKey || "\\").trim();
    searchShortcutKey = shortcutKey || "\\";
    editorialSynopsisPopupEnabled = settings.editorialSynopsisPopupEnabled !== false;
    synopsisUiFlagVersion = getSynopsisPopupUiFlagVersion(editorialSynopsisPopupEnabled);
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
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

  function focusCard(card: HTMLElement) {
    const target = card.querySelector(FOCUSABLE_SELECTOR);
    if (target instanceof HTMLElement) {
      target.focus({ preventScroll: true });
      return;
    }

    if (card instanceof HTMLElement) {
      card.focus({ preventScroll: true });
    }
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

  function mountCard(card: ContentCardElement, options: CardMountOptions = {}) {
    const root = createRoot();
    const existing = document.getElementById(CARD_ID) as ContentCardElement | null;
    const existingAnchor = readCardAnchor(existing);
    rememberFocusTarget(existing);
    closeCard({ restoreFocus: false });

    card.style.visibility = "hidden";
    card.style.top = `${window.scrollY}px`;
    card.style.left = `${window.scrollX}px`;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      closeCard();
    };
    document.addEventListener("keydown", handleEscape, true);
    mergeCardCleanup(card, () => document.removeEventListener("keydown", handleEscape, true));

    root.appendChild(card);
    applyHybridPanelHeight(card);
    positionCard(card, options.anchorPos || existingAnchor || undefined);
    setTimeout(() => focusCard(card), 0);
  }

  const handleContextMenu = (event: MouseEvent) => {
    lastContextMenuPos = {
      top: window.scrollY + event.clientY + 8,
      left: window.scrollX + event.clientX + 6,
    };
    cLog("contextmenu:capture", lastContextMenuPos);
  };
  document.addEventListener("contextmenu", handleContextMenu, true);
  registerCleanup(() => document.removeEventListener("contextmenu", handleContextMenu, true));

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
      if (areaName !== "local" || !settingsChange?.newValue) return;
      applyExtensionSettings(settingsChange.newValue as Partial<ExtensionSettings> | undefined);
    };
    chrome.storage.onChanged.addListener(handleStorageChange);
    registerCleanup(() => chrome.storage.onChanged.removeListener(handleStorageChange));
  }

  const handleSlashShortcut = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (isEditableTarget(event.target)) return;

    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const isBackslash =
      searchShortcutKey === "\\" &&
      (event.key === "\\" || event.key === "Backslash" || event.code === "Backslash" || event.code === "IntlBackslash");
    const isConfiguredKey = searchShortcutKey !== "\\" && event.key === searchShortcutKey;
    if (!isBackslash && !isConfiguredKey) return;

    event.preventDefault();
    cLog("shortcut:manualSearch:open", { shortcutKey: searchShortcutKey });
    showSearchInput();
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

  function metadataRow(result: LookupDisplayResult) {
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

    row.appendChild(createGoogleSearchChip(result));

    return row;
  }

  function buildGoogleSearchQuery(result: LookupDisplayResult) {
    const title = String(result?.title || "").trim();
    const year = String(result?.year || "").trim();
    return [title, year].filter(Boolean).join(" ");
  }

  function createExternalLinkIcon() {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    icon.classList.add("vs-chip-icon");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M9.5 2h4v4h-1.5V4.56L7.28 9.28 6.22 8.22 10.94 3.5H9.5V2ZM3.5 4.5h4V6h-4A.5.5 0 0 0 3 6.5v6a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5v-4h1.5v4A2 2 0 0 1 9.5 14h-6A2 2 0 0 1 1.5 12.5v-6A2 2 0 0 1 3.5 4.5Z",
    );
    path.setAttribute("fill", "currentColor");

    icon.appendChild(path);
    return icon;
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

  function mediaTypeDisplayLabel(mediaType: string | undefined) {
    if (mediaType === "movie") return "Movie";
    if (mediaType === "tv") return "TV";
    if (mediaType === "book") return "Book";
    return "Media";
  }

  function createEditorialCloseButton() {
    const close = document.createElement("button");
    close.className = "vs-editorial-close";
    close.type = "button";
    close.textContent = "Close";
    close.setAttribute("aria-label", "Close synopsis card");
    close.addEventListener("click", () => closeCard());
    return close;
  }

  function createEditorialBrand(title: string) {
    const wrap = document.createElement("div");
    wrap.className = "vs-editorial-brand";

    if (BRAND_ICON_URL) {
      const mark = document.createElement("img");
      mark.className = "vs-editorial-brand-mark";
      mark.src = BRAND_ICON_URL;
      mark.alt = "";
      wrap.appendChild(mark);
    }

    const copy = document.createElement("div");
    copy.className = "vs-editorial-brand-copy";

    const name = document.createElement("p");
    name.className = "vs-editorial-brand-name";
    name.textContent = "Vivaldi Synopsis";

    const heading = document.createElement("h2");
    heading.className = "vs-editorial-title";
    heading.textContent = title;

    copy.append(name, heading);
    wrap.appendChild(copy);
    return wrap;
  }

  function buildEditorialShell({ kind, title, subtitle, ariaLabel }: EditorialShellOptions) {
    const card = document.createElement("section");
    card.id = CARD_ID;
    card.className = `vs-card vs-card--editorial vs-card--editorial-${kind}`;
    card.tabIndex = -1;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", ariaLabel || title);

    const masthead = document.createElement("header");
    masthead.className = "vs-editorial-masthead";
    masthead.append(createEditorialBrand(title), createEditorialCloseButton());
    card.appendChild(masthead);

    if (subtitle) {
      const sub = document.createElement("p");
      sub.className = "vs-editorial-sub";
      sub.textContent = subtitle;
      card.appendChild(sub);
    }

    return card;
  }

  function createEditorialSectionTitle(text: string) {
    const label = document.createElement("p");
    label.className = "vs-editorial-section-title";
    label.textContent = text;
    return label;
  }

  function createEditorialNote(text: string) {
    const note = document.createElement("p");
    note.className = "vs-editorial-note";
    note.textContent = text;
    return note;
  }

  function createEditorialStatus(message: string, tone = "info") {
    const status = document.createElement("p");
    status.className = `vs-editorial-status vs-editorial-status--${tone}`;
    status.textContent = message;
    return status;
  }

  function createEditorialActionButton(label: string, onClick: () => void | Promise<void>, options: ActionButtonOptions = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vs-editorial-button${options.secondary ? " vs-editorial-button--ghost" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      void onClick();
    });

    if (options.withExternalIcon) {
      button.appendChild(createExternalLinkIcon());
      button.classList.add("vs-editorial-button--external");
    }

    return button;
  }

  function appendEditorialFact(container: HTMLElement, labelText: string, valueText: string) {
    if (!valueText) return;

    const row = document.createElement("div");
    row.className = "vs-editorial-fact";

    const label = document.createElement("p");
    label.className = "vs-editorial-fact-label";
    label.textContent = labelText;

    const value = document.createElement("p");
    value.className = "vs-editorial-fact-value";
    value.textContent = valueText;

    row.append(label, value);
    container.appendChild(row);
  }

  function buildEditorialFacts(result: LookupDisplayResult) {
    const facts = document.createElement("div");
    facts.className = "vs-editorial-facts";

    appendEditorialFact(facts, "Type", mediaTypeDisplayLabel(result.mediaType));
    appendEditorialFact(facts, "Year", result.year ? String(result.year) : "");
    appendEditorialFact(facts, "Creator", result.author || result.directorOrCreator || "");
    appendEditorialFact(facts, "Cast", Array.isArray(result.cast) && result.cast.length ? result.cast.slice(0, 3).join(", ") : "");
    appendEditorialFact(facts, "Genre", result.genreLabel || "Unknown");
    appendEditorialFact(facts, "Sources", `${result.sourceAttribution || "Unknown"}${result.fromCache ? " (cached)" : ""}`);

    return facts;
  }

  function buildEditorialPanelMeta(result: LookupDisplayResult) {
    const meta = document.createElement("div");
    meta.className = "vs-editorial-panel-meta";

    const items = [
      ["Type", mediaTypeDisplayLabel(result.mediaType)],
      ["Year", result.year ? String(result.year) : "Unknown"],
      ["Genre", result.genreLabel || "Unknown"],
      ["Source", `${result.sourceAttribution || "Unknown"}${result.fromCache ? " (cached)" : ""}`],
    ];

    items.forEach(([labelText, valueText]) => {
      const item = document.createElement("div");
      item.className = "vs-editorial-panel-stat";

      const label = document.createElement("p");
      label.className = "vs-editorial-panel-stat-label";
      label.textContent = labelText;

      const value = document.createElement("p");
      value.className = "vs-editorial-panel-stat-value";
      value.textContent = valueText;

      item.append(label, value);
      meta.appendChild(item);
    });

    return meta;
  }

  function buildEditorialPanelSupport(result: LookupDisplayResult, options: ResultDisplayOptions = {}) {
    const lines: string[] = [];

    if (options.autoResolved) {
      lines.push("Resolved automatically from the current selection.");
    }

    const creator = result.author || result.directorOrCreator;
    if (creator) {
      lines.push(`Creator: ${creator}`);
    }

    if (Array.isArray(result.cast) && result.cast.length) {
      lines.push(`Cast: ${result.cast.slice(0, 3).join(", ")}`);
    }

    if (!lines.length) return null;

    const support = document.createElement("p");
    support.className = "vs-editorial-panel-support";
    support.textContent = lines.join("  •  ");
    return support;
  }

  function buildEditorialPlaceholderPane(result: LookupDisplayResult) {
    const wrapper = document.createElement("div");
    wrapper.className = "vs-editorial-artwork-placeholder";

    const title = document.createElement("p");
    title.className = "vs-editorial-artwork-title";
    title.textContent = buildNoArtTitle(result.title);

    const divider = document.createElement("div");
    divider.className = "vs-editorial-artwork-divider";

    const year = document.createElement("p");
    year.className = "vs-editorial-artwork-year";
    year.textContent = result.year ? String(result.year) : mediaTypeDisplayLabel(result.mediaType);

    wrapper.append(title, divider, year);
    return wrapper;
  }

  function buildEditorialArtworkPane(result: LookupDisplayResult) {
    const frame = document.createElement("section");
    frame.className = "vs-editorial-artwork";

    if (!result.artworkUrl) {
      frame.appendChild(buildEditorialPlaceholderPane(result));
      return frame;
    }

    const image = document.createElement("img");
    image.className = "vs-editorial-artwork-image";
    image.alt = `${result.title || "Artwork"} artwork`;
    image.src = result.artworkUrl;
    image.addEventListener("error", () => {
      frame.textContent = "";
      frame.appendChild(buildEditorialPlaceholderPane(result));
    });

    frame.appendChild(image);
    return frame;
  }

  function buildEditorialActionRow(result: LookupDisplayResult, options: ResultDisplayOptions = {}) {
    const row = document.createElement("div");
    row.className = "vs-editorial-actions";

    const canChooseAnother =
      options.autoResolved &&
      (result.canChooseAnother !== false || Boolean(result.reselectRequestId) || Boolean(result.lookupQuery));

    if (canChooseAnother) {
      row.appendChild(
        createEditorialActionButton("Wrong Match?", () => {
          showAlternativeMatches(result).catch((error) => {
            cLog("wrongMatch:error", { message: error?.message || String(error) });
            showError("Could not load alternative matches.");
          });
        }),
      );
    }

    row.appendChild(
      createEditorialActionButton(
        "Google",
        async () => {
          const query = buildGoogleSearchQuery(result);
          const response = await openGoogleSearch(query);

          if (response?.status !== "ok") {
            showError(response?.message || "Could not open Google search.");
          }
        },
        { secondary: true, withExternalIcon: true },
      ),
    );

    return row;
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

  function showEditorialLoading(query: string) {
    const card = buildEditorialShell({
      kind: "loading",
      title: "Getting synopsis",
      subtitle: query ? `Working on "${query}" now.` : "Working on your title now.",
      ariaLabel: "Getting synopsis",
    });

    card.appendChild(createEditorialSectionTitle("Status"));
    card.appendChild(createEditorialStatus("Searching providers and assembling a spoiler-safe summary.", "info"));

    const shimmer = document.createElement("div");
    shimmer.className = "vs-editorial-loading";
    shimmer.innerHTML = '<span></span><span></span><span></span>';

    card.appendChild(shimmer);
    mountCard(card);
  }

  function showEditorialCompactResult(result: LookupDisplayResult) {
    const card = buildEditorialShell({
      kind: "compact-result",
      title: result.title || "Synopsis",
      subtitle: `${mediaTypeDisplayLabel(result.mediaType)}${result.year ? ` • ${result.year}` : ""}`,
      ariaLabel: result.title || "Synopsis",
    });

    const section = document.createElement("section");
    section.className = "vs-editorial-section";
    section.appendChild(createEditorialSectionTitle("Synopsis"));

    const synopsis = document.createElement("p");
    synopsis.className = "vs-editorial-copy";
    synopsis.textContent = result.synopsis || "";
    section.appendChild(synopsis);

    card.appendChild(section);

    const notes = document.createElement("section");
    notes.className = "vs-editorial-section";
    notes.appendChild(createEditorialSectionTitle("Lookup notes"));
    notes.appendChild(buildEditorialFacts(result));
    card.appendChild(notes);

    card.appendChild(buildEditorialActionRow(result));
    mountCard(card);
  }

  function showEditorialSearchInput() {
    cLog("showEditorialSearchInput:start", { anchor: lastContextMenuPos });
    const card = buildEditorialShell({
      kind: "search",
      title: "Search this page",
      subtitle: "Type a book, movie, or TV title and I will try the exact same lookup flow from here.",
      ariaLabel: "Manual synopsis search",
    });
    const openedAt = Date.now();

    const form = document.createElement("form");
    form.className = "vs-editorial-search-form";

    const title = createEditorialSectionTitle("Title");
    form.appendChild(title);

    const row = document.createElement("div");
    row.className = "vs-editorial-search-row";

    const input = document.createElement("input");
    input.className = "vs-editorial-search-input";
    input.type = "text";
    input.placeholder = "Search book, movie, or TV title...";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Search title");

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "vs-editorial-button";
    submit.textContent = "Search";

    row.append(input, submit);
    form.appendChild(row);
    form.appendChild(createEditorialNote("Use the title as it appears on the page for the best match."));

    const closeIfOutside = (event: MouseEvent) => {
      if (Date.now() - openedAt < 280) return;
      if (!(event.target instanceof Node) || !card.contains(event.target)) {
        cLog("showEditorialSearchInput:close:outsideClick");
        closeCard();
      }
    };

    const cleanup = () => {
      document.removeEventListener("mousedown", closeIfOutside, true);
    };
    mergeCardCleanup(card, cleanup);

    setTimeout(() => {
      document.addEventListener("mousedown", closeIfOutside, true);
    }, 0);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      await runLookupQuery(query);
    });

    card.appendChild(form);

    const fallbackPos = {
      left: window.scrollX + Math.max(20, (window.innerWidth - 480) / 2),
      top: window.scrollY + 64,
    };
    mountCard(card, { anchorPos: lastContextMenuPos || fallbackPos });
  }

  function showEditorialPanelResult(result: LookupDisplayResult, options: ResultDisplayOptions = {}) {
    const card = buildEditorialShell({
      kind: "panel",
      title: result.title || "Synopsis",
      subtitle: null,
      ariaLabel: result.title || "Synopsis result",
    });

    const layout = document.createElement("div");
    layout.className = "vs-editorial-grid";

    const main = document.createElement("section");
    main.className = "vs-editorial-main";
    main.appendChild(buildEditorialPanelMeta(result));

    const support = buildEditorialPanelSupport(result, options);
    if (support) {
      main.appendChild(support);
    }

    const synopsis = document.createElement("p");
    synopsis.className = "vs-editorial-copy";
    synopsis.textContent = result.synopsis || "";
    main.appendChild(synopsis);

    main.appendChild(buildEditorialActionRow(result, options));

    const aside = document.createElement("aside");
    aside.className = "vs-editorial-aside";
    aside.appendChild(buildEditorialArtworkPane(result));

    layout.append(main, aside);
    card.appendChild(layout);
    mountCard(card);
  }

  function appendEditorialCandidateButtons({ requestId, originalQuery, container, items }: CandidateButtonGroup) {
    items.forEach((candidate: Candidate, index: number) => {
      const button = document.createElement("button");
      button.className = "vs-editorial-choice";
      button.type = "button";

      const text = document.createElement("span");
      text.className = "vs-editorial-choice-text";
      text.textContent = candidateLabel(candidate);

      const rank = document.createElement("span");
      rank.className = "vs-editorial-choice-rank";
      rank.textContent = `#${index + 1}`;
      rank.setAttribute("aria-hidden", "true");

      button.append(text, rank);
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

  function appendEditorialCandidateGroup({ requestId, originalQuery, parent, label, items }: EditorialChoiceGroup) {
    if (!items.length) return;

    const group = document.createElement("section");
    group.className = "vs-editorial-section vs-editorial-section--group";

    if (label) {
      group.appendChild(createEditorialSectionTitle(label));
    }

    const list = document.createElement("div");
    list.className = "vs-editorial-choice-list";
    appendEditorialCandidateButtons({ requestId, originalQuery, container: list, items });
    group.appendChild(list);
    parent.appendChild(group);
  }

  function showEditorialAmbiguous({ requestId, candidates, originalQuery, note }: AmbiguousPayload) {
    const card = buildEditorialShell({
      kind: "ambiguous",
      title: "Pick the right title",
      subtitle: `Multiple matches turned up for "${originalQuery}".`,
      ariaLabel: "Pick the right title",
    });

    if (note) {
      card.appendChild(createEditorialStatus(note, "warning"));
    }

    const wrapper = document.createElement("div");
    wrapper.className = "vs-editorial-groups";

    const moviesTv = candidates.filter((candidate) => candidate.mediaType === "movie" || candidate.mediaType === "tv");
    const books = candidates.filter((candidate) => candidate.mediaType === "book");
    const others = candidates.filter((candidate) => candidate.mediaType !== "movie" && candidate.mediaType !== "tv" && candidate.mediaType !== "book");

    if (moviesTv.length && books.length) {
      appendEditorialCandidateGroup({ requestId, originalQuery, parent: wrapper, label: "Movies and TV", items: moviesTv });
      appendEditorialCandidateGroup({ requestId, originalQuery, parent: wrapper, label: "Books", items: books });
      appendEditorialCandidateGroup({ requestId, originalQuery, parent: wrapper, label: "Other", items: others });
    } else {
      appendEditorialCandidateGroup({ requestId, originalQuery, parent: wrapper, label: "Matches", items: candidates });
    }

    card.appendChild(wrapper);
    mountCard(card);
  }

  function showEditorialError(message: string, options: ErrorDisplayOptions = {}) {
    const card = buildEditorialShell({
      kind: "error",
      title: "Synopsis unavailable",
      subtitle: "The lookup could not finish cleanly this time.",
      ariaLabel: "Synopsis unavailable",
    });

    card.appendChild(createEditorialStatus(message || "Something went wrong. Try again.", "error"));

    const actions = buildErrorActions(options.errorCode, options);
    if (actions.length) {
      const row = document.createElement("div");
      row.className = "vs-editorial-actions";

      actions.forEach((action) => {
        row.appendChild(
          createEditorialActionButton(action.label, action.run, {
            secondary: Boolean(action.secondary),
          }),
        );
      });

      card.appendChild(row);
    }

    mountCard(card);
  }

  function showLoading(query: string) {
    if (editorialSynopsisPopupEnabled) {
      showEditorialLoading(query);
      return;
    }

    const card = buildCompactShell("Getting Synopsis");

    const sub = document.createElement("p");
    sub.className = "vs-sub";
    sub.textContent = query ? `Searching for: ${query}` : "Searching title";

    const shimmer = document.createElement("div");
    shimmer.className = "vs-shimmer";

    card.append(sub, shimmer);
    mountCard(card);
  }

  function showCompactResult(result: LookupDisplayResult) {
    if (editorialSynopsisPopupEnabled) {
      showEditorialCompactResult(result);
      return;
    }

    const card = buildCompactShell(result.title || "Synopsis");

    const meta = metadataRow(result);

    const synopsis = document.createElement("p");
    synopsis.className = "vs-synopsis";
    synopsis.textContent = result.synopsis || "";

    const foot = document.createElement("p");
    foot.className = "vs-foot";
    foot.textContent = `Sources: ${result.sourceAttribution}${result.fromCache ? " (cached)" : ""}`;

    card.append(meta, synopsis, foot);
    mountCard(card);
  }

  function showSearchInput() {
    if (editorialSynopsisPopupEnabled) {
      showEditorialSearchInput();
      return;
    }

    cLog("showSearchInput:start", { anchor: lastContextMenuPos });
    const card = document.createElement("section");
    card.id = CARD_ID;
    card.className = "vs-card vs-card--search";
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
    form.append(input);
    card.append(form);

    const closeIfOutside = (event: MouseEvent) => {
      if (Date.now() - openedAt < 280) return;
      if (!(event.target instanceof Node) || !card.contains(event.target)) {
        cLog("showSearchInput:close:outsideClick");
        closeCard();
      }
    };

    const cleanup = () => {
      document.removeEventListener("mousedown", closeIfOutside, true);
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

    const fallbackPos = {
      left: window.scrollX + Math.max(20, (window.innerWidth - 520) / 2),
      top: window.scrollY + 64,
    };
    mountCard(card, { anchorPos: lastContextMenuPos || fallbackPos });
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
        run: () => showSearchInput(),
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
    if (editorialSynopsisPopupEnabled) {
      showEditorialPanelResult(result, options);
      return;
    }

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
    close.addEventListener("click", () => closeCard());

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

    const canShowWrongMatchChip =
      options.autoResolved &&
      (result.canChooseAnother !== false || Boolean(result.reselectRequestId) || Boolean(result.lookupQuery));

    if (canShowWrongMatchChip) {
      const wrongMatch = createActionChip("Wrong match?", () => {
        showAlternativeMatches(result).catch((error) => {
          cLog("wrongMatch:error", { message: error?.message || String(error) });
          showError("Could not load alternative matches.");
        });
      });
      chips.appendChild(wrongMatch);
    }

    chips.appendChild(createGoogleSearchChip(result));

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

    left.append(header, chips);
    if (autoNote) left.appendChild(autoNote);
    left.append(synopsis, footerRow);
    renderPanelArtwork(right, result);

    card.append(left, right);
    mountCard(card);
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
    if (editorialSynopsisPopupEnabled) {
      showEditorialAmbiguous({ requestId, candidates, originalQuery, note });
      return;
    }

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

  function showError(message: string, options: ErrorDisplayOptions = {}) {
    if (editorialSynopsisPopupEnabled) {
      showEditorialError(message, options);
      return;
    }

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

    mountCard(card);
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
      showAmbiguous({
        requestId: String(message.requestId || ""),
        candidates: Array.isArray(message.candidates) ? (message.candidates as Candidate[]) : [],
        originalQuery: String(message.originalQuery || ""),
        note: typeof message.note === "string" ? message.note : undefined,
      });
      return;
    }

    if (message.type === "SHOW_ERROR") {
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
