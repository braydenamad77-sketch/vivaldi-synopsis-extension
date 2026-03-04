import { REQUEST_TIMEOUT_MS } from "../config/constants.js";

const TMDB_BASE = "https://api.themoviedb.org/3";

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`TMDB request failed: ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function toYear(dateValue) {
  if (!dateValue) return undefined;
  const year = Number(String(dateValue).slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}

function topCast(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 4).map((item) => item.name).filter(Boolean);
}

export async function searchTmdb(normalizedQuery, apiKey) {
  if (!apiKey) return [];
  const query = encodeURIComponent(normalizedQuery.query || normalizedQuery.raw);
  if (!query) return [];

  const url = `${TMDB_BASE}/search/multi?api_key=${encodeURIComponent(apiKey)}&query=${query}&include_adult=false`;
  const data = await fetchJson(url);

  return (data.results || [])
    .filter((item) => item.media_type === "movie" || item.media_type === "tv")
    .slice(0, 8)
    .map((item) => ({
      id: `tmdb:${item.media_type}:${item.id}`,
      provider: "tmdb",
      mediaType: item.media_type,
      title: item.title || item.name,
      year: toYear(item.release_date || item.first_air_date),
      authorOrDirector: undefined,
    }));
}

function pickDirector(credits = {}) {
  const crew = credits.crew || [];
  return crew.find((person) => person.job === "Director")?.name;
}

export async function fetchTmdbDetails(candidate, apiKey) {
  if (!apiKey) throw new Error("TMDB API key missing");

  const [, mediaType, rawId] = String(candidate.id).split(":");
  const id = Number(rawId);

  if (!id || (mediaType !== "movie" && mediaType !== "tv")) {
    throw new Error("Invalid TMDB candidate ID");
  }

  const endpoint =
    mediaType === "movie"
      ? `${TMDB_BASE}/movie/${id}?api_key=${encodeURIComponent(apiKey)}&append_to_response=credits`
      : `${TMDB_BASE}/tv/${id}?api_key=${encodeURIComponent(apiKey)}&append_to_response=aggregate_credits`;

  const data = await fetchJson(endpoint);

  const synopsisSource = data.overview || "";
  const year = toYear(data.release_date || data.first_air_date);

  if (mediaType === "movie") {
    return {
      title: data.title || candidate.title,
      mediaType: "movie",
      year,
      directorOrCreator: pickDirector(data.credits),
      cast: topCast(data.credits?.cast),
      synopsisSource,
      sourceAttribution: "TMDB",
    };
  }

  return {
    title: data.name || candidate.title,
    mediaType: "tv",
    year,
    directorOrCreator: (data.created_by || [])[0]?.name,
    cast: topCast(data.aggregate_credits?.cast),
    synopsisSource,
    sourceAttribution: "TMDB",
  };
}
