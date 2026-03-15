import assert from "node:assert/strict";
import { test } from "vitest";

import {
  SEARCH_OVERLAY_MARGIN_PX,
  SEARCH_OVERLAY_VERTICAL_OFFSET_PX,
  getSearchOverlayPosition,
  shouldCaptureSearchOverlayKey,
} from "../src/content/search-overlay";

test("search overlay position stays centered with a small downward offset", () => {
  const position = getSearchOverlayPosition(
    { width: 1440, height: 900 },
    { width: 470, height: 56 },
  );

  assert.equal(position.left, 485);
  assert.equal(position.top, 434);
  assert.equal(SEARCH_OVERLAY_VERTICAL_OFFSET_PX, 12);
});

test("search overlay position clamps into the viewport margins", () => {
  const position = getSearchOverlayPosition(
    { width: 320, height: 120 },
    { width: 470, height: 80 },
  );

  assert.equal(position.left, SEARCH_OVERLAY_MARGIN_PX);
  assert.equal(position.top, 24);
});

test("search overlay key capture blocks plain typing but keeps control keys available", () => {
  assert.equal(shouldCaptureSearchOverlayKey({ key: "f", metaKey: false, ctrlKey: false, altKey: false }), true);
  assert.equal(shouldCaptureSearchOverlayKey({ key: "Backspace", metaKey: false, ctrlKey: false, altKey: false }), true);
  assert.equal(shouldCaptureSearchOverlayKey({ key: "Enter", metaKey: false, ctrlKey: false, altKey: false }), false);
  assert.equal(shouldCaptureSearchOverlayKey({ key: "f", metaKey: true, ctrlKey: false, altKey: false }), false);
});
