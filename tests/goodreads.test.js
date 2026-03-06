import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS } from "../src/config/constants.js";
import { fetchGoodreadsFallback, normalizeGoodreadsHelperUrl } from "../src/providers/goodreads.js";

function installChromeStorageMock() {
  const store = {};

  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (key == null) return { ...store };
          if (typeof key === "string") return { [key]: store[key] };

          const result = {};
          for (const entry of key) {
            result[entry] = store[entry];
          }
          return result;
        },
        async set(value) {
          Object.assign(store, value);
        },
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const key of list) {
            delete store[key];
          }
        },
      },
    },
  };

  return store;
}

function buildSettings(overrides = {}) {
  return {
    ...DEFAULT_SETTINGS,
    openrouterApiKey: "test-key",
    goodreadsVisualFallbackEnabled: true,
    goodreadsHelperUrl: "http://127.0.0.1:4317",
    ...overrides,
  };
}

test.afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.fetch;
});

test("normalizeGoodreadsHelperUrl keeps localhost URLs and rejects remote ones", () => {
  assert.equal(normalizeGoodreadsHelperUrl("http://127.0.0.1:4317/"), "http://127.0.0.1:4317");
  assert.equal(normalizeGoodreadsHelperUrl("http://localhost:4317/path"), "http://localhost:4317");
  assert.equal(normalizeGoodreadsHelperUrl("https://example.com"), "");
});

test("fetchGoodreadsFallback returns helper text and caches successful visual results", async () => {
  installChromeStorageMock();

  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, "http://127.0.0.1:4317/goodreads/extract-description");

    const body = JSON.parse(options.body);
    assert.equal(body.title, "The Pool Boy");
    assert.equal(body.author, "Nikki Sloane");
    assert.deepEqual(body.goodreadsIds, ["51583112"]);
    assert.deepEqual(body.isbn13, ["9781728205003"]);

    return new Response(
      JSON.stringify({
        status: "ok",
        descriptionText: "Nothing says happy birthday like finding out your husband has a secret double life.",
        resolvedUrl: "https://www.goodreads.com/book/show/51583112-the-pool-boy",
        screenshotsCaptured: 2,
        debug: { expandStatus: "clicked", helper: "visual" },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  const meta = {
    title: "The Pool Boy",
    author: "Nikki Sloane",
    year: 2020,
    goodreadsIds: ["51583112"],
    isbn13: ["9781728205003"],
  };

  const first = await fetchGoodreadsFallback(meta, buildSettings());
  const second = await fetchGoodreadsFallback(meta, buildSettings());

  assert.equal(first.status, "ok");
  assert.equal(first.synopsisSource.includes("happy birthday"), true);
  assert.equal(first.resolvedUrl.includes("the-pool-boy"), true);
  assert.equal(first.screenshotsCaptured, 2);
  assert.equal(second.status, "ok");
  assert.equal(second.debug.cache, "hit");
  assert.equal(calls, 1);
});

test("fetchGoodreadsFallback returns helper_unavailable when localhost helper cannot be reached", async () => {
  installChromeStorageMock();

  globalThis.fetch = async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:4317");
  };

  const result = await fetchGoodreadsFallback(
    {
      title: "The Pool Boy",
    },
    buildSettings(),
  );

  assert.equal(result.status, "helper_unavailable");
  assert.equal(String(result.debug.reason || "").includes("ECONNREFUSED"), true);
});

test("fetchGoodreadsFallback passes through structured helper misses without guessing", async () => {
  installChromeStorageMock();

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status: "page_not_found",
        descriptionText: "",
        resolvedUrl: "",
        screenshotsCaptured: 0,
        debug: {
          reason: "Could not capture a Goodreads description block.",
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

  const result = await fetchGoodreadsFallback(
    {
      title: "Unknown Book",
    },
    buildSettings(),
  );

  assert.equal(result.status, "page_not_found");
  assert.equal(result.synopsisSource, undefined);
  assert.equal(String(result.debug.reason || "").includes("description block"), true);
});

test("fetchGoodreadsFallback stops early when no OpenRouter key is available for visual extraction", async () => {
  installChromeStorageMock();

  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("should not be called");
  };

  const result = await fetchGoodreadsFallback(
    {
      title: "The Pool Boy",
    },
    buildSettings({ openrouterApiKey: "" }),
  );

  assert.equal(result.status, "extraction_failed");
  assert.equal(String(result.debug.reason || "").includes("OpenRouter API key"), true);
  assert.equal(calls, 0);
});
