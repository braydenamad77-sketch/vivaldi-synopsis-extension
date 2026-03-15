import { test } from "vitest";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS } from "../src/config/constants";

test("default settings include with-image result UI mode", () => {
  assert.equal(DEFAULT_SETTINGS.resultUiMode, "with_image");
});

test("default settings include backslash manual search shortcut", () => {
  assert.equal(DEFAULT_SETTINGS.searchShortcutKey, "\\");
});

test("default settings enable Goodreads visual fallback on localhost", () => {
  assert.equal(DEFAULT_SETTINGS.goodreadsVisualFallbackEnabled, true);
  assert.equal(DEFAULT_SETTINGS.goodreadsHelperUrl, "http://127.0.0.1:4317");
});
