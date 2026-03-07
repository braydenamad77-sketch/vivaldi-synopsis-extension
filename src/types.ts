export type AnyRecord = Record<string, any>;

export type MediaType = "book" | "movie" | "tv" | "unknown" | (string & {});

export interface ProviderToggles {
  openlibrary: boolean;
  tmdb: boolean;
  wikipedia: boolean;
}

export interface ExtensionSettings {
  openrouterApiKey: string;
  openrouterModel: string;
  llmEnabled: boolean;
  llmPreferred: boolean;
  localOnlyMode: boolean;
  searchShortcutKey: string;
  resultUiMode: "with_image" | "without_image" | string;
  editorialSynopsisPopupEnabled: boolean;
  tmdbApiKey: string;
  goodreadsVisualFallbackEnabled: boolean;
  goodreadsHelperUrl: string;
  providerToggles: ProviderToggles;
}

export interface NormalizedQuery {
  raw?: string;
  query: string;
  hintYear?: number;
  hintType?: MediaType;
}

export interface Candidate {
  id: string;
  provider: string;
  mediaType: MediaType;
  title: string;
  year?: number;
  authorOrDirector?: string;
  popularity?: number;
  voteCount?: number;
  artworkUrl?: string;
  artworkKind?: string;
  coverId?: number | string;
  goodreadsIds?: string[];
  isbn10?: string[];
  isbn13?: string[];
  wikiDescription?: string;
  wikiKey?: string;
  score?: number;
}

export interface ProviderTraceEntry extends AnyRecord {
  step: string;
  status: string;
}

export interface LookupDetails {
  title: string;
  mediaType: MediaType;
  year?: number;
  author?: string;
  directorOrCreator?: string;
  cast?: string[];
  genres?: string[];
  synopsisSource?: string;
  synopsis?: string;
  sourceAttribution?: string;
  artworkUrl?: string;
  artworkKind?: string;
  goodreadsIds?: string[];
  isbn10?: string[];
  isbn13?: string[];
  genreSource?: string;
  providerTrace?: AnyRecord[];
}

export interface LookupResult extends LookupDetails {
  genreLabel?: string;
  primaryTag?: string;
  secondaryTag?: string;
  directorOrCreatorTag?: string;
  authorTag?: string;
  castTag?: string;
  resultUiMode?: string;
  fromCache?: boolean;
  lookupQuery?: string;
  canChooseAnother?: boolean;
  reselectRequestId?: string;
}

export type ProviderStatus =
  | "enabled"
  | "disabled"
  | "missing_key"
  | "ok"
  | "error"
  | "skipped"
  | "skipped_forced_goodreads"
  | (string & {});

export interface ProviderHealth {
  openlibrary: ProviderStatus;
  tmdb: ProviderStatus;
  wikipedia: ProviderStatus;
}

export interface PendingAmbiguity {
  normalized: NormalizedQuery;
  settings: ExtensionSettings;
  candidates: Candidate[];
  cacheKey: string;
  note?: string;
}

export interface LookupResponse {
  status: string;
  errorCode?: string;
  message?: string;
  result?: LookupResult;
  requestId?: string;
  candidates?: Candidate[];
  note?: string;
  lookupQuery?: string;
  allowWideSearch?: boolean;
  debug?: AnyRecord;
}
