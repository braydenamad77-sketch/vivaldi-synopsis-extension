import type { AnyRecord, MediaType, NormalizedQuery, ProviderHealth } from "../types";

export interface DebugEventBase {
  id: string;
  createdAt: string;
  title: string;
  status: string;
  mediaType?: MediaType;
  year?: number;
}

export interface LookupDebugDetail extends AnyRecord {
  kind?: string;
  providerTrace?: AnyRecord[];
}

export interface LookupDebugEvent extends DebugEventBase {
  kind: "lookup";
  query: string;
  lookupMode: string;
  normalizedQuery: NormalizedQuery;
  providerHealth: ProviderHealth;
  primaryCandidateCount: number;
  chosenTitle: string;
  detail: LookupDebugDetail;
}

export interface LlmDebugEvent extends DebugEventBase {
  kind: "llm";
  error: string;
  providerSourceText: string;
  llmSourceText: string;
  request: AnyRecord;
  rawOutput: string;
}

export interface GoodreadsTestDebugEvent extends DebugEventBase {
  kind: "goodreads_test";
  mediaType: "book";
  author?: string;
  helperStatus: string;
  resolvedUrl: string;
  screenshotsCaptured: number;
  previewScreenshot: string;
  visualLlmOutput: string;
  visualLlmModel: string;
  providerSourceText: string;
  helperDebug: AnyRecord;
  synopsisLlmOutput: string;
  synopsisRequest: AnyRecord;
  finalSynopsis: string;
  finalGenres: string[];
  error?: string;
}

export type DebugEvent = LookupDebugEvent | LlmDebugEvent | GoodreadsTestDebugEvent;
