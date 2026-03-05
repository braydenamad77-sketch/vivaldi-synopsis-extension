import test from "node:test";
import assert from "node:assert/strict";

import { normalizeQuery, detectHintType, hashString } from "../src/core/normalize.js";

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

test("detectHintType identifies media hints", () => {
  assert.equal(detectHintType("best sci fi book"), "book");
  assert.equal(detectHintType("classic tv show"), "tv");
  assert.equal(detectHintType("epic movie"), "movie");
});

test("hashString is deterministic", () => {
  assert.equal(hashString("dune"), hashString("dune"));
  assert.notEqual(hashString("dune"), hashString("dunes"));
});
