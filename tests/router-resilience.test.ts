import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/config/constants";

vi.mock("../src/core/cache", () => ({
  getCache: vi.fn(async () => undefined),
  setCache: vi.fn(async () => undefined),
}));

vi.mock("../src/core/companion-app", () => ({
  mirrorCacheEntryToCompanionApp: vi.fn(async () => false),
}));

vi.mock("../src/debug/store", () => ({
  appendDebugEvent: vi.fn(async () => undefined),
  getDebugState: vi.fn(async () => ({ enabled: false, events: [] })),
}));

vi.mock("../src/llm/openrouter", () => ({
  rewriteSynopsisWithOpenRouter: vi.fn(async () => {
    throw new Error("LLM should stay disabled in this test");
  }),
}));

vi.mock("../src/providers/openlibrary", () => ({
  searchOpenLibrary: vi.fn(async () => [
    {
      id: "/works/OL123W",
      provider: "openlibrary",
      mediaType: "book",
      title: "The Pool Boy",
      year: 2020,
      authorOrDirector: "Nikki Sloane",
      artworkUrl: "https://covers.openlibrary.org/b/id/123-L.jpg",
      artworkKind: "cover",
      goodreadsIds: ["51583112"],
      isbn13: ["9781728205003"],
    },
  ]),
  fetchOpenLibraryDetails: vi.fn(async () => {
    throw new Error("Open Library detail request failed");
  }),
}));

vi.mock("../src/providers/tmdb", () => ({
  searchTmdb: vi.fn(async () => []),
  fetchTmdbDetails: vi.fn(async () => {
    throw new Error("TMDB should not run in this test");
  }),
}));

vi.mock("../src/providers/tvmaze", () => ({
  fetchTvmazeArtwork: vi.fn(async () => undefined),
}));

vi.mock("../src/providers/wikipedia", () => ({
  fetchWikipediaSummaryByTitle: vi.fn(async () => undefined),
  searchWikipediaCandidates: vi.fn(async () => []),
}));

vi.mock("../src/providers/goodreads", () => ({
  fetchGoodreadsFallback: vi.fn(async () => ({
    status: "ok",
    provider: "goodreads",
    title: "The Pool Boy",
    author: "Nikki Sloane",
    year: 2020,
    synopsisSource: "Nothing says happy birthday like finding out your husband has a secret double life.",
    genres: ["Romance"],
    sourceAttribution: "Goodreads",
    resolvedUrl: "https://www.goodreads.com/book/show/51583112-the-pool-boy",
    screenshotsCaptured: 2,
    debug: { helper: "visual" },
  })),
}));

function installSettingsMock() {
  globalThis.chrome = {
    storage: {
      local: {
        async get(key?: string | string[] | null) {
          if (key === "settings") {
            return {
              settings: {
                ...DEFAULT_SETTINGS,
                llmEnabled: false,
                llmPreferred: false,
                openrouterApiKey: "",
              },
            };
          }

          return {};
        },
        async set() {},
        async remove() {},
      },
    },
  } as any;
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

test("lookupSynopsis degrades gracefully when Open Library details fail after search succeeds", async () => {
  installSettingsMock();

  const { lookupSynopsis } = await import("../src/background/router");
  const response = await lookupSynopsis({ query: "The Pool Boy" });

  assert.equal(response.status, "ok");
  if (response.status !== "ok") {
    throw new Error("Expected lookupSynopsis to recover from provider detail failure");
  }
  const { result } = response;
  if (!result) {
    throw new Error("Expected a lookup result after recovering from provider detail failure");
  }

  assert.equal(result.title, "The Pool Boy");
  assert.equal(result.mediaType, "book");
  assert.equal(result.author, "Nikki Sloane");
  assert.equal(result.synopsis?.includes("secret double life"), true);
  assert.equal(result.sourceAttribution?.includes("Goodreads"), true);
});
