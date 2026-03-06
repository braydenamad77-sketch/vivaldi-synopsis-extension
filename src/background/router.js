import { DEFAULT_SETTINGS, LLM_SOURCE_TEXT_MAX_WORDS } from "../config/constants.js";
import { buildCacheKey, normalizeQuery } from "../core/normalize.js";
import {
  AMBIGUITY_CANDIDATE_MAX,
  chooseCandidate,
  collapseBookCandidates,
  rankCandidates,
  selectAmbiguousCandidates,
} from "../core/disambiguate.js";
import { getCache, setCache } from "../core/cache.js";
import { mirrorCacheEntryToCompanionApp } from "../core/companion-app.js";
import { appendDebugEvent, getDebugState } from "../debug/store.js";
import { pickRandomGoodreadsTestSeed } from "../debug/goodreads-test-seeds.js";
import { sanitizeSynopsis, safeTemplate, trimToWordLimit } from "../core/spoiler-guard.js";
import { searchOpenLibrary, fetchOpenLibraryDetails } from "../providers/openlibrary.js";
import { searchTmdb, fetchTmdbDetails } from "../providers/tmdb.js";
import { fetchTvmazeArtwork } from "../providers/tvmaze.js";
import { fetchWikipediaSummaryByTitle, searchWikipediaCandidates } from "../providers/wikipedia.js";
import { fetchGoodreadsFallback } from "../providers/goodreads.js";
import { rewriteSynopsisWithOpenRouter } from "../llm/openrouter.js";
import { normalizeTitleForCompare } from "../core/normalize.js";

const pendingAmbiguities = new Map();
const MAX_PENDING_AMBIGUITIES = 40;
const WIKIPEDIA_FALLBACK_LIMIT = 8;
const WIKIPEDIA_WIDE_SEARCH_LIMIT = 10;

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
      lookupQuery: buildLookupQuery(normalized),
      allowWideSearch: true,
    };
  }

  return {
    status: "not_found",
    errorCode: "NOT_FOUND",
    message: "No synopsis found for that title. Try a more exact title or search manually.",
    lookupQuery: buildLookupQuery(normalized),
    allowWideSearch: true,
  };
}

function buildLookupQuery(normalized) {
  return String(normalized.query || normalized.raw || "").trim();
}

function debugCandidateLabel(candidate) {
  if (!candidate) return "";
  return [candidate.title, candidate.mediaType, candidate.year, candidate.provider].filter(Boolean).join(" | ");
}

async function appendLookupDebugEvent(event) {
  const debugState = await getDebugState();
  if (!debugState.enabled) return;

  await appendDebugEvent({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    kind: "lookup",
    title: event.chosenTitle || event.query || "Lookup",
    ...event,
  });
}

