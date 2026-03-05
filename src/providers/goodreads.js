import { GOODREADS_CACHE_TTL_MS, GOODREADS_RATE_LIMIT_MS, GOODREADS_TIMEOUT_MS } from "../config/constants.js";
import { getCache, setCache } from "../core/cache.js";
import { hashString, normalizeTitleForCompare } from "../core/normalize.js";

let lastGoodreadsRequestAt = 0;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimitWindow() {
  const elapsed = Date.now() - lastGoodreadsRequestAt;
  const wait = GOODREADS_RATE_LIMIT_MS - elapsed;
  if (wait > 0) {
    await delay(wait);
  }
  lastGoodreadsRequestAt = Date.now();
}

async function fetchHtml(url, timeoutMs = GOODREADS_TIMEOUT_MS) {
  await waitForRateLimitWindow();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      throw new Error(`Goodreads request failed: ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtml(text) {
  return String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractNextData(html) {
  const match = String(html || "").match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match?.[1]) return null;

  try {
    return JSON.parse(match[1]);
  } catch (_error) {
    return null;
  }
}

function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    bigrams.set(gram, (bigrams.get(gram) || 0) + 1);
  }

  let overlap = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const count = bigrams.get(gram) || 0;
    if (count > 0) {
      bigrams.set(gram, count - 1);
      overlap += 1;
    }
  }

  return (2 * overlap) / (a.length + b.length - 2);
}

function toYear(value) {
  if (!value) return undefined;
  const date = new Date(Number(value));
  const year = Number(date.getUTCFullYear());
  return Number.isFinite(year) ? year : undefined;
}

function getPrimaryAuthorName(book, apolloState) {
  const ref = book?.primaryContributorEdge?.__ref;
  const contributor = ref ? apolloState?.[ref] : null;
  return contributor?.name ? String(contributor.name).trim() : undefined;
}

function normalizeGenres(book) {
  const raw = Array.isArray(book?.bookGenres) ? book.bookGenres : [];
  const output = [];
  const seen = new Set();

  for (const item of raw) {
    const name = String(item?.genre?.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(name);
    if (output.length >= 4) break;
  }

  return output;
}

function candidateScore(book, apolloState, expected = {}) {
  const expectedTitle = normalizeTitleForCompare(expected.title || "");
  const expectedAuthor = normalizeTitleForCompare(expected.author || "");
  const expectedYear = Number(expected.year) || undefined;

  const title = normalizeTitleForCompare(book?.title || "");
  const titleScore = expectedTitle ? diceCoefficient(expectedTitle, title) : 0.5;
  const author = normalizeTitleForCompare(getPrimaryAuthorName(book, apolloState) || "");
  const authorScore = expectedAuthor ? diceCoefficient(expectedAuthor, author) : 0.4;
  const year = toYear(book?.details?.publicationTime);

  let yearScore = 0;
  if (expectedYear && year) {
    const diff = Math.abs(expectedYear - year);
    if (diff === 0) yearScore = 0.2;
    else if (diff <= 1) yearScore = 0.1;
    else if (diff <= 3) yearScore = 0.04;
    else yearScore = -0.08;
  }

  return titleScore * 0.72 + authorScore * 0.24 + yearScore;
}

function pickBestBook(apolloState, expected = {}) {
  const books = Object.values(apolloState || {}).filter((item) => item?.__typename === "Book");
  if (!books.length) return null;

  const ranked = books
    .map((book) => ({ book, score: candidateScore(book, apolloState, expected) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;

  const expectedTitle = normalizeTitleForCompare(expected.title || "");
  if (expectedTitle) {
    const matchedTitle = normalizeTitleForCompare(best.book.title || "");
    const titleSimilarity = diceCoefficient(expectedTitle, matchedTitle);
    if (titleSimilarity < 0.62) return null;
  }

  const expectedAuthor = normalizeTitleForCompare(expected.author || "");
  if (expectedAuthor) {
    const matchedAuthor = normalizeTitleForCompare(getPrimaryAuthorName(best.book, apolloState) || "");
    const authorSimilarity = diceCoefficient(expectedAuthor, matchedAuthor);
    if (authorSimilarity < 0.42) return null;
  }

  return best.book;
}

function parseGoodreadsFromHtml(html, expected = {}) {
  const nextData = extractNextData(html);
  const apolloState = nextData?.props?.pageProps?.apolloState;
  if (!apolloState) return undefined;

  const book = pickBestBook(apolloState, expected);
  if (!book) return undefined;

  const descriptionStripped = book['description({"stripped":true})'];
  const descriptionHtml = book.description;
  const synopsisSource = stripHtml(descriptionStripped || descriptionHtml);
  if (!synopsisSource) return undefined;

  const author = getPrimaryAuthorName(book, apolloState);
  const year = toYear(book?.details?.publicationTime);
  const genres = normalizeGenres(book);

  return {
    provider: "goodreads",
    title: String(book.title || expected.title || "").trim(),
    author: author || expected.author,
    year: year || expected.year,
    synopsisSource,
    genres,
    sourceAttribution: "Goodreads",
  };
}

function sanitizeIsbn(value) {
  if (!value) return "";
  const cleaned = String(value).replace(/[^0-9Xx]/g, "").toUpperCase();
  if (cleaned.length === 10 || cleaned.length === 13) return cleaned;
  return "";
}

function dedupe(values = [], limit = 8) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function buildLookupQueue(meta = {}) {
  const queue = [];
  const goodreadsIds = dedupe(meta.goodreadsIds || [], 6);
  const isbns = dedupe([...(meta.isbn13 || []), ...(meta.isbn10 || [])].map(sanitizeIsbn).filter(Boolean), 8);
  const title = String(meta.title || "").trim();

  for (const id of goodreadsIds) {
    queue.push({
      cacheId: `id:${id}`,
      url: `https://www.goodreads.com/book/show/${encodeURIComponent(id)}`,
    });
  }

  for (const isbn of isbns) {
    queue.push({
      cacheId: `isbn:${isbn}`,
      url: `https://www.goodreads.com/book/isbn/${encodeURIComponent(isbn)}`,
    });
  }

  if (title) {
    queue.push({
      cacheId: `title:${normalizeTitleForCompare(title)}:${normalizeTitleForCompare(meta.author || "")}:${meta.year || ""}`,
      url: `https://www.goodreads.com/book/title?id=${encodeURIComponent(title)}`,
    });
  }

  return queue;
}

function goodreadsCacheKey(value) {
  return `cache:goodreads:v1:${hashString(value)}`;
}

export async function fetchGoodreadsFallback(meta = {}) {
  const queue = buildLookupQueue(meta);
  if (!queue.length) return undefined;

  for (const item of queue) {
    const cacheKey = goodreadsCacheKey(item.cacheId);
    const cached = await getCache(cacheKey);
    if (cached?.synopsisSource) {
      return cached;
    }

    try {
      const html = await fetchHtml(item.url);
      const parsed = parseGoodreadsFromHtml(html, meta);
      if (!parsed?.synopsisSource) continue;
      await setCache(cacheKey, parsed, GOODREADS_CACHE_TTL_MS);
      return parsed;
    } catch (_error) {
      // Ignore this lookup target and move to the next one.
    }
  }

  return undefined;
}

export { parseGoodreadsFromHtml };
