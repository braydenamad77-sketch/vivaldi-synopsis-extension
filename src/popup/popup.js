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

function setStatus(message = "", tone = "info") {
  els.status.textContent = message;
  els.status.dataset.tone = message ? tone : "empty";
}

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
    setStatus("OpenRouter API key is missing. Set it in Settings before your first lookup.", "warning");
    return;
  }

  setStatus("");
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
  const response = await chrome.runtime.sendMessage({ type: "OPEN_SEARCH_IN_ACTIVE_TAB" });
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
