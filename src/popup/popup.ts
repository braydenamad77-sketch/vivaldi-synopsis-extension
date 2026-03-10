import { DEFAULT_SETTINGS } from "../config/constants";
import { getManualSearchAvailability } from "../core/manual-search";
import { getDebugState, setDebugEnabled } from "../debug/store";
import { formatShortcutLabel, normalizeShortcutKey } from "../core/shortcut";
import type { ExtensionSettings } from "../types";
import type { OpenSearchInActiveTabResponse } from "../runtime/messages";

function byId<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing required popup element: #${id}`);
  }
  return element as T;
}

const els = {
  debugMode: byId<HTMLInputElement>("debugMode"),
  editorialSynopsisPopupEnabled: byId<HTMLInputElement>("editorialSynopsisPopupEnabled"),
  pageHost: byId<HTMLElement>("pageHost"),
  pageNote: byId<HTMLElement>("pageNote"),
  synopsisUiNote: byId<HTMLElement>("synopsisUiNote"),
  shortcutValue: byId<HTMLElement>("shortcutValue"),
  status: byId<HTMLDivElement>("popupStatus"),
  searchBtn: byId<HTMLButtonElement>("searchBtn"),
  optionsBtn: byId<HTMLButtonElement>("optionsBtn"),
};
let currentSettings: ExtensionSettings | null = null;
let manualSearchEnabled = true;
let popupReady = false;
let searchBusy = false;

function syncToggleState() {
  els.debugMode.disabled = !popupReady;
  els.editorialSynopsisPopupEnabled.disabled = !popupReady;
}

function syncSearchButtonState() {
  if (!popupReady) {
    els.searchBtn.disabled = true;
    els.searchBtn.textContent = "Loading...";
    return;
  }

  els.searchBtn.disabled = searchBusy || !manualSearchEnabled;
  els.searchBtn.textContent = searchBusy ? "Opening..." : manualSearchEnabled ? "Open Search Box" : "Unavailable Here";
}

function setPopupReady(nextReady: boolean) {
  popupReady = nextReady;
  syncToggleState();
  syncSearchButtonState();
}

function setStatus(message = "", tone = "info") {
  els.status.textContent = message;
  els.status.dataset.tone = message ? tone : "empty";
}

function mergeSettings(stored: Partial<typeof DEFAULT_SETTINGS> | undefined) {
  return {
    ...DEFAULT_SETTINGS,
    ...(stored || {}),
    providerToggles: {
      ...DEFAULT_SETTINGS.providerToggles,
      ...(stored?.providerToggles || {}),
    },
  };
}

function renderSynopsisUiNote(enabled: boolean) {
  els.synopsisUiNote.textContent = enabled
    ? "Use the new editorial synopsis popup."
    : "Use the original legacy synopsis popup.";
}

function renderManualSearchAvailability(url?: string | null) {
  const availability = getManualSearchAvailability(url);
  manualSearchEnabled = availability.enabled;
  els.pageHost.textContent = availability.pageLabel;
  els.pageHost.dataset.state = availability.enabled ? "ready" : "blocked";
  els.pageNote.textContent = availability.message;
  els.searchBtn.title = availability.enabled ? "Open the manual search field in this page." : availability.message;
  syncSearchButtonState();
}

async function loadPopup() {
  const [payload, debugState, tabs] = await Promise.all([
    chrome.storage.local.get("settings"),
    getDebugState(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  const settings = mergeSettings(payload.settings as Partial<ExtensionSettings> | undefined);
  currentSettings = settings;
  renderManualSearchAvailability(tabs?.[0]?.url);
  els.shortcutValue.textContent = formatShortcutLabel(normalizeShortcutKey(settings.searchShortcutKey));
  els.debugMode.checked = debugState.enabled;
  els.editorialSynopsisPopupEnabled.checked = settings.editorialSynopsisPopupEnabled;
  renderSynopsisUiNote(settings.editorialSynopsisPopupEnabled);
  setPopupReady(true);

  if (!settings.openrouterApiKey) {
    setStatus("OpenRouter API key is missing. Set it in Settings before your first lookup.", "warning");
    return;
  }

  setStatus("");
}

function setSearchBusy(nextBusy: boolean) {
  searchBusy = nextBusy;
  syncSearchButtonState();
}

async function updateSynopsisUiPreference(enabled: boolean) {
  const nextSettings = {
    ...(currentSettings || mergeSettings(undefined)),
    editorialSynopsisPopupEnabled: enabled,
  };

  await chrome.storage.local.set({ settings: nextSettings });
  currentSettings = nextSettings;
  renderSynopsisUiNote(enabled);
  setStatus(enabled ? "Synopsis UI set to the new editorial popup." : "Synopsis UI set to the original legacy popup.", "success");
}

async function updateDebugMode(enabled: boolean) {
  await setDebugEnabled(enabled);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = tab?.windowId;
  if (typeof windowId !== "number") {
    setStatus("Could not determine the active browser window.", "error");
    return;
  }

  if (enabled) {
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId });
    }
    setStatus("Debug mode is on. The side panel will show raw LLM input and output.", "success");
    return;
  }

  if (chrome.sidePanel?.close) {
    try {
      await chrome.sidePanel.close({ windowId });
    } catch (_error) {
      // Older Chromium builds may not support programmatic close.
    }
  }
  setStatus("Debug mode is off.", "info");
}

els.searchBtn.addEventListener("click", async () => {
  setSearchBusy(true);
  try {
    const response = (await chrome.runtime.sendMessage({ type: "OPEN_SEARCH_IN_ACTIVE_TAB" })) as OpenSearchInActiveTabResponse;
    if (response?.status === "ok") {
      window.close();
      return;
    }

    setStatus(response?.message || "Could not open manual search on this page.", "error");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not open manual search on this page.", "error");
  } finally {
    setSearchBusy(false);
  }
});

els.optionsBtn.addEventListener("click", async () => {
  const originalLabel = els.optionsBtn.textContent;
  els.optionsBtn.disabled = true;
  els.optionsBtn.textContent = "Opening...";

  try {
    await chrome.runtime.openOptionsPage();
    window.close();
  } catch (error) {
    els.optionsBtn.disabled = false;
    els.optionsBtn.textContent = originalLabel;
    setStatus(error instanceof Error ? error.message : "Could not open settings.", "error");
  }
});

els.debugMode.addEventListener("change", () => {
  updateDebugMode(els.debugMode.checked).catch((error) => {
    setStatus(error?.message || "Could not update debug mode.", "error");
  });
});

els.editorialSynopsisPopupEnabled.addEventListener("change", () => {
  updateSynopsisUiPreference(els.editorialSynopsisPopupEnabled.checked).catch((error) => {
    els.editorialSynopsisPopupEnabled.checked = !(els.editorialSynopsisPopupEnabled.checked);
    renderSynopsisUiNote(els.editorialSynopsisPopupEnabled.checked);
    setStatus(error?.message || "Could not update the synopsis UI preference.", "error");
  });
});

setPopupReady(false);
loadPopup().catch((error) => {
  setStatus(error?.message || "Could not load popup details.", "error");
});
