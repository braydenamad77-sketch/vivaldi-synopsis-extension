import { test } from "vitest";
import assert from "node:assert/strict";

import { pickTmdbArtwork, searchTmdb } from "../src/providers/tmdb";
import { pickBestTvmazeCandidate } from "../src/providers/tvmaze";
import { extractWikipediaArtwork } from "../src/providers/wikipedia";

test("pickTmdbArtwork prefers posters when available", () => {
  const picked = pickTmdbArtwork({
    images: {
      posters: [{ file_path: "/poster.jpg", iso_639_1: "en", vote_average: 5, vote_count: 10 }],
      backdrops: [{ file_path: "/backdrop.jpg", iso_639_1: null, vote_average: 8, vote_count: 100 }],
    },
  });

  assert.ok(picked);
  assert.equal(picked.artworkKind, "poster");
  assert.equal(picked.artworkUrl.includes("/poster.jpg"), true);
});

test("pickTmdbArtwork falls back to backdrop when posters are missing", () => {
  const picked = pickTmdbArtwork({
    backdrop_path: "/wide.jpg",
  });

  assert.ok(picked);
  assert.equal(picked.artworkKind, "backdrop");
  assert.equal(picked.artworkUrl.includes("/wide.jpg"), true);
});

test("pickBestTvmazeCandidate prefers closer year match", () => {
  const picked = pickBestTvmazeCandidate(
    [
      { score: 1, show: { name: "Dark Matter", premiered: "2015-06-12" } },
      { score: 1, show: { name: "Dark Matter", premiered: "2024-05-08" } },
    ],
    { title: "Dark Matter", year: 2024 },
  );

  assert.ok(picked);
  assert.equal(picked.show.premiered, "2024-05-08");
});

test("extractWikipediaArtwork prefers original image source", () => {
  const picked = extractWikipediaArtwork({
    thumbnail: { source: "https://example.com/thumb.jpg" },
    originalimage: { source: "https://example.com/original.jpg" },
  });

  assert.ok(picked);
  assert.equal(picked.artworkUrl, "https://example.com/original.jpg");
  assert.equal(picked.artworkKind, "thumbnail");
});

test("searchTmdb keeps results beyond the old top-eight truncation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      async json() {
        return {
          results: Array.from({ length: 10 }, (_value, index) => ({
            id: index + 1,
            media_type: "movie",
            title: `Atlas ${index + 1}`,
            popularity: 10 + index,
            vote_count: 100 + index,
          })),
        };
      },
    }) as Response) as typeof fetch;

  try {
    const results = await searchTmdb({ query: "Atlas", raw: "Atlas" }, "tmdb-key");
    assert.equal(results.length, 10);
    assert.equal(results.at(-1)?.title, "Atlas 10");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
