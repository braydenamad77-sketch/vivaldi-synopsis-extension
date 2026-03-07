import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";

import { parseOpenRouterOutput, rewriteSynopsisWithOpenRouter } from "../src/llm/openrouter";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

test("parseOpenRouterOutput reads JSON synopsis and genres", () => {
  const raw = JSON.stringify({
    synopsis: "A hopeful chef starts over in a small seaside town and discovers a difficult rivalry.",
    genres: ["Romance", "Drama"],
  });

  const parsed = parseOpenRouterOutput(raw);

  assert.equal(parsed.synopsis.startsWith("A hopeful chef"), true);
  assert.deepEqual(parsed.predictedGenres, ["Romance", "Drama"]);
});

test("parseOpenRouterOutput handles fenced JSON with genre string", () => {
  const raw = [
    "```json",
    '{"synopsis":"A detective follows a cold case that reopens old secrets.","genres":"Mystery / Thriller"}',
    "```",
  ].join("\n");

  const parsed = parseOpenRouterOutput(raw);

  assert.equal(parsed.synopsis.includes("cold case"), true);
  assert.deepEqual(parsed.predictedGenres, ["Mystery/Thriller"]);
});

test("parseOpenRouterOutput falls back to plain synopsis text", () => {
  const raw = "Synopsis: Two siblings inherit a bookstore and fight to keep it alive.";
  const parsed = parseOpenRouterOutput(raw);

  assert.equal(parsed.synopsis.includes("inherit a bookstore"), true);
  assert.deepEqual(parsed.predictedGenres, []);
});

test("rewriteSynopsisWithOpenRouter surfaces a timeout message", async () => {
  vi.useFakeTimers();
  globalThis.fetch = ((_: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new Error("AbortError"));
      });
    })) as typeof fetch;

  const pending = rewriteSynopsisWithOpenRouter(
    {
      title: "Atlas",
      mediaType: "movie",
      synopsis: "A test synopsis.",
    },
    {
      openrouterApiKey: "test-key",
      openrouterModel: "test-model",
    },
  );
  const rejection = assert.rejects(pending, /timed out after 1800ms/i);

  await vi.advanceTimersByTimeAsync(2000);

  await rejection;
});
