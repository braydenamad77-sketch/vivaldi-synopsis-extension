import assert from "node:assert/strict";
import { test } from "vitest";

import { isStaleLookupResponse, trackLatestLookupRequest } from "../src/content/request-state";

test("trackLatestLookupRequest keeps the newest started request id", () => {
  assert.equal(trackLatestLookupRequest("", "req-1"), "req-1");
  assert.equal(trackLatestLookupRequest("req-1", "req-2"), "req-2");
  assert.equal(trackLatestLookupRequest("req-2", undefined), "req-2");
});

test("isStaleLookupResponse ignores older responses after a newer lookup has started", () => {
  assert.equal(isStaleLookupResponse("req-2", "req-1"), true);
  assert.equal(isStaleLookupResponse("req-2", "req-2"), false);
  assert.equal(isStaleLookupResponse("", "req-1"), false);
  assert.equal(isStaleLookupResponse("req-2", undefined), false);
});
