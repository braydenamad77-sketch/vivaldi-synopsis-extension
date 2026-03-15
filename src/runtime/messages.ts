import type { Candidate, LookupResponse, LookupResult } from "../types";

export type BackgroundRuntimeRequest =
  | {
      type: "RUN_LOOKUP_QUERY";
      query: string;
      widerSearch?: boolean;
    }
  | {
      type: "REQUEST_ALTERNATIVES";
      requestId?: string;
      query?: string;
    }
  | {
      type: "RESOLVE_AMBIGUITY";
      requestId: string;
      selectedCandidateId: string;
      originalQuery?: string;
    }
  | {
      type: "OPEN_GOOGLE_RESULT_SEARCH";
      query: string;
    }
  | {
      type: "OPEN_SEARCH_IN_ACTIVE_TAB";
    }
  | {
      type: "RUN_GOODREADS_VISUAL_TEST";
    };

export type ContentUiMessage =
  | {
      type: "VS_PING";
    }
  | {
      type: "SHOW_SEARCH_INPUT";
    }
  | {
      type: "SHOW_LOADING";
      requestId?: string;
      query: string;
    }
  | {
      type: "SHOW_RESULT";
      requestId?: string;
      result: LookupResult;
      autoResolved?: boolean;
    }
  | {
      type: "SHOW_AMBIGUOUS";
      requestId: string;
      ambiguityRequestId?: string;
      candidates: Candidate[];
      originalQuery: string;
      note?: string;
    }
  | {
      type: "SHOW_ERROR";
      requestId?: string;
      errorCode?: string;
      message: string;
      lookupQuery?: string;
      allowWideSearch?: boolean;
    };

export interface ContentScriptAckResponse {
  ok: boolean;
  uiFlagVersion?: string;
  opened?: boolean;
  focused?: boolean;
}

export interface StatusOkResponse {
  status: "ok";
  message?: string;
}

export interface StatusErrorResponse {
  status: "error";
  errorCode: string;
  message: string;
}

export type StatusResponse = StatusOkResponse | StatusErrorResponse;

export type OpenSearchInActiveTabResponse = StatusResponse;
export type RunLookupQueryResponse = (StatusOkResponse | StatusErrorResponse) & {
  allowWideSearch?: boolean;
};

export type OpenGoogleSearchResponse =
  | {
      status: "ok";
      tabId: number;
    }
  | StatusErrorResponse;

export type AlternativesResponse = LookupResponse;
export type ResolveAmbiguityResponse = LookupResponse;

export type GoodreadsVisualTestResponse =
  | {
      status: "ok";
      title: string;
      synopsis: string;
    }
  | {
      status: "error";
      title: string;
      message: string;
    };
