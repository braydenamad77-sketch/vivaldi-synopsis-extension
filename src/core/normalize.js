const MEDIA_HINTS = {
  book: /\b(book|novel|author|read)\b/i,
  movie: /\b(movie|film|cinema|director)\b/i,
  tv: /\b(tv|series|show|episode|season)\b/i,
};

export function normalizeQuery(raw) {
  const input = typeof raw === "string" ? raw : "";
  const compact = input.replace(/\s+/g, " ").trim();

  const yearMatch = compact.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  const hintYear = yearMatch ? Number(yearMatch[1]) : undefined;

  let query = compact
    .replace(/[“”"'`]/g, "")
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (hintYear) {
    query = query
      .replace(new RegExp(`\\(?\\b${hintYear}\\b\\)?`, "g"), "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  const hintType = detectHintType(compact);
  const cleaned = query.slice(0, 120);

  return {
    raw: compact,
    query: cleaned,
    hintYear,
    hintType,
  };
}

export function detectHintType(text) {
  if (!text) return undefined;
  if (MEDIA_HINTS.book.test(text)) return "book";
  if (MEDIA_HINTS.movie.test(text)) return "movie";
  if (MEDIA_HINTS.tv.test(text)) return "tv";
  return undefined;
}

export function normalizeTitleForCompare(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCacheKey(normalizedQuery) {
  return `cache:${hashString(normalizedQuery.query || normalizedQuery.raw || "")}`;
}

export function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}
