import { DEFAULT_SETTINGS } from "../config/constants.js";
import { buildCacheKey, normalizeQuery } from "../core/normalize.js";
import { chooseCandidate, collapseBookCandidates, rankCandidates } from "../core/disambiguate.js";
import { getCache, setCache } from "../core/cache.js";
import { sanitizeSynopsis, safeTemplate } from "../core/spoiler-guard.js";
import { searchOpenLibrary, fetchOpenLibraryDetails } from "../providers/openlibrary.js";
import { searchTmdb, fetchTmdbDetails } from "../providers/tmdb.js";
import { fetchWikipediaSummary } from "../providers/wikipedia.js";
import { fetchGoodreadsFallback } from "../providers/goodreads.js";
import { rewriteSynopsisWithOpenRouter } from "../llm/openrouter.js";

const pendingAmbiguities = new Map();

function mergeSettings(stored) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(stored || {}),
    providerToggles: {
      ...DEFAULT_SETTINGS.providerToggles,
      ...(stored?.providerToggles || {}),
    },
  };

  // Backward compatibility for older saved values.
  if (merged.resultUiMode === "panel") merged.resultUiMode = "with_image";
  if (merged.resultUiMode === "compact") merged.resultUiMode = "without_image";

  return merged;
}

export async function getSettings() {
  const payload = await chrome.storage.local.get("settings");
  return mergeSettings(payload.settings);
}

function buildAttribution(source, llmUsed) {
  return llmUsed ? `${source} + OpenRouter` : source;
}

function shouldBypassCachedResult(cached, settings) {
  if (!cached) return false;
  if (settings.resultUiMode !== "with_image") return false;
  if (!cached.mediaType) return false;

  const mediaSupportsArtwork = cached.mediaType === "movie" || cached.mediaType === "tv" || cached.mediaType === "book";
  if (!mediaSupportsArtwork) return false;

  return !cached.artworkUrl;
}

function mediaTypeLabel(mediaType) {
  if (mediaType === "movie") return "MOVIE";
  if (mediaType === "tv") return "TV";
  if (mediaType === "book") return "BOOK";
  return "MEDIA";
}

function buildGenreLabel(details) {
  const genres = Array.isArray(details.genres) ? details.genres.filter(Boolean) : [];
  if (!genres.length) return undefined;
  return genres.slice(0, 2).join(" / ");
}

function buildGenreSource(details, genreLabel) {
  if (!genreLabel) return "unknown";
  if (details.genreSource === "ai") return "ai";
  if (details.genreSource === "provider") return "provider";
  return "unknown";
}

function buildTags(details) {
  const secondaryTag = details.year ? String(details.year) : undefined;
  const directorOrCreatorTag = details.directorOrCreator
    ? `DIRECTOR/CREATOR: ${String(details.directorOrCreator).toUpperCase()}`
    : undefined;
  const authorTag = details.author ? `AUTHOR: ${String(details.author).toUpperCase()}` : undefined;
  const castTag =
    Array.isArray(details.cast) && details.cast.length
      ? `CAST: ${details.cast.slice(0, 4).join(", ").toUpperCase()}`
      : undefined;

  return {
    primaryTag: mediaTypeLabel(details.mediaType),
    secondaryTag,
    directorOrCreatorTag,
    authorTag,
    castTag,
  };
}

async function lookupCandidates(normalized, settings) {
  const jobs = [];
  const providerHealth = {
    openlibrary: settings.providerToggles.openlibrary ? "enabled" : "disabled",
    tmdb: settings.providerToggles.tmdb ? (settings.tmdbApiKey ? "enabled" : "missing_key") : "disabled",
  };

  if (settings.providerToggles.openlibrary) {
    jobs.push({ provider: "openlibrary", promise: searchOpenLibrary(normalized) });
  }

  if (settings.providerToggles.tmdb && settings.tmdbApiKey) {
    jobs.push({ provider: "tmdb", promise: searchTmdb(normalized, settings.tmdbApiKey) });
  }

  const settled = await Promise.allSettled(jobs.map((job) => job.promise));
  const combined = [];

  settled.forEach((result, index) => {
    const provider = jobs[index].provider;
    if (result.status === "fulfilled") {
      providerHealth[provider] = "ok";
      combined.push(...(result.value || []));
      return;
    }
    providerHealth[provider] = "error";
  });

  return {
    candidates: collapseBookCandidates(combined.filter(Boolean)),
    providerHealth,
  };
}

