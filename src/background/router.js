import { DEFAULT_SETTINGS } from "../config/constants.js";
import { buildCacheKey, normalizeQuery } from "../core/normalize.js";
import { chooseCandidate, rankCandidates } from "../core/disambiguate.js";
import { getCache, setCache } from "../core/cache.js";
import { sanitizeSynopsis, safeTemplate } from "../core/spoiler-guard.js";
import { searchOpenLibrary, fetchOpenLibraryDetails } from "../providers/openlibrary.js";
import { searchTmdb, fetchTmdbDetails } from "../providers/tmdb.js";
import { fetchWikipediaSummary } from "../providers/wikipedia.js";
import { rewriteSynopsisWithOpenRouter } from "../llm/openrouter.js";

const pendingAmbiguities = new Map();

function mergeSettings(stored) {
  return {
    ...DEFAULT_SETTINGS,
    ...(stored || {}),
    providerToggles: {
      ...DEFAULT_SETTINGS.providerToggles,
      ...(stored?.providerToggles || {}),
    },
  };
}

export async function getSettings() {
  const payload = await chrome.storage.local.get("settings");
  return mergeSettings(payload.settings);
}

function buildAttribution(source, llmUsed) {
  return llmUsed ? `${source} + OpenRouter` : source;
}

async function lookupCandidates(normalized, settings) {
  const tasks = [];

  if (settings.providerToggles.openlibrary) {
    tasks.push(searchOpenLibrary(normalized));
  }

  if (settings.providerToggles.tmdb && settings.tmdbApiKey) {
    tasks.push(searchTmdb(normalized, settings.tmdbApiKey));
  }

  const settled = await Promise.allSettled(tasks);
  return settled
    .flatMap((item) => (item.status === "fulfilled" ? item.value : []))
    .filter(Boolean);
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
    };
  }

  if (!details.synopsisSource && settings.providerToggles.wikipedia) {
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
      synopsis = sanitizeSynopsis(rewritten, details);
      llmUsed = true;
    } catch (_error) {
      synopsis = sanitizeSynopsis(synopsis, details);
    }
  }

  return {
    ...details,
    synopsis,
    sourceAttribution: buildAttribution(details.sourceAttribution, llmUsed),
  };
}

function toResult(details, fromCache = false) {
  return {
    title: details.title,
    mediaType: details.mediaType,
    year: details.year,
    author: details.author,
    directorOrCreator: details.directorOrCreator,
    cast: details.cast || [],
    synopsis: details.synopsis,
    sourceAttribution: details.sourceAttribution,
    fromCache,
  };
}

async function lookupFallback(normalized, settings) {
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
  if (cached) {
    return {
      status: "ok",
      result: {
        ...cached,
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

  const candidates = await lookupCandidates(normalized, settings);

  if (!candidates.length) {
    const fallback = await lookupFallback(normalized, settings);
    if (!fallback) {
      return {
        status: "not_found",
        message: "No synopsis found for that title.",
      };
    }

    const fallbackResult = toResult(fallback, false);
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
  const result = toResult(final, false);

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
  const result = toResult(final, false);

  await setCache(pending.cacheKey, result);
  pendingAmbiguities.delete(request.requestId);

  return {
    status: "ok",
    result,
  };
}
