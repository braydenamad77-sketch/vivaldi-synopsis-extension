import { DEFAULT_SETTINGS } from "../config/constants.js";
import { clearCache } from "../core/cache.js";
import {
  DEFAULT_SEARCH_SHORTCUT_KEY,
  formatShortcutLabel,
  isConfigurableShortcutKey,
  normalizeShortcutKey,
} from "../core/shortcut.js";

const els = {
  openrouterApiKey: document.getElementById("openrouterApiKey"),
  openrouterModel: document.getElementById("openrouterModel"),
  tmdbApiKey: document.getElementById("tmdbApiKey"),
  searchShortcutKey: document.getElementById("searchShortcutKey"),
  resetShortcutBtn: document.getElementById("resetShortcutBtn"),
  resultUiModePanel: document.getElementById("resultUiModePanel"),
  resultUiModeCompact: document.getElementById("resultUiModeCompact"),
  llmEnabled: document.getElementById("llmEnabled"),
  llmPreferred: document.getElementById("llmPreferred"),
  localOnlyMode: document.getElementById("localOnlyMode"),
  goodreadsVisualFallbackEnabled: document.getElementById("goodreadsVisualFallbackEnabled"),
  goodreadsHelperUrl: document.getElementById("goodreadsHelperUrl"),
  providerOpenLibrary: document.getElementById("providerOpenLibrary"),
  providerTmdb: document.getElementById("providerTmdb"),
  providerWikipedia: document.getElementById("providerWikipedia"),
  saveBtn: document.getElementById("saveBtn"),
  clearCacheBtn: document.getElementById("clearCacheBtn"),
  status: document.getElementById("status"),
  settingsSummary: document.getElementById("settingsSummary"),
};
let shortcutDraft = DEFAULT_SEARCH_SHORTCUT_KEY;

function mergeSettings(stored) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(stored || {}),
    providerToggles: {
      ...DEFAULT_SETTINGS.providerToggles,
      ...(stored?.providerToggles || {}),
    },
  };

  // Backward compatibility for older saved values.
  if (merged.resultUiMode === "panel") merged.resultUiMode = "with_image";
  if (merged.resultUiMode === "compact") merged.resultUiMode = "without_image";

  return merged;
}

function setStatus(message) {
  els.status.textContent = message;
  setTimeout(() => {
    if (els.status.textContent === message) {
      els.status.textContent = "";
    }
  }, 2200);
}

function renderShortcutField() {
  els.searchShortcutKey.value = formatShortcutLabel(shortcutDraft);
}

function renderSummary() {
  const messages = [];
  const openrouterMissing = !els.openrouterApiKey.value.trim();
  const tmdbEnabled = els.providerTmdb.checked;
  const tmdbMissing = tmdbEnabled && !els.tmdbApiKey.value.trim();

  if (openrouterMissing) {
    messages.push("Add your OpenRouter API key so the extension can generate synopses.");
  } else {
    messages.push("OpenRouter is ready. Results will stay AI-written by default.");
  }

  if (tmdbMissing) {
    messages.push("TMDB is enabled but has no API key, so movie and TV matching may be weaker.");
  }

  if (els.goodreadsVisualFallbackEnabled.checked) {
    if (openrouterMissing) {
      messages.push("Goodreads visual fallback is on, but it still needs your OpenRouter key to read the page screenshots.");
    } else {
      messages.push(`Goodreads visual fallback is ready at ${els.goodreadsHelperUrl.value.trim() || DEFAULT_SETTINGS.goodreadsHelperUrl}.`);
    }
  } else {
    messages.push("Goodreads visual fallback is off, so books without Open Library descriptions will stop earlier.");
  }

  if (els.localOnlyMode.checked) {
    messages.push("Local-only mode is on, so uncached lookups will fail until you turn it back off.");
  }

  messages.push(`Manual search shortcut: ${formatShortcutLabel(shortcutDraft)}.`);

  els.settingsSummary.innerHTML = messages.map((message) => `<p>${message}</p>`).join("");
}

function syncUiState() {
  els.llmPreferred.disabled = !els.llmEnabled.checked;
  renderShortcutField();
  renderSummary();
}

