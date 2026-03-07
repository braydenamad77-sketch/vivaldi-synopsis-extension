import {
  GOODREADS_CACHE_TTL_MS,
  GOODREADS_HELPER_URL_DEFAULT,
  GOODREADS_TIMEOUT_MS,
} from "../config/constants";
import { getCache, setCache } from "../core/cache";
import { hashString, normalizeTitleForCompare } from "../core/normalize";
import type { AnyRecord, ExtensionSettings } from "../types";

const ALLOWED_HELPER_HOSTS = new Set(["127.0.0.1", "localhost"]);

export interface GoodreadsMeta {
  title?: string;
  author?: string;
  year?: number;
  goodreadsIds?: string[];
  isbn10?: string[];
  isbn13?: string[];
}

interface GoodreadsFallbackOptions {
  includeDebugAssets?: boolean;
  skipCache?: boolean;
}

export interface GoodreadsFallbackSuccess {
  provider: "goodreads";
  status: "ok";
  title: string;
  author?: string;
  year?: number;
  synopsisSource: string;
  genres: string[];
  sourceAttribution: string;
  resolvedUrl: string;
  screenshotsCaptured: number;
  debug: AnyRecord;
}

export interface GoodreadsFallbackFailure {
  status: string;
  title?: string;
  author?: string;
  year?: number;
  synopsisSource?: undefined;
  genres?: string[];
  sourceAttribution?: string;
  resolvedUrl?: string;
  screenshotsCaptured?: number;
  debug: AnyRecord;
}

export type GoodreadsFallbackResult = GoodreadsFallbackSuccess | GoodreadsFallbackFailure;

export function isGoodreadsFallbackSuccess(result: GoodreadsFallbackResult): result is GoodreadsFallbackSuccess {
  return result.status === "ok" && typeof result.synopsisSource === "string";
}

function sanitizeIsbn(value: string | undefined) {
  if (!value) return "";
  const cleaned = String(value).replace(/[^0-9Xx]/g, "").toUpperCase();
  if (cleaned.length === 10 || cleaned.length === 13) return cleaned;
  return "";
}