async function hydrateCandidate(candidate, settings, normalized) {
  let details;

  if (candidate.provider === "openlibrary") {
    details = await fetchOpenLibraryDetails(candidate);
  } else if (candidate.provider === "tmdb") {
    details = await fetchTmdbDetails(candidate, settings.tmdbApiKey);
  } else {
    details = {
      title: candidate.title,
      mediaType: candidate.mediaType,
      year: candidate.year,
      sourceAttribution: "Unknown",
      synopsisSource: "",
      cast: [],
      artworkUrl: candidate.artworkUrl,
      artworkKind: candidate.artworkKind || "placeholder",
    };
  }

  if (details.mediaType === "book" && !details.synopsisSource) {
    const fallback = await fetchGoodreadsFallback({
      title: details.title || candidate.title || normalized.query,
      author: details.author || candidate.authorOrDirector,
      year: details.year || candidate.year,
      goodreadsIds: details.goodreadsIds || candidate.goodreadsIds,
      isbn10: details.isbn10 || candidate.isbn10,
      isbn13: details.isbn13 || candidate.isbn13,
    });

    if (fallback?.synopsisSource) {
      details.synopsisSource = fallback.synopsisSource;
      details.sourceAttribution = `${details.sourceAttribution} + ${fallback.sourceAttribution}`;
      if (!details.author && fallback.author) details.author = fallback.author;
      if (!details.year && fallback.year) details.year = fallback.year;
      if ((!Array.isArray(details.genres) || !details.genres.length) && Array.isArray(fallback.genres)) {
        details.genres = fallback.genres;
      }
    }
  }

  if (!details.synopsisSource && details.mediaType !== "book" && settings.providerToggles.wikipedia) {
    const wiki = await fetchWikipediaSummary(details.title || normalized.query);
    if (wiki?.synopsisSource) {
      details.synopsisSource = wiki.synopsisSource;
      details.sourceAttribution = `${details.sourceAttribution} + ${wiki.sourceAttribution}`;
    }
  }

  return details;
}

async function applySynopsisPipeline(details, settings) {
  const baseText = sanitizeSynopsis(details.synopsisSource || "", details);
  let synopsis = baseText || safeTemplate(details);
  let llmUsed = false;
  let fallbackGenres = [];
  const providerGenres = Array.isArray(details.genres) ? details.genres.filter(Boolean) : [];

  if (settings.llmEnabled && settings.openrouterApiKey && (settings.llmPreferred || !details.synopsisSource)) {
    try {
      const rewritten = await rewriteSynopsisWithOpenRouter(
        {
          title: details.title,
          mediaType: details.mediaType,
          year: details.year,
          author: details.author,
          directorOrCreator: details.directorOrCreator,
          cast: details.cast,
          synopsis,
        },
        settings,
      );
      if (rewritten?.synopsis) {
        synopsis = sanitizeSynopsis(rewritten.synopsis, details);
      }
      fallbackGenres = Array.isArray(rewritten?.predictedGenres) ? rewritten.predictedGenres.filter(Boolean).slice(0, 2) : [];
      llmUsed = true;
    } catch (_error) {
      synopsis = sanitizeSynopsis(synopsis, details);
    }
  }

  return {
    ...details,
    synopsis,
    genres: providerGenres.length ? providerGenres : fallbackGenres,
    genreSource: providerGenres.length ? "provider" : fallbackGenres.length ? "ai" : "unknown",
    sourceAttribution: buildAttribution(details.sourceAttribution, llmUsed),
    artworkKind: details.artworkUrl ? details.artworkKind || "poster" : "placeholder",
  };
}

function toResult(details, settings, fromCache = false) {
  const tags = buildTags(details);
  const genreLabel = buildGenreLabel(details);
  const genreSource = buildGenreSource(details, genreLabel);
  return {
    title: details.title,
    mediaType: details.mediaType,
    year: details.year,
    author: details.author,
    directorOrCreator: details.directorOrCreator,
    cast: details.cast || [],
    synopsis: details.synopsis,
    sourceAttribution: details.sourceAttribution,
    artworkUrl: details.artworkUrl,
    artworkKind: details.artworkKind || "placeholder",
    genreLabel,
    genreSource,
    resultUiMode: settings.resultUiMode,
    ...tags,
    fromCache,
  };
}

