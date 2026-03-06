import { DEFAULT_SETTINGS } from "../config/constants.js";
import { buildCacheKey, normalizeQuery } from "../core/normalize.js";
import {
  AMBIGUITY_CANDIDATE_MAX,
  chooseCandidate,
  collapseBookCandidates,
  rankCandidates,
  selectAmbiguousCandidates,
} from "../core/disambiguate.js";
import { getCache, setCache } from "../core/cache.js";
import { sanitizeSynopsis, safeTemplate } from "../core/spoiler-guard.js";
import { searchOpenLibrary, fetchOpenLibraryDetails } from "../providers/openlibrary.js";
import { searchTmdb, fetchTmdbDetails } from "../providers/tmdb.js";
import { fetchTvmazeArtwork } from "../providers/tvmaze.js";
import { fetchWikipediaSummary } from "../providers/wikipedia.js";
import { fetchGoodreadsFallback } from "../providers/goodreads.js";
import { rewriteSynopsisWithOpenRouter } from "../llm/openrouter.js";

const pendingAmbiguities = new Map();
const MAX_PENDING_AMBIGUITIES = 40;

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

function buildAttribution(source, _llmUsed) {
  return source || "Unknown";
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

function buildProviderHealthNote(providerHealth) {
  if (providerHealth.tmdb === "missing_key") {
    return "TMDB is enabled but has no API key, so movie and TV matches may be limited.";
  }

  return providerHealth.tmdb === "error"
    ? "Movie/TV provider was unavailable during this lookup, so results may skew toward books."
    : undefined;
}

function buildNotFoundResponse(normalized, providerHealth) {
  if (providerHealth?.tmdb === "missing_key" && normalized?.hintType !== "book") {
    return {
      status: "not_found",
      errorCode: "TMDB_KEY_MISSING",
      message: "No synopsis found. Add a TMDB API key in Settings to improve movie and TV matches.",
    };
  }

  return {
    status: "not_found",
    errorCode: "NOT_FOUND",
    message: "No synopsis found for that title. Try a more exact title or search manually.",
  };
}

function buildLookupQuery(normalized) {
  return String(normalized.query || normalized.raw || "").trim();
}

function appendSourceAttribution(current, next) {
  const values = [current, next]
    .flatMap((part) => String(part || "").split("+"))
    .map((part) => part.trim())
    .filter(Boolean);

  const deduped = [];
  for (const value of values) {
    if (!deduped.includes(value)) deduped.push(value);
  }
  return deduped.join(" + ");
}

function trimPendingAmbiguities(limit = MAX_PENDING_AMBIGUITIES) {
  while (pendingAmbiguities.size > limit) {
    const oldestKey = pendingAmbiguities.keys().next().value;
    if (!oldestKey) return;
    pendingAmbiguities.delete(oldestKey);
  }
}

function createPendingAmbiguity({ normalized, settings, candidates, cacheKey, note }) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  pendingAmbiguities.set(requestId, {
    normalized,
    settings,
    candidates,
    cacheKey,
    note,
  });
  trimPendingAmbiguities();
  return requestId;
}

function withChooserMeta(result, { lookupQuery, canChooseAnother, reselectRequestId }) {
  const merged = {
    ...result,
    lookupQuery,
    canChooseAnother,
  };
  if (reselectRequestId) {
    merged.reselectRequestId = reselectRequestId;
  }
  return merged;
}

function toCacheableResult(result) {
  const cacheable = { ...result };
  delete cacheable.reselectRequestId;
  return cacheable;
}

function fromCachedResult(cached, settings) {
  const lookupQuery = String(cached.lookupQuery || cached.title || "").trim();
  const canChooseAnother = typeof cached.canChooseAnother === "boolean" ? cached.canChooseAnother : Boolean(lookupQuery);

  return {
    ...cached,
    lookupQuery,
    canChooseAnother,
    genreSource: cached.genreSource || "unknown",
    resultUiMode: cached.resultUiMode || settings.resultUiMode,
    fromCache: true,
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
      details.sourceAttribution = appendSourceAttribution(details.sourceAttribution, fallback.sourceAttribution);
      if (!details.author && fallback.author) details.author = fallback.author;
      if (!details.year && fallback.year) details.year = fallback.year;
      if ((!Array.isArray(details.genres) || !details.genres.length) && Array.isArray(fallback.genres)) {
        details.genres = fallback.genres;
      }
    }
  }

  if (details.mediaType === "tv" && !details.artworkUrl) {
    const tvmaze = await fetchTvmazeArtwork({
      title: details.title || candidate.title || normalized.query,
      year: details.year || candidate.year,
    }).catch(() => undefined);

    if (tvmaze?.artworkUrl) {
      details.artworkUrl = tvmaze.artworkUrl;
      details.artworkKind = tvmaze.artworkKind || "poster";
      details.sourceAttribution = appendSourceAttribution(details.sourceAttribution, tvmaze.sourceAttribution);
    }
  }

  if (details.mediaType !== "book" && settings.providerToggles.wikipedia && (!details.synopsisSource || !details.artworkUrl)) {
    const wiki = await fetchWikipediaSummary(details.title || normalized.query);
    if (wiki?.synopsisSource && !details.synopsisSource) {
      details.synopsisSource = wiki.synopsisSource;
      details.sourceAttribution = appendSourceAttribution(details.sourceAttribution, wiki.sourceAttribution);
    }
    if (wiki?.artworkUrl && !details.artworkUrl) {
      details.artworkUrl = wiki.artworkUrl;
      details.artworkKind = wiki.artworkKind || "thumbnail";
      details.sourceAttribution = appendSourceAttribution(details.sourceAttribution, wiki.sourceAttribution);
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
    artworkUrl: wiki.artworkUrl,
    artworkKind: wiki.artworkKind || "placeholder",
  };

  return applySynopsisPipeline(details, settings);
}