async function loadSettings() {
  const payload = await chrome.storage.local.get("settings");
  const settings = mergeSettings(payload.settings);

  els.openrouterApiKey.value = settings.openrouterApiKey;
  els.openrouterModel.value = settings.openrouterModel;
  els.tmdbApiKey.value = settings.tmdbApiKey;
  shortcutDraft = normalizeShortcutKey(settings.searchShortcutKey || DEFAULT_SEARCH_SHORTCUT_KEY);
  els.resultUiModePanel.checked = settings.resultUiMode === "with_image";
  els.resultUiModeCompact.checked = settings.resultUiMode === "without_image";
  els.llmEnabled.checked = settings.llmEnabled;
  els.llmPreferred.checked = settings.llmPreferred;
  els.localOnlyMode.checked = settings.localOnlyMode;
  els.goodreadsVisualFallbackEnabled.checked = settings.goodreadsVisualFallbackEnabled;
  els.goodreadsHelperUrl.value = settings.goodreadsHelperUrl || DEFAULT_SETTINGS.goodreadsHelperUrl;
  els.providerOpenLibrary.checked = settings.providerToggles.openlibrary;
  els.providerTmdb.checked = settings.providerToggles.tmdb;
  els.providerWikipedia.checked = settings.providerToggles.wikipedia;
  syncUiState();
}

function collectSettings() {
  return {
    openrouterApiKey: els.openrouterApiKey.value.trim(),
    openrouterModel: els.openrouterModel.value.trim() || DEFAULT_SETTINGS.openrouterModel,
    tmdbApiKey: els.tmdbApiKey.value.trim(),
    searchShortcutKey: normalizeShortcutKey(shortcutDraft),
    resultUiMode: els.resultUiModeCompact.checked ? "without_image" : "with_image",
    llmEnabled: els.llmEnabled.checked,
    llmPreferred: els.llmPreferred.checked,
    localOnlyMode: els.localOnlyMode.checked,
    goodreadsVisualFallbackEnabled: els.goodreadsVisualFallbackEnabled.checked,
    goodreadsHelperUrl: els.goodreadsHelperUrl.value.trim() || DEFAULT_SETTINGS.goodreadsHelperUrl,
    providerToggles: {
      openlibrary: els.providerOpenLibrary.checked,
      tmdb: els.providerTmdb.checked,
      wikipedia: els.providerWikipedia.checked,
    },
  };
}

async function saveSettings() {
  await chrome.storage.local.set({ settings: collectSettings() });
  setStatus("Settings saved.");
}

async function wipeCache() {
  await clearCache();
  setStatus("Cached results deleted.");
}

els.searchShortcutKey.addEventListener("keydown", (event) => {
  if (event.key === "Tab") return;
  event.preventDefault();

  if (!isConfigurableShortcutKey(event)) {
    setStatus("Use one regular key without modifiers.");
    return;
  }

  shortcutDraft = normalizeShortcutKey(event.key);
  syncUiState();
  setStatus(`Shortcut set to ${formatShortcutLabel(shortcutDraft)}. Save to apply.`);
});

els.resetShortcutBtn.addEventListener("click", () => {
  shortcutDraft = DEFAULT_SEARCH_SHORTCUT_KEY;
  syncUiState();
  setStatus("Shortcut reset to backslash. Save to apply.");
});

[
  els.openrouterApiKey,
  els.openrouterModel,
  els.tmdbApiKey,
  els.resultUiModePanel,
  els.resultUiModeCompact,
  els.llmEnabled,
  els.llmPreferred,
  els.localOnlyMode,
  els.goodreadsVisualFallbackEnabled,
  els.goodreadsHelperUrl,
  els.providerOpenLibrary,
  els.providerTmdb,
  els.providerWikipedia,
].forEach((element) => {
  element.addEventListener("input", syncUiState);
  element.addEventListener("change", syncUiState);
});

els.saveBtn.addEventListener("click", () => {
  saveSettings().catch((error) => setStatus(`Save failed: ${error.message}`));
});

els.clearCacheBtn.addEventListener("click", () => {
  wipeCache().catch((error) => setStatus(`Cache clear failed: ${error.message}`));
});

loadSettings()
  .then(() => syncUiState())
  .catch((error) => setStatus(`Load failed: ${error.message}`));
