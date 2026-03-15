import { test } from "vitest";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS } from "../src/config/constants";
import {
  DEFAULT_OPENROUTER_MODEL,
  getOpenRouterModelPreset,
  getOpenRouterModelValue,
  LEGACY_OPENROUTER_MODEL,
  resolveOpenRouterModel,
} from "../src/config/openrouter-models";

test("default settings use Hunter Alpha", () => {
  assert.equal(DEFAULT_SETTINGS.openrouterModel, DEFAULT_OPENROUTER_MODEL);
});

test("model preset detection recognizes Hunter Alpha and legacy", () => {
  assert.equal(getOpenRouterModelPreset(DEFAULT_OPENROUTER_MODEL), "hunter_alpha");
  assert.equal(getOpenRouterModelPreset(LEGACY_OPENROUTER_MODEL), "legacy");
});

test("blank model values resolve to the default preset", () => {
  assert.equal(resolveOpenRouterModel(""), DEFAULT_OPENROUTER_MODEL);
  assert.equal(getOpenRouterModelPreset(""), "hunter_alpha");
});

test("preset values map back to model ids", () => {
  assert.equal(getOpenRouterModelValue("hunter_alpha"), DEFAULT_OPENROUTER_MODEL);
  assert.equal(getOpenRouterModelValue("legacy"), LEGACY_OPENROUTER_MODEL);
});