export async function lookupSynopsis(request) {
  const normalized = normalizeQuery(request.query || "");
  const forceAmbiguity = Boolean(request.forceAmbiguity);

  if (!normalized.query) {
    return {
      status: "error",
      errorCode: "EMPTY_SELECTION",
      message: "Select a title first, or open manual search.",
    };
  }

  const settings = await getSettings();
  const cacheKey = buildCacheKey(normalized);
  const lookupQuery = buildLookupQuery(normalized);

  const cached = await getCache(cacheKey);
  if (!forceAmbiguity && cached && !shouldBypassCachedResult(cached, settings)) {
    return {
      status: "ok",
      result: fromCachedResult(cached, settings),
    };
  }

  if (settings.localOnlyMode) {
    return {
      status: "error",
      errorCode: "LOCAL_ONLY_MISS",
      message: "No cached match was found. Turn off local-only mode in Settings or try a title you already opened before.",
    };
  }

  const { candidates, providerHealth } = await lookupCandidates(normalized, settings);

  if (!candidates.length) {
    const fallback = await lookupFallback(normalized, settings);
    if (!fallback) {
      return buildNotFoundResponse(normalized, providerHealth);
    }

    const fallbackResult = withChooserMeta(toResult(fallback, settings, false), {
      lookupQuery,
      canChooseAnother: false,
    });

    await setCache(cacheKey, toCacheableResult(fallbackResult));
    return { status: "ok", result: fallbackResult };
  }

  const ranked = rankCandidates(candidates, normalized);
  const note = buildProviderHealthNote(providerHealth);

  if (forceAmbiguity) {
    const chooserCandidates = selectAmbiguousCandidates(ranked, AMBIGUITY_CANDIDATE_MAX);
    if (chooserCandidates.length < 2) {
      return {
        status: "not_found",
        message: "No alternative matches found for that title.",
      };
    }

    const requestId = createPendingAmbiguity({
      normalized,
      settings,
      candidates: chooserCandidates,
      cacheKey,
      note,
    });

    return {
      status: "ambiguous",
      requestId,
      candidates: chooserCandidates,
      note,
    };
  }

  const decision = chooseCandidate(ranked);

  if (decision.status === "ambiguous") {
    const requestId = createPendingAmbiguity({
      normalized,
      settings,
      candidates: decision.candidates,
      cacheKey,
      note,
    });

    return {
      status: "ambiguous",
      requestId,
      candidates: decision.candidates,
      note,
    };
  }

  if (decision.status !== "resolved") {
    return buildNotFoundResponse(normalized, providerHealth);
  }

  const details = await hydrateCandidate(decision.candidate, settings, normalized);
  const final = await applySynopsisPipeline(details, settings);

  const chooserCandidates = selectAmbiguousCandidates(ranked, AMBIGUITY_CANDIDATE_MAX);
  const canChooseAnother = chooserCandidates.length > 1;
  const reselectRequestId = canChooseAnother
    ? createPendingAmbiguity({
        normalized,
        settings,
        candidates: chooserCandidates,
        cacheKey,
        note,
      })
    : undefined;

  const result = withChooserMeta(toResult(final, settings, false), {
    lookupQuery,
    canChooseAnother,
    reselectRequestId,
  });

  await setCache(cacheKey, toCacheableResult(result));

  return {
    status: "ok",
    result,
  };
}

export async function requestAlternatives(request) {
  const requestId = String(request?.requestId || "").trim();
  if (requestId) {
    const pending = pendingAmbiguities.get(requestId);
    if (pending) {
      return {
        status: "ambiguous",
        requestId,
        candidates: pending.candidates,
        note: pending.note,
      };
    }
  }

  const query = String(request?.query || "").trim();
  if (!query) {
    return {
      status: "error",
      errorCode: "MISSING_QUERY",
      message: "Could not find alternatives for this result.",
    };
  }

  return lookupSynopsis({ query, forceAmbiguity: true });
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
  const result = withChooserMeta(toResult(final, pending.settings, false), {
    lookupQuery: buildLookupQuery(pending.normalized),
    canChooseAnother: pending.candidates.length > 1,
    reselectRequestId: request.requestId,
  });

  await setCache(pending.cacheKey, toCacheableResult(result));

  return {
    status: "ok",
    result,
  };
}
