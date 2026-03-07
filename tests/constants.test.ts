import { test } from "vitest";
import assert from "node:assert/strict";

import {
  MENU_LABEL_LOOKUP_MANUAL,
  MENU_LABEL_LOOKUP_SELECTION,
  MENU_LOOKUP_MANUAL,
  MENU_LOOKUP_SELECTION,
} from "../src/config/constants";

test("context menu ids are unique", () => {
  assert.notEqual(MENU_LOOKUP_SELECTION, MENU_LOOKUP_MANUAL);
});

test("context menu labels match expected UX copy", () => {
  assert.equal(MENU_LABEL_LOOKUP_SELECTION, "Get Synopsis");
  assert.equal(MENU_LABEL_LOOKUP_MANUAL, "Search Synopsis");
});
