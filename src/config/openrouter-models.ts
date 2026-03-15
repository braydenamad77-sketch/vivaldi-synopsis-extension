export const DEFAULT_OPENROUTER_MODEL = "openrouter/hunter-alpha";
export const LEGACY_OPENROUTER_MODEL = "google/gemini-3.1-flash-lite-preview";

export type OpenRouterModelPreset = "hunter_alpha" | "legacy" | "custom";

export function resolveOpenRouterModel(model: string | null | undefined) {
  const trimmed = String(model || "").trim();
  return trimmed || DEFAULT_OPENROUTER_MODEL;
}

export function getOpenRouterModelPreset(model: string | null | undefined): OpenRouterModelPreset {
  const resolved = resolveOpenRouterModel(model);
  if (resolved === DEFAULT_OPENROUTER_MODEL) return "hunter_alpha";
  if (resolved === LEGACY_OPENROUTER_MODEL) return "legacy";
  return "custom";
}

export function getOpenRouterModelValue(preset: Exclude<OpenRouterModelPreset, "custom">) {
  return preset === "hunter_alpha" ? DEFAULT_OPENROUTER_MODEL : LEGACY_OPENROUTER_MODEL;
}
