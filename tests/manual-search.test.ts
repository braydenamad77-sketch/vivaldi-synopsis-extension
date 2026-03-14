import assert from "node:assert/strict";
import { test } from "vitest";

import { getManualSearchAvailability, SUPPORTED_LOOKUP_PAGE_PATTERNS } from "../src/core/manual-search";

test("supported lookup page patterns stay limited to regular websites", () => {
  assert.deepEqual([...SUPPORTED_LOOKUP_PAGE_PATTERNS], ["http://*/*", "https://*/*"]);
});

test("manual search is enabled on regular websites", () => {
  assert.deepEqual(getManualSearchAvailability("https://www.goodreads.com/book/show/4671"), {
    enabled: true,
    pageLabel: "goodreads.com",
    message: "Manual search opens directly inside this page.",
  });
});

test("manual search keeps meaningful subdomains in the page label", () => {
  assert.deepEqual(getManualSearchAvailability("https://m.example.com/books/42"), {
    enabled: true,
    pageLabel: "m.example.com",
    message: "Manual search opens directly inside this page.",
  });
});

test("manual search is blocked on built-in browser pages", () => {
  assert.deepEqual(getManualSearchAvailability("vivaldi://settings"), {
    enabled: false,
    pageLabel: "vivaldi://settings",
    message: "Manual search only works on regular websites. Built-in browser pages block extension overlays.",
  });
});

test("manual search keeps about pages readable", () => {
  assert.deepEqual(getManualSearchAvailability("about:blank"), {
    enabled: false,
    pageLabel: "about:blank",
    message: "Manual search only works on regular websites. Built-in browser pages block extension overlays.",
  });
});

test("manual search is blocked on local file tabs", () => {
  assert.deepEqual(getManualSearchAvailability("file:///Users/braydenamad/Desktop/book.html"), {
    enabled: false,
    pageLabel: "Local file tab",
    message: "Manual search only works on regular websites right now. Local file tabs are not supported.",
  });
});

test("manual search falls back cleanly when there is no tab url", () => {
  assert.deepEqual(getManualSearchAvailability(), {
    enabled: false,
    pageLabel: "No active page",
    message: "Open a regular website tab to use manual search.",
  });
});

test("manual search gives a clean fallback for unsupported protocols", () => {
  assert.deepEqual(getManualSearchAvailability("mailto:test@example.com"), {
    enabled: false,
    pageLabel: "Unsupported page",
    message: "Manual search only works on http and https pages right now.",
  });
});
