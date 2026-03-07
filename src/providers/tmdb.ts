import { REQUEST_TIMEOUT_MS } from "../config/constants";
import type { AnyRecord, Candidate, NormalizedQuery } from "../types";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const TMDB_BACKDROP_IMAGE_BASE = "https://image.tmdb.org/t/p/w780";
const TMDB_SEARCH_RESULT_LIMIT = 20;

async function fetchJson(url: string, timeoutMs = REQUEST_TIMEOUT_MS) {
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

function toYear(dateValue: string | undefined) {
  if (!dateValue) return undefined;
  const year = Number(String(dateValue).slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
}

function posterUrl(pathValue: string | undefined) {
  if (!pathValue) return undefined;
  return `${TMDB_IMAGE_BASE}${pathValue}`;
}

function backdropUrl(pathValue: string | undefined) {
  if (!pathValue) return undefined;
  return `${TMDB_BACKDROP_IMAGE_BASE}${pathValue}`;
}

function imageScore(item: AnyRecord) {
  const language = item?.iso_639_1;
  let score = 0;

  if (language === "en") score += 4;
  else if (!language) score += 3;
  else score += 1;

  score += Math.min(2, Number(item?.vote_average || 0) / 5);
  score += Math.min(1, Math.log1p(Number(item?.vote_count || 0)) / 5);
  return score;
}

function pickBestImage(items: AnyRecord[] | undefined, kind = "poster") {
  if (!Array.isArray(items) || !items.length) return undefined;

  const sorted = [...items]
    .filter((item) => item?.file_path)
    .sort((a, b) => imageScore(b) - imageScore(a));

  const picked = sorted[0];
  if (!picked?.file_path) return undefined;

  return {
    artworkUrl: kind === "poster" ? posterUrl(picked.file_path) : backdropUrl(picked.file_path),
    artworkKind: kind,
  };
}

export function pickTmdbArtwork(payload: any = {}, fallback: any = {}) {
  const directPoster = posterUrl(payload.poster_path);
  if (directPoster) {
    return {
      artworkUrl: directPoster,
      artworkKind: "poster",
    };
  }

  const fromImagesPoster = pickBestImage(payload?.images?.posters, "poster");
  if (fromImagesPoster) return fromImagesPoster;

  if (fallback.artworkUrl) {
    return {
      artworkUrl: fallback.artworkUrl,
      artworkKind: fallback.artworkKind || "poster",
    };
  }

  const backdrop = backdropUrl(payload.backdrop_path);
  if (backdrop) {
    return {
      artworkUrl: backdrop,
      artworkKind: "backdrop",
    };
  }

  return pickBestImage(payload?.images?.backdrops, "backdrop");
}

async function fetchFallbackImages(mediaType: string, id: number, apiKey: string) {
  const endpoint =
    mediaType === "movie"
      ? `${TMDB_BASE}/movie/${id}/images?api_key=${encodeURIComponent(apiKey)}&include_image_language=en,null`
      : `${TMDB_BASE}/tv/${id}/images?api_key=${encodeURIComponent(apiKey)}&include_image_language=en,null`;

  return fetchJson(endpoint);
}

function topCast(items: AnyRecord[] | undefined) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 4).map((item) => item.name).filter(Boolean);
}

function topGenres(genres: AnyRecord[] | undefined) {
  if (!Array.isArray(genres)) return [];
  return genres
    .map((item) => item?.name)
    .filter(Boolean)
    .slice(0, 2);
}

export async function searchTmdb(normalizedQuery: NormalizedQuery, apiKey: string): Promise<Candidate[]> {
  if (!apiKey) return [];
  const rawQuery = String(normalizedQuery.query || normalizedQuery.raw || "").trim();
  if (!rawQuery) return [];
  const query = encodeURIComponent(rawQuery);

  const url = `${TMDB_BASE}/search/multi?api_key=${encodeURIComponent(apiKey)}&query=${query}&include_adult=false`;
  const data = (await fetchJson(url)) as AnyRecord;

  return (data.results || [])
    .filter((item: AnyRecord) => item.media_type === "movie" || item.media_type === "tv")
    .slice(0, TMDB_SEARCH_RESULT_LIMIT)
    .map((item: AnyRecord) => ({
      id: `tmdb:${item.media_type}:${item.id}`,
      provider: "tmdb",
      mediaType: item.media_type,
      title: item.title || item.name,
      year: toYear(item.release_date || item.first_air_date),
      authorOrDirector: undefined,
      popularity: Number(item.popularity || 0),
      voteCount: Number(item.vote_count || 0),
      artworkUrl: posterUrl(item.poster_path) || backdropUrl(item.backdrop_path),
      artworkKind: item.poster_path ? "poster" : item.backdrop_path ? "backdrop" : undefined,
    }));
}

function pickDirector(credits: any = {}) {
  const crew = credits.crew || [];
  return crew.find((person: AnyRecord) => person.job === "Director")?.name;
}

export async function fetchTmdbDetails(candidate: Candidate, apiKey: string) {
  if (!apiKey) throw new Error("TMDB API key missing");

  const [, mediaType, rawId] = String(candidate.id).split(":");
  const id = Number(rawId);

  if (!id || (mediaType !== "movie" && mediaType !== "tv")) {
    throw new Error("Invalid TMDB candidate ID");
  }

  const endpoint =
    mediaType === "movie"
      ? `${TMDB_BASE}/movie/${id}?api_key=${encodeURIComponent(apiKey)}&append_to_response=credits,images&include_image_language=en,null`
      : `${TMDB_BASE}/tv/${id}?api_key=${encodeURIComponent(apiKey)}&append_to_response=aggregate_credits,images&include_image_language=en,null`;

  const data = (await fetchJson(endpoint)) as AnyRecord;
  let artwork = pickTmdbArtwork(data, candidate);
  if (!artwork?.artworkUrl) {
    const fallbackImages = await fetchFallbackImages(mediaType, id, apiKey).catch(() => undefined);
    artwork = pickTmdbArtwork({ images: fallbackImages }, candidate);
  }

  const synopsisSource = data.overview || "";
  const year = toYear(data.release_date || data.first_air_date);

  if (mediaType === "movie") {
    return {
      title: data.title || candidate.title,
      mediaType: "movie",
      year,
      directorOrCreator: pickDirector(data.credits),
      cast: topCast(data.credits?.cast),
      genres: topGenres(data.genres),
      synopsisSource,
      artworkUrl: artwork?.artworkUrl,
      artworkKind: artwork?.artworkKind || "placeholder",
      sourceAttribution: "TMDB",
    };
  }

  return {
    title: data.name || candidate.title,
    mediaType: "tv",
    year,
    directorOrCreator: (data.created_by || [])[0]?.name,
    cast: topCast(data.aggregate_credits?.cast),
    genres: topGenres(data.genres),
    synopsisSource,
    artworkUrl: artwork?.artworkUrl,
    artworkKind: artwork?.artworkKind || "placeholder",
    sourceAttribution: "TMDB",
  };
}
