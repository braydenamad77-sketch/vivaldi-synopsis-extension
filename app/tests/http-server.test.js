import test from "node:test";
import assert from "node:assert/strict";

import { createCompanionHttpServer } from "../src/main/http-server.js";

test("http server health and cache upsert endpoints respond with 200", async () => {
  const upserts = [];
  const server = createCompanionHttpServer({
    cacheDb: {
      upsertCacheEntry(payload) {
        upserts.push(payload);
      },
    },
    goodreadsService: {
      async extractDescription() {
        return {
          status: "ok",
          descriptionText: "Visible Goodreads description text.",
          resolvedUrl: "https://www.goodreads.com/book/show/test",
          screenshotsCaptured: 1,
          debug: {},
        };
      },
    },
    host: "127.0.0.1",
    port: 4417,
  });

  await server.start();

  const health = await fetch("http://127.0.0.1:4417/health");
  assert.equal(health.status, 200);

  const upsert = await fetch("http://127.0.0.1:4417/cache/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cacheKey: "cache:test",
      lookupQuery: "The Pool Boy",
      expiresAt: Date.now() + 1000 * 60,
      result: {
        title: "The Pool Boy",
        mediaType: "book",
        synopsis: "A sharp, high-stakes romance.",
      },
    }),
  });
  assert.equal(upsert.status, 200);
  assert.equal(upserts.length, 1);

  const goodreads = await fetch("http://127.0.0.1:4417/goodreads/extract-description", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "The Pool Boy",
    }),
  });
  const goodreadsJson = await goodreads.json();
  assert.equal(goodreads.status, 200);
  assert.equal(goodreadsJson.status, "ok");

  await server.stop();
});
