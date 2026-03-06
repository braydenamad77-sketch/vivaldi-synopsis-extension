import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeSynopsis, looksSpoilery, safeTemplate, trimToWordLimit } from "../src/core/spoiler-guard.js";

test("looksSpoilery catches reveal language", () => {
  assert.equal(looksSpoilery("In the end, the killer is revealed."), true);
});

test("sanitizeSynopsis removes spoilery sentences", () => {
  const text =
    "A young hero leaves home to confront an empire. In the end, the villain is revealed as family.";

  const sanitized = sanitizeSynopsis(text, { title: "Sample" });

  assert.equal(sanitized.includes("revealed"), false);
  assert.equal(sanitized.length > 0, true);
});

test("sanitizeSynopsis falls back to safe template when empty", () => {
  const sanitized = sanitizeSynopsis("In the end the killer is revealed.", { title: "Mystery" });
  assert.equal(sanitized, safeTemplate({ title: "Mystery" }));
});

test("trimToWordLimit keeps higher word caps intact until the limit", () => {
  const text = Array.from({ length: 800 }, (_, index) => `word${index + 1}`).join(" ");
  const trimmed = trimToWordLimit(text, 750);

  assert.equal(trimmed.split(/\s+/).length, 750);
  assert.equal(trimmed.endsWith("..."), true);
});
