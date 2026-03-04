export const MENU_ID = "get-synopsis";
export const REQUEST_TIMEOUT_MS = 1200;
export const LLM_TIMEOUT_MS = 1800;
export const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
export const MAX_CANDIDATES = 5;
export const DEFAULT_MODEL = "google/gemini-3.1-flash-lite-preview";

export const DEFAULT_SETTINGS = {
  openrouterApiKey: "",
  openrouterModel: DEFAULT_MODEL,
  llmEnabled: true,
  llmPreferred: true,
  localOnlyMode: false,
  tmdbApiKey: "",
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
  llm: "OpenRouter",
};
