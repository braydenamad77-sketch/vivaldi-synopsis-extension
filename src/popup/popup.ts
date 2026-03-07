import { DEFAULT_SETTINGS } from "../config/constants";
import { getDebugState, setDebugEnabled } from "../debug/store";
import { formatShortcutLabel, normalizeShortcutKey } from "../core/shortcut";
import type { ExtensionSettings } from "../types";
import type { OpenSearchInActiveTabResponse } from "../runtime/messages";

function byId<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}

const els = {
  debugMode: byId<HTMLInputElement>("debugMode"),
  shortcutValue: byId<HTMLElement>("shortcutValue"),
  status: byId<HTMLDivElement>("popupStatus"),
  searchBtn: byId<HTMLButtonElement>("searchBtn"),
  optionsBtn: byId<HTMLButtonElement>("optionsBtn"),
};

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

async function loadPopup() {
  const [payload, debugState] = await Promise.all([chrome.storage.local.get("settings"), getDebugState()]);
  const settings = mergeSettings(payload.settings as Partial<ExtensionSettings> | undefined);
  els.shortcutValue.textContent = formatShortcutLabel(normalizeShortcutKey(settings.searchShortcutKey));
  els.debugMode.checked = debugState.enabled;

  if (!settings.openrouterApiKey) {
    setStatus("OpenRouter API key is missing. Set it in Settings before your first lookup.", "warning");
    return;
  }

  setStatus("");
}

async function updateDebugMode(enabled: boolean) {
  await setDebugEnabled(enabled);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = tab?.windowId;
  if (!windowId) return;

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
  const response = (await chrome.runtime.sendMessage({ type: "OPEN_SEARCH_IN_ACTIVE_TAB" })) as OpenSearchInActiveTabResponse;
  if (response?.status === "ok") {
    window.close();
    return;
  }

  setStatus(response?.message || "Could not open manual search on this page.", "error");
});

els.optionsBtn.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

els.debugMode.addEventListener("change", () => {
  updateDebugMode(els.debugMode.checked).catch((error) => {
    setStatus(error?.message || "Could not update debug mode.", "error");
  });
});

loadPopup().catch((error) => {
  setStatus(error?.message || "Could not load popup details.", "error");
});
