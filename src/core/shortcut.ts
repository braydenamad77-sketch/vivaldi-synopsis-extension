export const DEFAULT_SEARCH_SHORTCUT_KEY = "\\";

const DISPLAY_LABELS = new Map([
  ["\\", "Backslash (\\)"],
  ["/", "Slash (/)"],
  [";", "Semicolon (;)"],
  [".", "Period (.)"],
  [",", "Comma (,)"],
]);

type ShortcutEvent = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function normalizeShortcutKey(rawValue: string | undefined | null) {
  if (typeof rawValue !== "string") return DEFAULT_SEARCH_SHORTCUT_KEY;

  const value = rawValue.trim();
  if (!value) return DEFAULT_SEARCH_SHORTCUT_KEY;

  const lowered = value.toLowerCase();
  if (lowered === "backslash") return "\\";
  if (lowered === "slash") return "/";

  if (value.length !== 1) return DEFAULT_SEARCH_SHORTCUT_KEY;
  if (/\s/.test(value)) return DEFAULT_SEARCH_SHORTCUT_KEY;

  return /^[a-z]$/i.test(value) ? value.toLowerCase() : value;
}

export function formatShortcutLabel(rawValue: string | undefined | null) {
  const key = normalizeShortcutKey(rawValue);
  return DISPLAY_LABELS.get(key) || `Key (${key.toUpperCase()})`;
}

export function isShortcutMatch(event: ShortcutEvent | null | undefined, rawValue: string | undefined | null) {
  if (!event) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;

  const expectedKey = normalizeShortcutKey(rawValue);
  if (!expectedKey) return false;

  if (expectedKey === "\\") {
    return (
      event.key === "\\" ||
      event.key === "Backslash" ||
      event.code === "Backslash" ||
      event.code === "IntlBackslash"
    );
  }

  if (/^[a-z]$/i.test(expectedKey)) {
    return String(event.key || "").toLowerCase() === expectedKey;
  }

  return event.key === expectedKey;
}

export function isConfigurableShortcutKey(event: ShortcutEvent | null | undefined) {
  if (!event) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.shiftKey) return false;
  if (event.key === "Tab") return false;
  if (event.key === "Escape") return false;
  return typeof event.key === "string" && event.key.length === 1 && !/\s/.test(event.key);
}
