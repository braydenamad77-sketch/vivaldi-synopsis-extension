import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS } from "../src/config/constants.js";

test("default settings include with-image result UI mode", () => {
  assert.equal(DEFAULT_SETTINGS.resultUiMode, "with_image");
});
