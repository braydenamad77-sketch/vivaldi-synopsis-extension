import { DEFAULT_SETTINGS } from "../config/constants";
import {
  DEFAULT_OPENROUTER_MODEL,
  getOpenRouterModelPreset,
  getOpenRouterModelValue,
  LEGACY_OPENROUTER_MODEL,
  resolveOpenRouterModel,
} from "../config/openrouter-models";
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
  modelPresetNote: byId<HTMLElement>("modelPresetNote"),
  modelPresetToggle: byId<HTMLInputElement>("modelPresetToggle"),
  pageHost: byId<HTMLElement>("pageHost"),
  pageNote: byId<HTMLElement>("pageNote"),
  shortcutValue: byId<HTMLElement>("shortcutValue"),
  status: byId<HTMLDivElement>("popupStatus"),
  searchBtn: byId<HTMLButtonElement>("searchBtn"),
  optionsBtn: byId<HTMLButtonElement>("optionsBtn"),
};
let currentSettings: ExtensionSettings = mergeSettings(undefined);
let manualSearchEnabled = true;
let modelBusy = false;
let popupReady = false;
let searchBusy = false;

function syncControlState() {
  els.debugMode.disabled = !popupReady;
  els.modelPresetToggle.disabled = !popupReady || modelBusy;
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
  syncControlState();
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

function renderManualSearchAvailability(url?: string | null) {
  const availability = getManualSearchAvailability(url);
  manualSearchEnabled = availability.enabled;
  els.pageHost.textContent = availability.pageLabel;
  els.pageHost.dataset.state = availability.enabled ? "ready" : "blocked";
  els.pageNote.textContent = availability.message;
  els.searchBtn.title = availability.enabled ? "Open the manual search field in this page." : availability.message;
  syncSearchButtonState();
}

function renderModelToggle(model: string) {
  const resolvedModel = resolveOpenRouterModel(model);
  const preset = getOpenRouterModelPreset(resolvedModel);
  els.modelPresetToggle.checked = preset === "hunter_alpha";

  if (preset === "hunter_alpha") {
    els.modelPresetNote.textContent = `Active model: ${DEFAULT_OPENROUTER_MODEL}. Turn this off to use the legacy model.`;
    return;
  }

  if (preset === "legacy") {
    els.modelPresetNote.textContent = `Active model: ${LEGACY_OPENROUTER_MODEL}. Turn this on to switch to Hunter Alpha.`;
    return;
  }

  els.modelPresetNote.textContent = `Active model: ${resolvedModel}. Using this switch will replace it with Hunter Alpha or the legacy model.`;
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
  renderModelToggle(settings.openrouterModel);
  els.shortcutValue.textContent = formatShortcutLabel(normalizeShortcutKey(settings.searchShortcutKey));
  els.debugMode.checked = debugState.enabled;
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

async function updateOpenRouterModel(useHunterAlpha: boolean) {
  modelBusy = true;
  syncControlState();

  try {
    const payload = await chrome.storage.local.get("settings");
    const settings = mergeSettings(payload.settings as Partial<ExtensionSettings> | undefined);
    settings.openrouterModel = getOpenRouterModelValue(useHunterAlpha ? "hunter_alpha" : "legacy");
    await chrome.storage.local.set({ settings });
    currentSettings = settings;
    renderModelToggle(settings.openrouterModel);
    setStatus(useHunterAlpha ? "OpenRouter model set to Hunter Alpha." : "OpenRouter model set to the legacy model.", "success");
  } catch (error) {
    renderModelToggle(currentSettings.openrouterModel);
    setStatus(error instanceof Error ? error.message : "Could not update OpenRouter model.", "error");
  } finally {
    modelBusy = false;
    syncControlState();
  }
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

els.modelPresetToggle.addEventListener("change", () => {
  updateOpenRouterModel(els.modelPresetToggle.checked).catch((error) => {
    renderModelToggle(currentSettings.openrouterModel);
    setStatus(error?.message || "Could not update OpenRouter model.", "error");
  });
});

setPopupReady(false);
loadPopup().catch((error) => {
  setStatus(error?.message || "Could not load popup details.", "error");
});
