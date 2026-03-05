import { REQUEST_TIMEOUT_MS } from "../config/constants.js";

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Open Library request failed: ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function first(value, fallback = "") {
  if (Array.isArray(value)) return value[0] || fallback;
  return value || fallback;
}

function coverUrl(coverId) {
  if (!coverId) return undefined;
  return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
}

function sanitizeIsbn(value) {
  if (!value) return "";
  const cleaned = String(value).replace(/[^0-9Xx]/g, "").toUpperCase();
  if (cleaned.length === 10 || cleaned.length === 13) return cleaned;
  return "";
}

function splitIsbns(values) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  const isbn10 = [];
  const isbn13 = [];
  const seen10 = new Set();
  const seen13 = new Set();

  for (const value of list) {
    const cleaned = sanitizeIsbn(value);
    if (!cleaned) continue;
    if (cleaned.length === 10 && !seen10.has(cleaned)) {
      seen10.add(cleaned);
      isbn10.push(cleaned);
      continue;
    }
    if (cleaned.length === 13 && !seen13.has(cleaned)) {
      seen13.add(cleaned);
      isbn13.push(cleaned);
    }
  }

  return {
    isbn10: isbn10.slice(0, 6),
    isbn13: isbn13.slice(0, 6),
  };
}

function normalizeGoodreadsIds(values) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  const ids = [];
  const seen = new Set();
  for (const value of list) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
    if (ids.length >= 6) break;
  }
  return ids;
}

export async function searchOpenLibrary(normalizedQuery) {
  const query = encodeURIComponent(normalizedQuery.query || normalizedQuery.raw);
  if (!query) return [];

  const fields = encodeURIComponent("key,title,first_publish_year,author_name,cover_i,id_goodreads,isbn");
  const url = `https://openlibrary.org/search.json?title=${query}&limit=5&fields=${fields}`;
  const data = await fetchJson(url);
  const docs = data.docs || [];

  return docs.map((doc) => {
    const split = splitIsbns(doc.isbn || []);
    return {
      id: doc.key,
      provider: "openlibrary",
      mediaType: "book",
      title: doc.title,
      year: doc.first_publish_year,
      authorOrDirector: first(doc.author_name),
      coverId: doc.cover_i,
      artworkUrl: coverUrl(doc.cover_i),
      artworkKind: "cover",
      goodreadsIds: normalizeGoodreadsIds(doc.id_goodreads || []),
      isbn10: split.isbn10,
      isbn13: split.isbn13,
    };
  });
}

function extractDescription(payload) {
  if (!payload?.description) return "";
  if (typeof payload.description === "string") return payload.description;
  if (typeof payload.description?.value === "string") return payload.description.value;
  return "";
}

function toTitleCase(value) {
  return String(value)
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function extractBookGenres(work) {
  const subjects = Array.isArray(work?.subjects) ? work.subjects : [];
  const picked = [];

  for (const subject of subjects) {
    if (!subject || typeof subject !== "string") continue;
    if (subject.includes("--")) continue;
    if (subject.length > 28) continue;

    const normalized = toTitleCase(subject.trim());
    if (!normalized) continue;
    if (picked.includes(normalized)) continue;

    picked.push(normalized);
    if (picked.length >= 2) break;
  }

  return picked;
}

function extractEditionDescription(editions) {
  const entries = Array.isArray(editions?.entries) ? editions.entries : [];
  for (const entry of entries) {
    const description = extractDescription(entry);
    if (description) return description;
  }
  return "";
}

function extractEditionGenres(editions) {
  const entries = Array.isArray(editions?.entries) ? editions.entries : [];
  const merged = [];

  for (const entry of entries) {
    const subjects = Array.isArray(entry?.subjects) ? entry.subjects : [];
    for (const subject of subjects) {
      if (!subject || typeof subject !== "string") continue;
      if (subject.includes("--")) continue;
      if (subject.length > 28) continue;
      const normalized = toTitleCase(subject.trim());
      if (!normalized) continue;
      if (merged.includes(normalized)) continue;
      merged.push(normalized);
      if (merged.length >= 4) return merged;
    }
  }

  return merged;
}

function extractEditionGoodreadsIds(editions) {
  const entries = Array.isArray(editions?.entries) ? editions.entries : [];
  const merged = [];

  for (const entry of entries) {
    const ids = entry?.identifiers?.goodreads;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (!id) continue;
      const normalized = String(id).trim();
      if (!normalized || merged.includes(normalized)) continue;
      merged.push(normalized);
      if (merged.length >= 6) return merged;
    }
  }

  return merged;
}

function extractEditionIsbns(editions) {
  const entries = Array.isArray(editions?.entries) ? editions.entries : [];
  const all = [];

  for (const entry of entries) {
    for (const isbn of entry?.isbn_10 || []) all.push(isbn);
    for (const isbn of entry?.isbn_13 || []) all.push(isbn);
  }

  return splitIsbns(all);
}

function dedupeMerge(primary = [], secondary = [], limit = 6) {
  const merged = [];
  for (const value of [...primary, ...secondary]) {
    if (!value) continue;
    if (merged.includes(value)) continue;
    merged.push(value);
    if (merged.length >= limit) break;
  }
  return merged;
}

export async function fetchOpenLibraryDetails(candidate) {
  const workKey = candidate.id?.startsWith("/works/") ? candidate.id : null;
  let description = "";
  let genres = [];
  let editionDescription = "";
  let editionGenres = [];
  let editionGoodreadsIds = [];
  let editionIsbns = { isbn10: [], isbn13: [] };

  if (workKey) {
    const [workResult, editionsResult] = await Promise.allSettled([
      fetchJson(`https://openlibrary.org${workKey}.json`),
      fetchJson(`https://openlibrary.org${workKey}/editions.json?limit=20`),
    ]);

    const work = workResult.status === "fulfilled" ? workResult.value : null;
    const editions = editionsResult.status === "fulfilled" ? editionsResult.value : null;

    description = extractDescription(work);
    genres = extractBookGenres(work);

    editionDescription = extractEditionDescription(editions);
    editionGenres = extractEditionGenres(editions);
    editionGoodreadsIds = extractEditionGoodreadsIds(editions);
    editionIsbns = extractEditionIsbns(editions);
  }

  const mergedGenres = dedupeMerge(genres, editionGenres, 4);
  const mergedGoodreadsIds = dedupeMerge(normalizeGoodreadsIds(candidate.goodreadsIds || []), editionGoodreadsIds, 6);
  const mergedIsbn10 = dedupeMerge(candidate.isbn10 || [], editionIsbns.isbn10 || [], 6);
  const mergedIsbn13 = dedupeMerge(candidate.isbn13 || [], editionIsbns.isbn13 || [], 6);

  return {
    title: candidate.title,
    mediaType: "book",
    year: candidate.year,
    author: candidate.authorOrDirector,
    synopsisSource: description || editionDescription,
    cast: [],
    directorOrCreator: undefined,
    genres: mergedGenres,
    goodreadsIds: mergedGoodreadsIds,
    isbn10: mergedIsbn10,
    isbn13: mergedIsbn13,
    artworkUrl: coverUrl(candidate.coverId) || candidate.artworkUrl,
    artworkKind: "cover",
    sourceAttribution: "Open Library",
  };
}