export function chooseWikipediaFallbackCandidate(ranked, normalized) {
  if (!ranked?.length) {
    return {
      status: "rejected",
      reason: "no_candidates",
    };
  }

  const [top, second] = ranked;
  const normalizedQuery = normalizeTitleForCompare(normalized?.query || normalized?.raw || "");
  const normalizedTitle = normalizeTitleForCompare(top.title);
  const gap = second ? Number((top.score - second.score).toFixed(6)) : top.score;
  const description = String(top.wikiDescription || "");
  const looksDisambiguation =
    /\b(topics referred to by the same term|may refer to|disambiguation)\b/i.test(description);

  if (looksDisambiguation) {
    return {
      status: "rejected",
      reason: "disambiguation_page",
      candidate: top,
      gap,
    };
  }

  if (normalizedQuery && normalizedTitle === normalizedQuery && top.score >= 1) {
    return {
      status: "resolved",
      candidate: top,
      gap,
    };
  }

  return {
    status: "rejected",
    reason: "low_title_confidence",
    candidate: top,
    gap,
  };
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
    wikipedia: settings.providerToggles.wikipedia ? "enabled" : "disabled",
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

async function lookupWikipediaCandidates(normalized, settings, providerHealth, limit = WIKIPEDIA_FALLBACK_LIMIT) {
  if (!settings.providerToggles.wikipedia) return [];

  try {
    const candidates = await searchWikipediaCandidates(normalized, limit);
    providerHealth.wikipedia = "ok";
    return candidates;
  } catch (_error) {
    providerHealth.wikipedia = "error";
    return [];
  }
}

function mergeCandidates(primaryCandidates, wikiCandidates) {
  const seen = new Set();
  const merged = [];

  for (const candidate of [...primaryCandidates, ...wikiCandidates]) {
    if (!candidate?.id) continue;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    merged.push(candidate);
  }

  return collapseBookCandidates(merged);
}

async function hydrateCandidate(candidate, settings, normalized) {
  let details;
  const providerTrace = [];

  if (candidate.provider === "openlibrary") {
    details = await fetchOpenLibraryDetails(candidate);
    providerTrace.push({
      step: "openlibrary_details",
      status: details.synopsisSource ? "ok" : "missing_synopsis",
      title: details.title,
      hasArtwork: Boolean(details.artworkUrl),
    });
  } else if (candidate.provider === "tmdb") {
    details = await fetchTmdbDetails(candidate, settings.tmdbApiKey);
    providerTrace.push({
      step: "tmdb_details",
      status: "ok",
      title: details.title,
      hasSynopsis: Boolean(details.synopsisSource),
      hasArtwork: Boolean(details.artworkUrl),
    });
  } else if (candidate.provider === "wikipedia") {
    const wiki = await fetchWikipediaSummaryByTitle(candidate.title);
    details = {
      title: wiki?.title || candidate.title,
      mediaType: candidate.mediaType === "unknown" ? normalized.hintType || "movie" : candidate.mediaType,
      year: candidate.year || normalized.hintYear,
      sourceAttribution: wiki?.sourceAttribution || "Wikipedia",
      synopsisSource: wiki?.synopsisSource || "",
      cast: [],
      artworkUrl: wiki?.artworkUrl || candidate.artworkUrl,
      artworkKind: wiki?.artworkKind || candidate.artworkKind || "placeholder",
      directorOrCreator: undefined,
      author: undefined,
      genres: [],
    };
    providerTrace.push({
      step: "wikipedia_details",
      status: details.synopsisSource ? "ok" : "missing_synopsis",
      title: details.title,
      hasArtwork: Boolean(details.artworkUrl),
    });
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
    providerTrace.push({
      step: "candidate_seed",
      status: "unknown",
      title: details.title,
      hasArtwork: Boolean(details.artworkUrl),
    });
  }

  if (details.mediaType === "book" && !details.synopsisSource) {
    const fallback = await fetchGoodreadsFallback({
      title: details.title || candidate.title || normalized.query,
      author: details.author || candidate.authorOrDirector,
      year: details.year || candidate.year,
      goodreadsIds: details.goodreadsIds || candidate.goodreadsIds,
      isbn10: details.isbn10 || candidate.isbn10,
      isbn13: details.isbn13 || candidate.isbn13,
    }, settings);

    if (fallback?.synopsisSource) {
      details.synopsisSource = fallback.synopsisSource;
      details.sourceAttribution = appendSourceAttribution(details.sourceAttribution, fallback.sourceAttribution);
      if (!details.author && fallback.author) details.author = fallback.author;
      if (!details.year && fallback.year) details.year = fallback.year;
      if ((!Array.isArray(details.genres) || !details.genres.length) && Array.isArray(fallback.genres)) {
        details.genres = fallback.genres;
      }
      providerTrace.push({
        step: "goodreads_visual_fallback",
        status: "ok",
        title: fallback.title || details.title,
        author: fallback.author,
        resolvedUrl: fallback.resolvedUrl,
        screenshotsCaptured: fallback.screenshotsCaptured || 0,
      });
    } else {
      providerTrace.push({
        step: "goodreads_visual_fallback",
        status: fallback?.status || "missing_synopsis",
        title: details.title,
        author: details.author || candidate.authorOrDirector,
        resolvedUrl: fallback?.resolvedUrl,
        screenshotsCaptured: fallback?.screenshotsCaptured || 0,
        detail: fallback?.debug || {},
      });
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
      providerTrace.push({
        step: "tvmaze_artwork",
        status: "ok",
      });
    } else {
      providerTrace.push({
        step: "tvmaze_artwork",
        status: "no_artwork",
      });
    }
  }

  if (details.mediaType !== "book" && settings.providerToggles.wikipedia && (!details.synopsisSource || !details.artworkUrl)) {
    const hadSynopsisBeforeWiki = Boolean(details.synopsisSource);
    const hadArtworkBeforeWiki = Boolean(details.artworkUrl);
    const wiki = await fetchWikipediaSummaryByTitle(details.title || normalized.query);
    if (wiki?.synopsisSource && !details.synopsisSource) {
      details.synopsisSource = wiki.synopsisSource;
      details.sourceAttribution = appendSourceAttribution(details.sourceAttribution, wiki.sourceAttribution);
    }
    if (wiki?.artworkUrl && !details.artworkUrl) {
      details.artworkUrl = wiki.artworkUrl;
      details.artworkKind = wiki.artworkKind || "thumbnail";
      details.sourceAttribution = appendSourceAttribution(details.sourceAttribution, wiki.sourceAttribution);
    }
    providerTrace.push({
      step: "wikipedia_enrichment",
      status: wiki?.synopsisSource || wiki?.artworkUrl ? "ok" : "no_enrichment",
      addedSynopsis: Boolean(wiki?.synopsisSource && !hadSynopsisBeforeWiki),
      addedArtwork: Boolean(wiki?.artworkUrl && !hadArtworkBeforeWiki),
    });
  }

  return {
    ...details,
    providerTrace,
  };
}

async function applySynopsisPipeline(details, settings) {
  const rawProviderText = String(details.synopsisSource || "").trim();
  const llmSourceText = rawProviderText ? trimToWordLimit(rawProviderText, LLM_SOURCE_TEXT_MAX_WORDS) : "";
  const fallbackSynopsis = sanitizeSynopsis(rawProviderText, details) || safeTemplate(details);
  let synopsis = fallbackSynopsis;
  let llmUsed = false;
  let fallbackGenres = [];
  const providerGenres = Array.isArray(details.genres) ? details.genres.filter(Boolean) : [];
  const providerTrace = Array.isArray(details.providerTrace) ? [...details.providerTrace] : [];

  if (!rawProviderText) {
    providerTrace.push({
      step: "llm_rewrite",
      status: "skipped_empty_source",
    });
  } else if (settings.llmEnabled && settings.openrouterApiKey && (settings.llmPreferred || !details.synopsisSource)) {
    try {
      const rewritten = await rewriteSynopsisWithOpenRouter(
        {
          title: details.title,
          mediaType: details.mediaType,
          year: details.year,
          author: details.author,
          directorOrCreator: details.directorOrCreator,
          cast: details.cast,
          rawSourceText: rawProviderText,
          synopsis: llmSourceText,
        },
        settings,
      );
      if (rewritten?.synopsis?.trim()) {
        synopsis = rewritten.synopsis.trim();
        fallbackGenres = Array.isArray(rewritten?.predictedGenres) ? rewritten.predictedGenres.filter(Boolean).slice(0, 2) : [];
        llmUsed = true;
        providerTrace.push({
          step: "llm_rewrite",
          status: "ok",
        });
      }
    } catch (_error) {
      synopsis = fallbackSynopsis;
      providerTrace.push({
        step: "llm_rewrite",
        status: "error",
      });
    }
  } else {
    providerTrace.push({
      step: "llm_rewrite",
      status: "skipped_disabled_or_not_needed",
    });
  }

  return {
    ...details,
    synopsis,
    genres: providerGenres.length ? providerGenres : fallbackGenres,
    genreSource: providerGenres.length ? "provider" : fallbackGenres.length ? "ai" : "unknown",
    sourceAttribution: buildAttribution(details.sourceAttribution, llmUsed),
    artworkKind: details.artworkUrl ? details.artworkKind || "poster" : "placeholder",
    providerTrace,
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

async function lookupFallback(normalized, settings, providerHealth) {
  if (normalized.hintType === "book") {
    const fallback = await fetchGoodreadsFallback({
      title: normalized.query || normalized.raw,
      year: normalized.hintYear,
    }, settings);
    if (!fallback?.synopsisSource) {
      return {
        details: undefined,
        debug: {
          kind: "goodreads_visual",
          accepted: false,
          reason: fallback?.status || "missing_synopsis",
          detail: fallback?.debug || {},
          resolvedUrl: fallback?.resolvedUrl,
          screenshotsCaptured: fallback?.screenshotsCaptured || 0,
        },
      };
    }

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
      providerTrace: [
        {
          step: "goodreads_visual_fallback",
          status: "ok",
          title: fallback.title || normalized.query,
          author: fallback.author,
          resolvedUrl: fallback.resolvedUrl,
          screenshotsCaptured: fallback.screenshotsCaptured || 0,
        },
      ],
    };

    const finalDetails = await applySynopsisPipeline(details, settings);
    return {
      details: finalDetails,
      debug: {
        kind: "goodreads_visual",
        accepted: true,
        title: details.title,
        resolvedUrl: fallback.resolvedUrl,
        screenshotsCaptured: fallback.screenshotsCaptured || 0,
        providerTrace: finalDetails.providerTrace || [],
      },
    };
  }

  if (!settings.providerToggles.wikipedia) {
    return {
      details: undefined,
      debug: {
        kind: "wikipedia",
        accepted: false,
        reason: "disabled",
      },
    };
  }

  const wikiCandidates = await lookupWikipediaCandidates(normalized, settings, providerHealth, WIKIPEDIA_FALLBACK_LIMIT);
  const ranked = rankCandidates(wikiCandidates, normalized);
  const decision = chooseWikipediaFallbackCandidate(ranked, normalized);
  if (decision.status !== "resolved") {
    return {
      details: undefined,
      debug: {
        kind: "wikipedia",
        accepted: false,
        reason: decision.reason,
        topCandidate: debugCandidateLabel(decision.candidate),
        rankedCandidates: ranked.slice(0, 5).map(debugCandidateLabel),
      },
    };
  }

  const details = await hydrateCandidate(decision.candidate, settings, normalized);
  const finalDetails = await applySynopsisPipeline(details, settings);
  return {
    details: finalDetails,
    debug: {
      kind: "wikipedia",
      accepted: true,
      title: details.title,
      rankedCandidates: ranked.slice(0, 5).map(debugCandidateLabel),
      providerTrace: finalDetails.providerTrace || [],
    },
  };
}

async function buildWideSearchAmbiguity({ normalized, settings, providerHealth, primaryCandidates, cacheKey, note }) {
  const wikiCandidates = await lookupWikipediaCandidates(normalized, settings, providerHealth, WIKIPEDIA_WIDE_SEARCH_LIMIT);
  const combined = mergeCandidates(primaryCandidates, wikiCandidates);
  const ranked = rankCandidates(combined, normalized);
  const chooserCandidates = selectAmbiguousCandidates(ranked, AMBIGUITY_CANDIDATE_MAX);

  if (!chooserCandidates.length) {
    return {
      status: "not_found",
      message: "No low-confidence matches were found for that title.",
      lookupQuery: buildLookupQuery(normalized),
      allowWideSearch: false,
      debug: {
        wikiCandidateCount: wikiCandidates.length,
        rankedCandidates: ranked.slice(0, 6).map(debugCandidateLabel),
      },
    };
  }

  const requestId = createPendingAmbiguity({
    normalized,
    settings,
    candidates: chooserCandidates,
    cacheKey,
    note: note || "Wider Search: lower-confidence matches",
  });

  return {
    status: "ambiguous",
    requestId,
    candidates: chooserCandidates,
    note: note || "Wider Search: lower-confidence matches",
    debug: {
      wikiCandidateCount: wikiCandidates.length,
      rankedCandidates: ranked.slice(0, 6).map(debugCandidateLabel),
    },
  };
}

export async function lookupSynopsis(request) {
  const normalized = normalizeQuery(request.query || "");
  const forceAmbiguity = Boolean(request.forceAmbiguity);
  const widerSearch = Boolean(request.widerSearch);

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
  if (!forceAmbiguity && !widerSearch && cached && !shouldBypassCachedResult(cached, settings)) {
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
  const note = buildProviderHealthNote(providerHealth);

  if (widerSearch) {
    const wide = await buildWideSearchAmbiguity({
      normalized,
      settings,
      providerHealth,
      primaryCandidates: candidates,
      cacheKey,
      note,
    });
    await appendLookupDebugEvent({
      status: wide.status,
      query: lookupQuery,
      lookupMode: "wider_search",
      normalizedQuery: normalized,
      providerHealth,
      primaryCandidateCount: candidates.length,
      chosenTitle: "",
      detail: wide.debug || {},
    });
    if (wide.status === "ambiguous") {
      return {
        status: "ambiguous",
        requestId: wide.requestId,
        candidates: wide.candidates,
        note: wide.note,
      };
    }
    return wide;
  }

  if (!candidates.length) {
    const fallback = await lookupFallback(normalized, settings, providerHealth);
    if (!fallback?.details) {
      const notFound = buildNotFoundResponse(normalized, providerHealth);
      await appendLookupDebugEvent({
        status: "not_found",
        query: lookupQuery,
        lookupMode: "default",
        normalizedQuery: normalized,
        providerHealth,
        primaryCandidateCount: 0,
        chosenTitle: "",
        detail: fallback?.debug || {},
      });
      return notFound;
    }

    const fallbackResult = withChooserMeta(toResult(fallback.details, settings, false), {
      lookupQuery,
      canChooseAnother: false,
    });

    await setCache(cacheKey, toCacheableResult(fallbackResult));
    await mirrorCacheEntryToCompanionApp({
      settings,
      cacheKey,
      lookupQuery,
      result: toCacheableResult(fallbackResult),
    }).catch(() => {});
    await appendLookupDebugEvent({
      status: "ok",
      query: lookupQuery,
      lookupMode: "default",
      normalizedQuery: normalized,
      providerHealth,
      primaryCandidateCount: 0,
      chosenTitle: fallbackResult.title,
      detail: fallback.debug || {},
    });
    return { status: "ok", result: fallbackResult };
  }

  const ranked = rankCandidates(candidates, normalized);

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
    const notFound = buildNotFoundResponse(normalized, providerHealth);
    await appendLookupDebugEvent({
      status: "not_found",
      query: lookupQuery,
      lookupMode: "default",
      normalizedQuery: normalized,
      providerHealth,
      primaryCandidateCount: candidates.length,
      chosenTitle: "",
      detail: {
        rankedCandidates: ranked.slice(0, 5).map(debugCandidateLabel),
      },
    });
    return notFound;
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
  await mirrorCacheEntryToCompanionApp({
    settings,
    cacheKey,
    lookupQuery,
    result: toCacheableResult(result),
  }).catch(() => {});
  await appendLookupDebugEvent({
    status: "ok",
    query: lookupQuery,
    lookupMode: "default",
    normalizedQuery: normalized,
    providerHealth,
    primaryCandidateCount: candidates.length,
    chosenTitle: result.title,
    detail: {
      resolvedCandidate: debugCandidateLabel(decision.candidate),
      rankedCandidates: ranked.slice(0, 5).map(debugCandidateLabel),
      providerTrace: final.providerTrace || [],
    },
  });

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
  await mirrorCacheEntryToCompanionApp({
    settings: pending.settings,
    cacheKey: pending.cacheKey,
    lookupQuery: buildLookupQuery(pending.normalized),
    result: toCacheableResult(result),
  }).catch(() => {});

  return {
    status: "ok",
    result,
  };
}

export async function runGoodreadsVisualDebugTest() {
  const settings = await getSettings();
  const seed = pickRandomGoodreadsTestSeed();
  const input = {
    title: seed.title,
    author: seed.author,
    year: seed.year,
    isbn13: seed.isbn13 || [],
    isbn10: seed.isbn10 || [],
    goodreadsIds: seed.goodreadsIds || [],
  };

  const fallback = await fetchGoodreadsFallback(input, settings, {
    skipCache: true,
    includeDebugAssets: true,
  });

  const eventBase = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    kind: "goodreads_test",
    title: seed.title,
    mediaType: "book",
    year: seed.year,
    author: seed.author,
    status: fallback?.synopsisSource ? "success" : "error",
    helperStatus: fallback?.status || "extraction_failed",
    resolvedUrl: fallback?.resolvedUrl || "",
    screenshotsCaptured: fallback?.screenshotsCaptured || 0,
    previewScreenshot: fallback?.debug?.previewScreenshot || "",
    visualLlmOutput: fallback?.debug?.rawOutput || "",
    visualLlmModel: fallback?.debug?.model || "",
    providerSourceText: String(fallback?.synopsisSource || ""),
    helperDebug: Object.fromEntries(
      Object.entries(fallback?.debug || {}).filter(([key]) => key !== "previewScreenshot" && key !== "rawOutput"),
    ),
  };

  if (!fallback?.synopsisSource) {
    await appendLookupDebugEvent({
      status: "error",
      query: seed.title,
      lookupMode: "goodreads_test",
      normalizedQuery: {
        raw: seed.title,
        query: seed.title,
        hintType: "book",
        hintYear: seed.year,
      },
      providerHealth: {
        openlibrary: "skipped_forced_goodreads",
        tmdb: "skipped",
        wikipedia: "skipped",
      },
      primaryCandidateCount: 0,
      chosenTitle: "",
      detail: {
        kind: "goodreads_visual_test",
        providerTrace: [
          {
            step: "goodreads_visual_fallback",
            status: fallback?.status || "extraction_failed",
            resolvedUrl: fallback?.resolvedUrl,
            screenshotsCaptured: fallback?.screenshotsCaptured || 0,
            detail: fallback?.debug || {},
          },
        ],
      },
    });

    await appendDebugEvent({
      ...eventBase,
      error: fallback?.debug?.reason || "Goodreads visual test failed.",
      synopsisLlmOutput: "",
      synopsisRequest: {},
      finalSynopsis: "",
      finalGenres: [],
    });

    return {
      status: "error",
      message: fallback?.debug?.reason || "Goodreads visual test failed.",
      title: seed.title,
    };
  }

  const llmSourceText = trimToWordLimit(String(fallback.synopsisSource || "").trim(), LLM_SOURCE_TEXT_MAX_WORDS);

  try {
    const rewritten = await rewriteSynopsisWithOpenRouter(
      {
        title: seed.title,
        mediaType: "book",
        year: seed.year,
        author: seed.author,
        directorOrCreator: undefined,
        cast: [],
        rawSourceText: fallback.synopsisSource,
        synopsis: llmSourceText,
      },
      settings,
      {
        skipDebugEvent: true,
        includeDebugData: true,
      },
    );

    await appendLookupDebugEvent({
      status: "ok",
      query: seed.title,
      lookupMode: "goodreads_test",
      normalizedQuery: {
        raw: seed.title,
        query: seed.title,
        hintType: "book",
        hintYear: seed.year,
      },
      providerHealth: {
        openlibrary: "skipped_forced_goodreads",
        tmdb: "skipped",
        wikipedia: "skipped",
      },
      primaryCandidateCount: 0,
      chosenTitle: seed.title,
      detail: {
        kind: "goodreads_visual_test",
        providerTrace: [
          {
            step: "goodreads_visual_fallback",
            status: "ok",
            resolvedUrl: fallback.resolvedUrl,
            screenshotsCaptured: fallback.screenshotsCaptured || 0,
          },
          {
            step: "llm_rewrite",
            status: "ok",
          },
        ],
      },
    });

    await appendDebugEvent({
      ...eventBase,
      status: "success",
      synopsisRequest: rewritten?.debug?.requestPayload || {},
      synopsisLlmOutput: rewritten?.debug?.rawOutput || "",
      finalSynopsis: rewritten?.synopsis || "",
      finalGenres: rewritten?.predictedGenres || [],
    });

    return {
      status: "ok",
      title: seed.title,
      synopsis: rewritten?.synopsis || "",
    };
  } catch (error) {
    await appendDebugEvent({
      ...eventBase,
      status: "error",
      error: error?.message || "Synopsis rewrite failed.",
      synopsisRequest: {},
      synopsisLlmOutput: "",
      finalSynopsis: "",
      finalGenres: [],
    });

    return {
      status: "error",
      title: seed.title,
      message: error?.message || "Synopsis rewrite failed.",
    };
  }
}
