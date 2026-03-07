import { CACHE_TTL_MS } from "../config/constants";
import { normalizeGoodreadsHelperUrl } from "../providers/goodreads";
import type { ExtensionSettings } from "../types";

export async function mirrorCacheEntryToCompanionApp({
  settings,
  cacheKey,
  lookupQuery,
  result,
  ttlMs = CACHE_TTL_MS,
}: {
  settings: Pick<ExtensionSettings, "goodreadsHelperUrl">;
  cacheKey: string;
  lookupQuery: string;
  result: unknown;
  ttlMs?: number;
}) {
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
