import { DEFAULT_SETTINGS } from "../config/constants.js";
import { getDebugState, setDebugEnabled } from "../debug/store.js";
import { formatShortcutLabel, normalizeShortcutKey } from "../core/shortcut.js";

const els = {
  debugMode: document.getElementById("debugMode"),
  shortcutValue: document.getElementById("shortcutValue"),
  status: document.getElementById("popupStatus"),
  searchBtn: document.getElementById("searchBtn"),
  optionsBtn: document.getElementById("optionsBtn"),
};

function mergeSettings(stored) {
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
  const settings = mergeSettings(payload.settings);
  els.shortcutValue.textContent = formatShortcutLabel(normalizeShortcutKey(settings.searchShortcutKey));
  els.debugMode.checked = debugState.enabled;

  if (!settings.openrouterApiKey) {
    els.status.textContent = "OpenRouter API key is missing. Set it in Settings before your first lookup.";
  }
}

async function updateDebugMode(enabled) {
  await setDebugEnabled(enabled);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = tab?.windowId;
  if (!windowId) return;

  if (enabled) {
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId });
    }
    els.status.textContent = "Debug mode is on. The side panel will show raw LLM input and output.";
    return;
  }

  if (chrome.sidePanel?.close) {
    try {
      await chrome.sidePanel.close({ windowId });
    } catch (_error) {
      // Older Chromium builds may not support programmatic close.
    }
  }
  els.status.textContent = "Debug mode is off.";
}

els.searchBtn.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "OPEN_SEARCH_IN_ACTIVE_TAB" });
  if (response?.status === "ok") {
    window.close();
    return;
  }

  els.status.textContent = response?.message || "Could not open manual search on this page.";
});

els.optionsBtn.addEventListener("click", async () => {
  await chrome.runtime.openOptionsPage();
  window.close();
});

els.debugMode.addEventListener("change", () => {
  updateDebugMode(els.debugMode.checked).catch((error) => {
    els.status.textContent = error?.message || "Could not update debug mode.";
  });
});

loadPopup().catch((error) => {
  els.status.textContent = error?.message || "Could not load popup details.";
});