async function lookupFallback(normalized, settings) {
  if (normalized.hintType === "book") {
    const fallback = await fetchGoodreadsFallback({
      title: normalized.query || normalized.raw,
      year: normalized.hintYear,
    });
    if (!fallback?.synopsisSource) return undefined;

    const details = {
      title: fallback.title || normalized.query,
      mediaType: "book",
      year: fallback.year || normalized.hintYear,
      synopsisSource: fallback.synopsisSource,
      sourceAttribution: fallback.sourceAttribution,
      author: fallback.author,
      directorOrCreator: undefined,
      cast: [],
      genres: fallback.genres || [],
      artworkUrl: undefined,
      artworkKind: "placeholder",
    };

    return applySynopsisPipeline(details, settings);
  }

  if (!settings.providerToggles.wikipedia) return undefined;

  const wiki = await fetchWikipediaSummary(normalized.query || normalized.raw);
  if (!wiki?.synopsisSource) return undefined;

  const details = {
    title: wiki.title || normalized.query,
    mediaType: normalized.hintType || "movie",
    year: normalized.hintYear,
    synopsisSource: wiki.synopsisSource,
    sourceAttribution: wiki.sourceAttribution,
    author: undefined,
    directorOrCreator: undefined,
    cast: [],
    artworkUrl: undefined,
    artworkKind: "placeholder",
  };

  return applySynopsisPipeline(details, settings);
}

export async function lookupSynopsis(request) {
  const normalized = normalizeQuery(request.query || "");
  if (!normalized.query) {
    return {
      status: "error",
      errorCode: "EMPTY_SELECTION",
      message: "Select a title first.",
    };
  }

  const settings = await getSettings();
  const cacheKey = buildCacheKey(normalized);

  const cached = await getCache(cacheKey);
  if (cached && !shouldBypassCachedResult(cached, settings)) {
    return {
      status: "ok",
      result: {
        ...cached,
        genreSource: cached.genreSource || "unknown",
        resultUiMode: cached.resultUiMode || settings.resultUiMode,
        fromCache: true,
      },
    };
  }

  if (settings.localOnlyMode) {
    return {
      status: "error",
      errorCode: "LOCAL_ONLY_MISS",
      message: "Unavailable in local-only mode without a cached match.",
    };
  }

  const { candidates, providerHealth } = await lookupCandidates(normalized, settings);

  if (!candidates.length) {
    const fallback = await lookupFallback(normalized, settings);
    if (!fallback) {
      return {
        status: "not_found",
        message: "No synopsis found for that title.",
      };
    }

    const fallbackResult = toResult(fallback, settings, false);
    await setCache(cacheKey, fallbackResult);
    return { status: "ok", result: fallbackResult };
  }

  const ranked = rankCandidates(candidates, normalized);
  const decision = chooseCandidate(ranked);

  if (decision.status === "ambiguous") {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingAmbiguities.set(requestId, {
      normalized,
      settings,
      candidates: decision.candidates,
      cacheKey,
    });

    return {
      status: "ambiguous",
      requestId,
      candidates: decision.candidates,
      note:
        providerHealth.tmdb === "error"
          ? "Movie/TV provider was unavailable during this lookup, so results may skew toward books."
          : undefined,
    };
  }

  if (decision.status !== "resolved") {
    return {
      status: "not_found",
      message: "No synopsis found for that title.",
    };
  }

  const details = await hydrateCandidate(decision.candidate, settings, normalized);
  const final = await applySynopsisPipeline(details, settings);
  const result = toResult(final, settings, false);

  await setCache(cacheKey, result);

  return {
    status: "ok",
    result,
  };
}

export async function resolveAmbiguity(request) {
  const pending = pendingAmbiguities.get(request.requestId);
  if (!pending) {
    return {
      status: "error",
      errorCode: "AMBIGUITY_EXPIRED",
      message: "This selection expired. Try again.",
    };
  }

  const selected = pending.candidates.find((candidate) => candidate.id === request.selectedCandidateId);
  if (!selected) {
    return {
      status: "error",
      errorCode: "INVALID_SELECTION",
      message: "Invalid selection.",
    };
  }

  const details = await hydrateCandidate(selected, pending.settings, pending.normalized);
  const final = await applySynopsisPipeline(details, pending.settings);
  const result = toResult(final, pending.settings, false);

  await setCache(pending.cacheKey, result);
  pendingAmbiguities.delete(request.requestId);

  return {
    status: "ok",
    result,
  };
}
