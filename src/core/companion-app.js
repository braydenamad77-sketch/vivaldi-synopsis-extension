import { CACHE_TTL_MS } from "../config/constants.js";
import { normalizeGoodreadsHelperUrl } from "../providers/goodreads.js";

export async function mirrorCacheEntryToCompanionApp({ settings, cacheKey, lookupQuery, result, ttlMs = CACHE_TTL_MS }) {
  const baseUrl = normalizeGoodreadsHelperUrl(settings?.goodreadsHelperUrl);
  if (!baseUrl) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);

  try {
    const response = await fetch(`${baseUrl}/cache/upsert`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cacheKey,
        lookupQuery,
        result,
        expiresAt: Date.now() + ttlMs,
      }),
    });

    return response.ok;
  } catch (_error) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
