import { test } from "vitest";
import assert from "node:assert/strict";

import { mirrorCacheEntryToCompanionApp } from "../src/core/companion-app";

type TestGlobals = typeof globalThis & {
  fetch?: typeof fetch;
};

test("mirrorCacheEntryToCompanionApp posts successful cache writes to localhost", async () => {
  const globals = globalThis as TestGlobals;
  let payload:
    | {
        url: string;
        body: Record<string, unknown>;
      }
    | undefined;

  globals.fetch = async (url, options) => {
    const rawBody = typeof options?.body === "string" ? options.body : "";
    payload = {
      url: String(url),
      body: JSON.parse(rawBody) as Record<string, unknown>,
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
  assert.ok(payload);
  assert.equal(payload.url, "http://127.0.0.1:4317/cache/upsert");
  assert.equal(payload.body.cacheKey, "cache:v3:test");
  assert.equal(payload.body.lookupQuery, "Dune");
  Reflect.deleteProperty(globals, "fetch");
});

test("mirrorCacheEntryToCompanionApp ignores non-local helper URLs", async () => {
  const globals = globalThis as TestGlobals;
  let called = false;
  globals.fetch = async () => {
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
  Reflect.deleteProperty(globals, "fetch");
});
