import { DEFAULT_SETTINGS } from "../config/constants.js";
import { formatShortcutLabel, normalizeShortcutKey } from "../core/shortcut.js";

const els = {
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
  const payload = await chrome.storage.local.get("settings");
  const settings = mergeSettings(payload.settings);
  els.shortcutValue.textContent = formatShortcutLabel(normalizeShortcutKey(settings.searchShortcutKey));

  if (!settings.openrouterApiKey) {
    els.status.textContent = "OpenRouter API key is missing. Set it in Settings before your first lookup.";
  }
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

loadPopup().catch((error) => {
  els.status.textContent = error?.message || "Could not load popup details.";
});