function dedupe(values: string[] = [], limit = 8) {
  const output: string[] = [];
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

export function normalizeGoodreadsHelperUrl(value: string | undefined) {
  const raw = String(value || GOODREADS_HELPER_URL_DEFAULT).trim() || GOODREADS_HELPER_URL_DEFAULT;

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:") return "";
    if (!ALLOWED_HELPER_HOSTS.has(url.hostname)) return "";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch (_error) {
    return "";
  }
}

function buildLookupPayload(
  meta: GoodreadsMeta = {},
  settings: Pick<ExtensionSettings, "openrouterApiKey" | "openrouterModel"> = { openrouterApiKey: "", openrouterModel: "" },
) {
  return {
    title: String(meta.title || "").trim(),
    author: String(meta.author || "").trim(),
    year: Number(meta.year) || undefined,
    goodreadsIds: dedupe(meta.goodreadsIds || [], 6),
    isbn10: dedupe((meta.isbn10 || []).map(sanitizeIsbn).filter(Boolean), 6),
    isbn13: dedupe((meta.isbn13 || []).map(sanitizeIsbn).filter(Boolean), 6),
    openrouterApiKey: String(settings.openrouterApiKey || "").trim(),
    openrouterModel: String(settings.openrouterModel || "").trim(),
    includeDebugAssets: false,
  };
}

function goodreadsCacheKey(payload: AnyRecord) {
  return `cache:goodreads-visual:v1:${hashString(JSON.stringify(payload))}`;
}

async function postHelper(helperUrl: string, payload: AnyRecord) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOODREADS_TIMEOUT_MS);

  try {
    const response = await fetch(`${helperUrl}/goodreads/extract-description`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : undefined;

    if (!response.ok) {
      return {
        status: body?.status || "extraction_failed",
        debug: {
          helperStatus: response.status,
          ...(body?.debug || {}),
        },
      };
    }

    return body || { status: "extraction_failed" };
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        status: "helper_unavailable",
        debug: {
          reason: `Local Goodreads helper timed out after ${GOODREADS_TIMEOUT_MS}ms.`,
        },
      };
    }

    return {
      status: "helper_unavailable",
      debug: {
        reason: error instanceof Error ? error.message : "Could not reach local Goodreads helper.",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchGoodreadsFallback(
  meta: GoodreadsMeta = {},
  settings: ExtensionSettings = {
    openrouterApiKey: "",
    openrouterModel: "",
    llmEnabled: true,
    llmPreferred: true,
    localOnlyMode: false,
    searchShortcutKey: "\\",
    resultUiMode: "with_image",
    editorialSynopsisPopupEnabled: true,
    tmdbApiKey: "",
    goodreadsVisualFallbackEnabled: true,
    goodreadsHelperUrl: GOODREADS_HELPER_URL_DEFAULT,
    providerToggles: {
      openlibrary: true,
      tmdb: true,
      wikipedia: true,
    },
  },
  options: GoodreadsFallbackOptions = {},
): Promise<GoodreadsFallbackResult> {
  if (!settings.goodreadsVisualFallbackEnabled) {
    return {
      status: "disabled",
      debug: {
        reason: "Goodreads visual fallback is disabled in settings.",
      },
    };
  }

  const helperUrl = normalizeGoodreadsHelperUrl(settings.goodreadsHelperUrl);
  if (!helperUrl) {
    return {
      status: "helper_unavailable",
      debug: {
        reason: "Goodreads helper URL must stay on localhost.",
      },
    };
  }

  const payload = {
    ...buildLookupPayload(meta, settings),
    includeDebugAssets: Boolean(options.includeDebugAssets),
  };
  if (!payload.title) {
    return {
      status: "extraction_failed",
      debug: {
        reason: "Missing book title for Goodreads visual fallback.",
      },
    };
  }

  if (!payload.openrouterApiKey) {
    return {
      status: "extraction_failed",
      debug: {
        reason: "OpenRouter API key is required for Goodreads visual extraction.",
      },
    };
  }

  const cacheKey = goodreadsCacheKey({
    title: normalizeTitleForCompare(payload.title),
    author: normalizeTitleForCompare(payload.author),
    year: payload.year || "",
    goodreadsIds: payload.goodreadsIds,
    isbn10: payload.isbn10,
    isbn13: payload.isbn13,
  });
  const cached = !options.skipCache ? await getCache<GoodreadsFallbackSuccess>(cacheKey) : undefined;
  if (cached?.synopsisSource) {
    return {
      ...cached,
      status: "ok",
      debug: {
        ...(cached.debug || {}),
        cache: "hit",
      },
    };
  }

  const helperResponse = await postHelper(helperUrl, payload);
  if (helperResponse?.status !== "ok" || !String(helperResponse?.descriptionText || "").trim()) {
    return {
      status: helperResponse?.status || "extraction_failed",
      resolvedUrl: helperResponse?.resolvedUrl,
      screenshotsCaptured: Number(helperResponse?.screenshotsCaptured) || 0,
      debug: helperResponse?.debug || {},
    };
  }

  const fallback: GoodreadsFallbackSuccess = {
    provider: "goodreads",
    status: "ok",
    title: payload.title,
    author: payload.author || undefined,
    year: payload.year,
    synopsisSource: String(helperResponse.descriptionText || "").trim(),
    genres: [],
    sourceAttribution: "Goodreads",
    resolvedUrl: String(helperResponse.resolvedUrl || ""),
    screenshotsCaptured: Number(helperResponse.screenshotsCaptured) || 0,
    debug: helperResponse.debug || {},
  };

  await setCache(
    cacheKey,
    {
      ...fallback,
      debug: {},
    },
    GOODREADS_CACHE_TTL_MS,
  );
  return fallback;
}
