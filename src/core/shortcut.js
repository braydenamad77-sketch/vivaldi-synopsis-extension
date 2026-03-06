export const DEFAULT_SEARCH_SHORTCUT_KEY = "\\";

const DISPLAY_LABELS = new Map([
  ["\\", "Backslash (\\)"],
  ["/", "Slash (/)"],
  [";", "Semicolon (;)"],
  [".", "Period (.)"],
  [",", "Comma (,)"],
]);

export function normalizeShortcutKey(rawValue) {
  if (typeof rawValue !== "string") return DEFAULT_SEARCH_SHORTCUT_KEY;

  const value = rawValue.trim();
  if (!value) return DEFAULT_SEARCH_SHORTCUT_KEY;

  const lowered = value.toLowerCase();
  if (lowered === "backslash") return "\\";
  if (lowered === "slash") return "/";

  if (value.length !== 1) return DEFAULT_SEARCH_SHORTCUT_KEY;
  if (/\s/.test(value)) return DEFAULT_SEARCH_SHORTCUT_KEY;

  return value;
}

export function formatShortcutLabel(rawValue) {
  const key = normalizeShortcutKey(rawValue);
  return DISPLAY_LABELS.get(key) || `Key (${key.toUpperCase()})`;
}

export function isShortcutMatch(event, rawValue) {
  if (!event) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;

  const expectedKey = normalizeShortcutKey(rawValue);
  if (!expectedKey) return false;

  if (expectedKey === "\\") {
    return event.key === "\\" || (event.code === "Backslash" && !event.shiftKey);
  }

  return event.key === expectedKey;
}

export function isConfigurableShortcutKey(event) {
  if (!event) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key === "Tab") return false;
  if (event.key === "Escape") return false;
  return typeof event.key === "string" && event.key.length === 1 && !/\s/.test(event.key);
}
