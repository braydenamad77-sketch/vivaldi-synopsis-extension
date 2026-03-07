import { REQUEST_TIMEOUT_MS } from "../config/constants";
import type { AnyRecord, NormalizedQuery } from "../types";

async function fetchJson(url: string, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Api-User-Agent": "VivaldiSynopsisExtension/0.1",
      },
    });
    if (!response.ok) {
      throw new Error(`Wikipedia request failed: ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function extractWikipediaArtwork(summary: AnyRecord) {
  const artworkUrl = summary?.originalimage?.source || summary?.thumbnail?.source;
  if (!artworkUrl) return undefined;

  return {
    artworkUrl,
    artworkKind: "thumbnail",
  };
}

function extractYear(value: string | undefined) {
  const match = String(value || "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

export function inferWikipediaMediaType(value: string | undefined, hintType: string | undefined = undefined) {
  const text = String(value || "");
  if (/\b(book|novel|memoir|manga|comic|short story collection)\b/i.test(text)) return "book";
  if (/\b(tv|television|series|miniseries|show|episode|season)\b/i.test(text)) return "tv";
  if (/\b(film|movie|documentary|docudrama)\b/i.test(text)) return "movie";
  return hintType || "unknown";
}

export async function fetchWikipediaSummaryByTitle(title: string) {
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle) return undefined;
  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const summary = (await fetchJson(summaryUrl)) as AnyRecord;
  const artwork = extractWikipediaArtwork(summary);

  return {
    provider: "wikipedia",
    title: summary.title || normalizedTitle,
    synopsisSource: summary.extract || "",
    artworkUrl: artwork?.artworkUrl,
    artworkKind: artwork?.artworkKind,
    sourceAttribution: "Wikipedia",
  };
}

export async function searchWikipediaCandidates(normalizedQuery: NormalizedQuery, limit = 8) {
  const rawQuery = String(normalizedQuery?.query || normalizedQuery?.raw || "").trim();
  const query = encodeURIComponent(rawQuery);
  if (!query) return [];

  const searchUrl = `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${query}&limit=${limit}`;
  const search = (await fetchJson(searchUrl)) as AnyRecord;
  const pages = Array.isArray(search?.pages) ? search.pages : [];

  return pages
    .map((page: AnyRecord) => {
      const inferredType = inferWikipediaMediaType(page?.description || page?.excerpt || "", normalizedQuery?.hintType);
      const year = extractYear(page?.description || page?.excerpt || "");
      return {
        id: `wikipedia:${page?.key || page?.title || ""}`,
        provider: "wikipedia",
        mediaType: inferredType,
        title: page?.title || "",
        year,
        authorOrDirector: undefined,
        artworkUrl: page?.thumbnail?.url || undefined,
        artworkKind: page?.thumbnail?.url ? "thumbnail" : undefined,
        wikiKey: page?.key || page?.title || "",
        wikiDescription: page?.description || "",
      };
    })
    .filter((candidate) => candidate.title);
}

export async function fetchWikipediaSummary(queryText: string) {
  const candidates = await searchWikipediaCandidates({ query: queryText, raw: queryText }, 1);
  const top = candidates[0];
  if (!top?.title) return undefined;
  return fetchWikipediaSummaryByTitle(top.title);
}
