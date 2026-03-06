import { REQUEST_TIMEOUT_MS } from "../config/constants.js";

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
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

export function extractWikipediaArtwork(summary) {
  const artworkUrl = summary?.originalimage?.source || summary?.thumbnail?.source;
  if (!artworkUrl) return undefined;

  return {
    artworkUrl,
    artworkKind: "thumbnail",
  };
}

export async function fetchWikipediaSummary(queryText) {
  const query = encodeURIComponent(queryText);
  if (!query) return undefined;

  const searchUrl = `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${query}&limit=1`;
  const search = await fetchJson(searchUrl);
  const title = search?.pages?.[0]?.title;

  if (!title) return undefined;

  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const summary = await fetchJson(summaryUrl);
  const artwork = extractWikipediaArtwork(summary);

  return {
    provider: "wikipedia",
    title: summary.title || title,
    synopsisSource: summary.extract || "",
    artworkUrl: artwork?.artworkUrl,
    artworkKind: artwork?.artworkKind,
    sourceAttribution: "Wikipedia",
  };
}
