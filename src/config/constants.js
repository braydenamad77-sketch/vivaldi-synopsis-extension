export const MENU_LOOKUP_SELECTION = "get-synopsis-selection";
export const MENU_LOOKUP_MANUAL = "get-synopsis-manual";
export const MENU_LABEL_LOOKUP_SELECTION = "Get Synopsis";
export const MENU_LABEL_LOOKUP_MANUAL = "Search Synopsis";
export const REQUEST_TIMEOUT_MS = 1200;
export const LLM_TIMEOUT_MS = 1800;
export const LLM_SOURCE_TEXT_MAX_WORDS = 750;
export const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
export const GOODREADS_TIMEOUT_MS = 1000 * 30;
export const GOODREADS_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
export const GOODREADS_HELPER_URL_DEFAULT = "http://127.0.0.1:4317";
export const MAX_CANDIDATES = 5;
export const DEFAULT_MODEL = "google/gemini-3.1-flash-lite-preview";
export const ENABLE_EDITORIAL_SYNOPSIS_POPUP = true;
export function getSynopsisPopupUiFlagVersion(enabled) {
  return enabled ? "editorial-v1" : "legacy-v1";
}

export const DEFAULT_SETTINGS = {
  openrouterApiKey: "",
  openrouterModel: DEFAULT_MODEL,
  llmEnabled: true,
  llmPreferred: true,
  localOnlyMode: false,
  searchShortcutKey: "\\",
  resultUiMode: "with_image",
  editorialSynopsisPopupEnabled: ENABLE_EDITORIAL_SYNOPSIS_POPUP,
  tmdbApiKey: "",
  goodreadsVisualFallbackEnabled: true,
  goodreadsHelperUrl: GOODREADS_HELPER_URL_DEFAULT,
  providerToggles: {
    openlibrary: true,
    tmdb: true,
    wikipedia: true,
  },
};

export const SPOILER_PATTERNS = [
  /\bending\b/i,
  /\bfinale\b/i,
  /\bin the end\b/i,
  /\bturns out\b/i,
  /\brevealed\b/i,
  /\breveal\b/i,
  /\btwist\b/i,
  /\bkiller\b/i,
  /\bdies\b/i,
  /\bidentity\b/i,
  /\bsecretly\b/i,
  /\bafter .* dies\b/i,
];

export const ATTRIBUTION = {
  openlibrary: "Open Library",
  tmdb: "TMDB",
  wikipedia: "Wikipedia",
  goodreads: "Goodreads",
  llm: "OpenRouter",
};
