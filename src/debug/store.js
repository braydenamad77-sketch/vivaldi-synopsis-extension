const DEBUG_STORAGE_KEY = "debugState";
const MAX_DEBUG_EVENTS = 12;

function storageLocal() {
  return globalThis.chrome?.storage?.local;
}

function defaultState() {
  return {
    enabled: false,
    events: [],
  };
}

function normalizeState(value) {
  return {
    ...defaultState(),
    ...(value || {}),
    enabled: Boolean(value?.enabled),
    events: Array.isArray(value?.events) ? value.events : [],
  };
}

export async function getDebugState() {
  const storage = storageLocal();
  if (!storage) return defaultState();

  const payload = await storage.get(DEBUG_STORAGE_KEY);
  return normalizeState(payload?.[DEBUG_STORAGE_KEY]);
}

export async function setDebugEnabled(enabled) {
  const storage = storageLocal();
  if (!storage) return defaultState();

  const current = await getDebugState();
  const next = {
    ...current,
    enabled: Boolean(enabled),
  };

  await storage.set({ [DEBUG_STORAGE_KEY]: next });
  return next;
}

export async function clearDebugEvents() {
  const storage = storageLocal();
  if (!storage) return defaultState();

  const current = await getDebugState();
  const next = {
    ...current,
    events: [],
  };

  await storage.set({ [DEBUG_STORAGE_KEY]: next });
  return next;
}

export async function appendDebugEvent(event) {
  const storage = storageLocal();
  if (!storage) return defaultState();

  const current = await getDebugState();
  const next = {
    ...current,
    events: [event, ...current.events].slice(0, MAX_DEBUG_EVENTS),
  };

  await storage.set({ [DEBUG_STORAGE_KEY]: next });
  return next;
}
