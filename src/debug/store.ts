import type { AnyRecord, MediaType, NormalizedQuery, ProviderHealth } from "../types";
import type { DebugEvent, GoodreadsTestDebugEvent, LlmDebugEvent, LookupDebugDetail, LookupDebugEvent } from "./types";

const DEBUG_STORAGE_KEY = "debugState";
const MAX_DEBUG_EVENTS = 12;

export interface DebugState {
  enabled: boolean;
  events: DebugEvent[];
}

function storageLocal() {
  return globalThis.chrome?.storage?.local;
}

function defaultState(): DebugState {
  return {
    enabled: false,
    events: [],
  };
}

function normalizeProviderTrace(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? (value.filter(Boolean) as AnyRecord[]) : [];
}

function normalizeLookupDetail(value: unknown): LookupDebugDetail {
  const detail = value && typeof value === "object" ? ({ ...(value as AnyRecord) } as LookupDebugDetail) : {};
  detail.providerTrace = normalizeProviderTrace(detail.providerTrace);
  return detail;
}

function normalizeMediaType(value: unknown): MediaType | undefined {
  return typeof value === "string" && value ? (value as MediaType) : undefined;
}

function normalizeNormalizedQuery(value: unknown): NormalizedQuery {
  const query = value && typeof value === "object" ? (value as AnyRecord) : {};
  return {
    raw: typeof query.raw === "string" ? query.raw : undefined,
    query: typeof query.query === "string" ? query.query : "",
    hintYear: typeof query.hintYear === "number" ? query.hintYear : undefined,
    hintType: normalizeMediaType(query.hintType),
  };
}

function normalizeProviderHealth(value: unknown): ProviderHealth {
  const health = value && typeof value === "object" ? (value as AnyRecord) : {};
  return {
    openlibrary: typeof health.openlibrary === "string" ? health.openlibrary : "disabled",
    tmdb: typeof health.tmdb === "string" ? health.tmdb : "disabled",
    wikipedia: typeof health.wikipedia === "string" ? health.wikipedia : "disabled",
  };
}

function normalizeLookupDebugEvent(value: AnyRecord): LookupDebugEvent {
  return {
    id: String(value.id || ""),
    createdAt: String(value.createdAt || ""),
    kind: "lookup",
    title: String(value.title || "Lookup"),
    status: String(value.status || "unknown"),
    query: String(value.query || ""),
    lookupMode: String(value.lookupMode || "default"),
    normalizedQuery: normalizeNormalizedQuery(value.normalizedQuery),
    providerHealth: normalizeProviderHealth(value.providerHealth),
    primaryCandidateCount: Number(value.primaryCandidateCount) || 0,
    chosenTitle: String(value.chosenTitle || ""),
    detail: normalizeLookupDetail(value.detail),
  };
}

function normalizeLlmDebugEvent(value: AnyRecord): LlmDebugEvent {
  return {
    id: String(value.id || ""),
    createdAt: String(value.createdAt || ""),
    kind: "llm",
    title: String(value.title || "Unknown"),
    status: String(value.status || "unknown"),
    mediaType: normalizeMediaType(value.mediaType),
    year: typeof value.year === "number" ? value.year : undefined,
    error: String(value.error || ""),
    providerSourceText: String(value.providerSourceText || ""),
    llmSourceText: String(value.llmSourceText || ""),
    request: value.request && typeof value.request === "object" ? (value.request as AnyRecord) : {},
    rawOutput: String(value.rawOutput || ""),
  };
}

function normalizeGoodreadsTestDebugEvent(value: AnyRecord): GoodreadsTestDebugEvent {
  return {
    id: String(value.id || ""),
    createdAt: String(value.createdAt || ""),
    kind: "goodreads_test",
    title: String(value.title || "Unknown"),
    status: String(value.status || "unknown"),
    mediaType: "book",
    year: typeof value.year === "number" ? value.year : undefined,
    author: typeof value.author === "string" ? value.author : undefined,
    helperStatus: String(value.helperStatus || "unknown"),
    resolvedUrl: String(value.resolvedUrl || ""),
    screenshotsCaptured: Number(value.screenshotsCaptured) || 0,
    previewScreenshot: String(value.previewScreenshot || ""),
    visualLlmOutput: String(value.visualLlmOutput || ""),
    visualLlmModel: String(value.visualLlmModel || ""),
    providerSourceText: String(value.providerSourceText || ""),
    helperDebug: value.helperDebug && typeof value.helperDebug === "object" ? (value.helperDebug as AnyRecord) : {},
    synopsisLlmOutput: String(value.synopsisLlmOutput || ""),
    synopsisRequest: value.synopsisRequest && typeof value.synopsisRequest === "object" ? (value.synopsisRequest as AnyRecord) : {},
    finalSynopsis: String(value.finalSynopsis || ""),
    finalGenres: Array.isArray(value.finalGenres) ? value.finalGenres.map((item) => String(item)).filter(Boolean) : [],
    error: typeof value.error === "string" ? value.error : undefined,
  };
}

function normalizeDebugEvent(value: unknown): DebugEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as AnyRecord;
  if (event.kind === "lookup") return normalizeLookupDebugEvent(event);
  if (event.kind === "llm") return normalizeLlmDebugEvent(event);
  if (event.kind === "goodreads_test") return normalizeGoodreadsTestDebugEvent(event);
  return null;
}

function normalizeState(value: AnyRecord | undefined): DebugState {
  return {
    ...defaultState(),
    ...(value || {}),
    enabled: Boolean(value?.enabled),
    events: Array.isArray(value?.events) ? value.events.map(normalizeDebugEvent).filter((item): item is DebugEvent => item !== null) : [],
  };
}

export async function getDebugState() {
  const storage = storageLocal();
  if (!storage) return defaultState();

  const payload = await storage.get(DEBUG_STORAGE_KEY);
  return normalizeState(payload?.[DEBUG_STORAGE_KEY] as AnyRecord | undefined);
}

export async function setDebugEnabled(enabled: boolean) {
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

export async function appendDebugEvent(event: DebugEvent) {
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
