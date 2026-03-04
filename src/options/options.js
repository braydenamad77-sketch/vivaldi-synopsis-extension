import { DEFAULT_SETTINGS } from "../config/constants.js";
import { clearCache } from "../core/cache.js";

const els = {
  openrouterApiKey: document.getElementById("openrouterApiKey"),
  openrouterModel: document.getElementById("openrouterModel"),
  tmdbApiKey: document.getElementById("tmdbApiKey"),
  llmEnabled: document.getElementById("llmEnabled"),
  llmPreferred: document.getElementById("llmPreferred"),
  localOnlyMode: document.getElementById("localOnlyMode"),
  providerOpenLibrary: document.getElementById("providerOpenLibrary"),
  providerTmdb: document.getElementById("providerTmdb"),
  providerWikipedia: document.getElementById("providerWikipedia"),
  saveBtn: document.getElementById("saveBtn"),
  clearCacheBtn: document.getElementById("clearCacheBtn"),
  status: document.getElementById("status"),
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

function setStatus(message) {
  els.status.textContent = message;
  setTimeout(() => {
    if (els.status.textContent === message) {
      els.status.textContent = "";
    }
  }, 2200);
}

async function loadSettings() {
  const payload = await chrome.storage.local.get("settings");
  const settings = mergeSettings(payload.settings);

  els.openrouterApiKey.value = settings.openrouterApiKey;
  els.openrouterModel.value = settings.openrouterModel;
  els.tmdbApiKey.value = settings.tmdbApiKey;
  els.llmEnabled.checked = settings.llmEnabled;
  els.llmPreferred.checked = settings.llmPreferred;
  els.localOnlyMode.checked = settings.localOnlyMode;
  els.providerOpenLibrary.checked = settings.providerToggles.openlibrary;
  els.providerTmdb.checked = settings.providerToggles.tmdb;
  els.providerWikipedia.checked = settings.providerToggles.wikipedia;
}

function collectSettings() {
  return {
    openrouterApiKey: els.openrouterApiKey.value.trim(),
    openrouterModel: els.openrouterModel.value.trim() || DEFAULT_SETTINGS.openrouterModel,
    tmdbApiKey: els.tmdbApiKey.value.trim(),
    llmEnabled: els.llmEnabled.checked,
    llmPreferred: els.llmPreferred.checked,
    localOnlyMode: els.localOnlyMode.checked,
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

els.saveBtn.addEventListener("click", () => {
  saveSettings().catch((error) => setStatus(`Save failed: ${error.message}`));
});

els.clearCacheBtn.addEventListener("click", () => {
  wipeCache().catch((error) => setStatus(`Cache clear failed: ${error.message}`));
});

loadSettings().catch((error) => setStatus(`Load failed: ${error.message}`));
