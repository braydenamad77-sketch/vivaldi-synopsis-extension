import { test } from "vitest";
import assert from "node:assert/strict";

import { buildCacheKey, normalizeQuery, detectHintType, hashString } from "../src/core/normalize";

test("normalizeQuery extracts year and strips it from query", () => {
  const normalized = normalizeQuery("Dune (2021) movie");

  assert.equal(normalized.hintYear, 2021);
  assert.equal(normalized.query, "Dune movie");
});

test("normalizeQuery strips trailing context noise from highlighted video titles", () => {
  const normalized = normalizeQuery("Set It Up (2018) - Movie Night #191 FULL");

  assert.equal(normalized.hintYear, 2018);
  assert.equal(normalized.query, "Set It Up");
});

test("normalizeQuery keeps year-only titles intact", () => {
  const normalized = normalizeQuery("1917");

  assert.equal(normalized.query, "1917");
  assert.equal(normalized.hintYear, undefined);
});

test("normalizeQuery keeps year titles when the remainder is only a media hint", () => {
  const normalized = normalizeQuery("1984 book");

  assert.equal(normalized.query, "1984 book");
  assert.equal(normalized.hintYear, undefined);
});

test("detectHintType identifies media hints", () => {
  assert.equal(detectHintType("best sci fi book"), "book");
  assert.equal(detectHintType("classic tv show"), "tv");
  assert.equal(detectHintType("epic movie"), "movie");
});

test("hashString is deterministic", () => {
  assert.equal(hashString("dune"), hashString("dune"));
  assert.notEqual(hashString("dune"), hashString("dunes"));
});

test("buildCacheKey separates same title when year hints differ", () => {
  const dune1984 = normalizeQuery("Dune (1984) movie");
  const dune2021 = normalizeQuery("Dune (2021) movie");

  assert.notEqual(buildCacheKey(dune1984), buildCacheKey(dune2021));
});

test("buildCacheKey separates same title when media hints differ", () => {
  const atlasBook = normalizeQuery("Atlas book");
  const atlasMovie = normalizeQuery("Atlas movie");

  assert.notEqual(buildCacheKey(atlasBook), buildCacheKey(atlasMovie));
});
