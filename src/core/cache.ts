import { CACHE_TTL_MS } from "../config/constants";
import type { AnyRecord } from "../types";

function storageLocal() {
  return globalThis.chrome?.storage?.local;
}

export async function getCache<T = AnyRecord>(key: string): Promise<T | undefined> {
  const storage = storageLocal();
  if (!storage) return undefined;

  const data = (await storage.get(key)) as Record<string, any>;
  const record = data[key];
  if (!record) return undefined;

  if (Date.now() > record.expiresAt) {
    await storage.remove(key);
    return undefined;
  }

  return record.value as T;
}

export async function setCache<T = AnyRecord>(key: string, value: T, ttlMs = CACHE_TTL_MS): Promise<void> {
  const storage = storageLocal();
  if (!storage) return;

  await storage.set({
    [key]: {
      value,
      expiresAt: Date.now() + ttlMs,
    },
  });
}

export async function clearCache(): Promise<void> {
  const storage = storageLocal();
  if (!storage) return;

  const all = await storage.get(null);
  const cacheKeys = Object.keys(all).filter((key) => key.startsWith("cache:"));
  if (cacheKeys.length) {
    await storage.remove(cacheKeys);
  }
}
