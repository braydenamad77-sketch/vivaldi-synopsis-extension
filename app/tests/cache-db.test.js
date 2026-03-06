import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createCacheDatabase } from "../src/main/cache-db.js";

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-companion-db-"));
  return path.join(dir, "cache.sqlite");
}

test("cache database upserts and retrieves a cached result", () => {
  const db = createCacheDatabase({ dbPath: makeTempDbPath() });

  db.upsertCacheEntry({
    cacheKey: "cache:v1:test",
    lookupQuery: "Project Hail Mary",
    expiresAt: Date.now() + 1000 * 60,
    result: {
      title: "Project Hail Mary",
      mediaType: "book",
      year: 2021,
      synopsis: "A science teacher wakes up alone on a desperate mission.",
      sourceAttribution: "Open Library + Goodreads",
      artworkUrl: "https://example.com/cover.jpg",
      artworkKind: "cover",
      genreLabel: "Sci-Fi",
    },
  });

  const entry = db.getCacheEntry("cache:v1:test");
  assert.equal(entry.title, "Project Hail Mary");
  assert.equal(entry.mediaType, "book");
  assert.equal(entry.genreLabel, "Sci-Fi");
  assert.equal(entry.result.title, "Project Hail Mary");
  db.close();
});

test("cache database search filters by title and media type", () => {
  const db = createCacheDatabase({ dbPath: makeTempDbPath() });
  const expiresAt = Date.now() + 1000 * 60;

  db.upsertCacheEntry({
    cacheKey: "cache:a",
    lookupQuery: "Dune",
    expiresAt,
    result: {
      title: "Dune",
      mediaType: "movie",
      year: 2021,
      synopsis: "A noble family takes control of a dangerous desert planet.",
      sourceAttribution: "TMDB",
    },
  });
  db.upsertCacheEntry({
    cacheKey: "cache:b",
    lookupQuery: "Dune Messiah",
    expiresAt,
    result: {
      title: "Dune Messiah",
      mediaType: "book",
      year: 1969,
      synopsis: "Paul Atreides faces the cost of prophecy and empire.",
      sourceAttribution: "Open Library",
    },
  });

  assert.equal(db.listCacheEntries({ query: "messiah" }).length, 1);
  assert.equal(db.listCacheEntries({ query: "movie" }).length, 1);
  assert.equal(db.listCacheEntries({ query: "dune" }).length, 2);
  db.close();
});
