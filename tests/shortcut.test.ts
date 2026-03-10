import { test } from "vitest";
import assert from "node:assert/strict";

import {
  DEFAULT_SEARCH_SHORTCUT_KEY,
  formatShortcutLabel,
  isConfigurableShortcutKey,
  isShortcutMatch,
  normalizeShortcutKey,
} from "../src/core/shortcut";

test("normalizeShortcutKey defaults to backslash", () => {
  assert.equal(normalizeShortcutKey(""), DEFAULT_SEARCH_SHORTCUT_KEY);
  assert.equal(normalizeShortcutKey("backslash"), "\\");
  assert.equal(normalizeShortcutKey("A"), "a");
});

test("formatShortcutLabel gives readable backslash copy", () => {
  assert.equal(formatShortcutLabel("\\"), "Backslash (\\)");
});

test("isShortcutMatch supports plain backslash keypress", () => {
  assert.equal(
    isShortcutMatch({ key: "\\", code: "Backslash", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, "\\"),
    true,
  );
});

test("isShortcutMatch supports physical backslash keycodes", () => {
  assert.equal(
    isShortcutMatch(
      { key: "Unidentified", code: "Backslash", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false },
      "\\",
    ),
    true,
  );

  assert.equal(
    isShortcutMatch(
      { key: "Unidentified", code: "IntlBackslash", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false },
      "\\",
    ),
    true,
  );
});

test("isShortcutMatch treats saved letter shortcuts case-insensitively", () => {
  assert.equal(
    isShortcutMatch({ key: "A", code: "KeyA", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }, "a"),
    true,
  );
});

test("isConfigurableShortcutKey rejects shift-modified shortcuts", () => {
  assert.equal(
    isConfigurableShortcutKey({ key: "A", code: "KeyA", metaKey: false, ctrlKey: false, altKey: false, shiftKey: true }),
    false,
  );
});
