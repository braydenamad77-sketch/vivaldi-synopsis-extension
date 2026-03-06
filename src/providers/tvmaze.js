import { REQUEST_TIMEOUT_MS } from "../config/constants.js";
import { normalizeTitleForCompare } from "../core/normalize.js";

const TVMAZE_BASE = "https://api.tvmaze.com";

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`TVmaze request failed: ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function toYear(value) {
  if (!value) return undefined;
  const year = Number(String(value).slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}

function artworkFromShow(show) {
  const image = show?.image;
  const artworkUrl = image?.original || image?.medium;
  if (!artworkUrl) return undefined;

  return {
    artworkUrl,
    artworkKind: "poster",
    sourceAttribution: "TVmaze",
  };
}

function scoreTvmazeCandidate(entry, expected = {}) {
  const show = entry?.show || {};
  const expectedTitle = normalizeTitleForCompare(expected.title || "");
  const actualTitle = normalizeTitleForCompare(show.name || "");
  const expectedYear = Number(expected.year) || undefined;
  const actualYear = toYear(show.premiered);

  let score = Number(entry?.score || 0);
  if (expectedTitle && actualTitle === expectedTitle) score += 3;
  if (expectedTitle && actualTitle.startsWith(expectedTitle)) score += 1;
  if (expectedYear && actualYear) {
    const diff = Math.abs(expectedYear - actualYear);
    if (diff === 0) score += 1.5;
    else if (diff <= 1) score += 0.7;
    else if (diff <= 3) score += 0.2;
  }
  if (show.image?.original || show.image?.medium) score += 0.5;
  return score;
}

export function pickBestTvmazeCandidate(results, expected = {}) {
  if (!Array.isArray(results) || !results.length) return undefined;

  return results
    .filter((entry) => entry?.show?.name)
    .map((entry) => ({ entry, score: scoreTvmazeCandidate(entry, expected) }))
    .sort((a, b) => b.score - a.score)[0]?.entry;
}

function pickBestTvmazeImage(images) {
  if (!Array.isArray(images) || !images.length) return undefined;

  const ranked = images
    .filter((item) => item?.resolutions?.original?.url || item?.resolutions?.medium?.url)
    .sort((a, b) => {
      const aMain = a?.main ? 1 : 0;
      const bMain = b?.main ? 1 : 0;
      if (bMain !== aMain) return bMain - aMain;
      return 0;
    });

  const chosen = ranked[0];
  if (!chosen) return undefined;

  return {
    artworkUrl: chosen.resolutions?.original?.url || chosen.resolutions?.medium?.url,
    artworkKind: "poster",
    sourceAttribution: "TVmaze",
  };
}

export async function fetchTvmazeArtwork(expected = {}) {
  const query = encodeURIComponent(expected.title || "");
  if (!query) return undefined;

  const results = await fetchJson(`${TVMAZE_BASE}/search/shows?q=${query}`);
  const picked = pickBestTvmazeCandidate(results, expected);
  if (!picked?.show?.id) return undefined;

  const directArtwork = artworkFromShow(picked.show);
  if (directArtwork) return directArtwork;

  try {
    const images = await fetchJson(`${TVMAZE_BASE}/shows/${picked.show.id}/images`);
    return pickBestTvmazeImage(images);
  } catch (_error) {
    return undefined;
  }
}
