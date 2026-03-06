import test from "node:test";
import assert from "node:assert/strict";

import { mirrorCacheEntryToCompanionApp } from "../src/core/companion-app.js";

test("mirrorCacheEntryToCompanionApp posts successful cache writes to localhost", async () => {
  let payload;
  globalThis.fetch = async (url, options) => {
    payload = {
      url,
      body: JSON.parse(options.body),
    };
    return new Response("{}", { status: 200 });
  };

  const ok = await mirrorCacheEntryToCompanionApp({
    settings: {
      goodreadsHelperUrl: "http://127.0.0.1:4317",
    },
    cacheKey: "cache:v3:test",
    lookupQuery: "Dune",
    result: {
      title: "Dune",
      mediaType: "movie",
    },
  });

  assert.equal(ok, true);
  assert.equal(payload.url, "http://127.0.0.1:4317/cache/upsert");
  assert.equal(payload.body.cacheKey, "cache:v3:test");
  assert.equal(payload.body.lookupQuery, "Dune");
  delete globalThis.fetch;
});

test("mirrorCacheEntryToCompanionApp ignores non-local helper URLs", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };

  const ok = await mirrorCacheEntryToCompanionApp({
    settings: {
      goodreadsHelperUrl: "https://example.com",
    },
    cacheKey: "cache:v3:test",
    lookupQuery: "Dune",
    result: {
      title: "Dune",
    },
  });

  assert.equal(ok, false);
  assert.equal(called, false);
  delete globalThis.fetch;
});
