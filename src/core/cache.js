import { CACHE_TTL_MS } from "../config/constants.js";

function storageLocal() {
  return globalThis.chrome?.storage?.local;
}

export async function getCache(key) {
  const storage = storageLocal();
  if (!storage) return undefined;

  const data = await storage.get(key);
  const record = data[key];
  if (!record) return undefined;

  if (Date.now() > record.expiresAt) {
    await storage.remove(key);
    return undefined;
  }

  return record.value;
}

export async function setCache(key, value, ttlMs = CACHE_TTL_MS) {
  const storage = storageLocal();
  if (!storage) return;

  await storage.set({
    [key]: {
      value,
      expiresAt: Date.now() + ttlMs,
    },
  });
}

export async function clearCache() {
  const storage = storageLocal();
  if (!storage) return;

  const all = await storage.get(null);
  const cacheKeys = Object.keys(all).filter((key) => key.startsWith("cache:"));
  if (cacheKeys.length) {
    await storage.remove(cacheKeys);
  }
}
