import test from "node:test";
import assert from "node:assert/strict";

import { chooseCandidate, rankCandidates } from "../src/core/disambiguate.js";

const candidates = [
  { id: "1", title: "Dune", mediaType: "movie", year: 2021 },
  { id: "2", title: "Dune", mediaType: "movie", year: 1984 },
  { id: "3", title: "Dune Messiah", mediaType: "book", year: 1969 },
];

test("rankCandidates prioritizes exact title and year", () => {
  const ranked = rankCandidates(candidates, { query: "Dune", hintYear: 2021, hintType: "movie" });
  assert.equal(ranked[0].id, "1");
});

test("chooseCandidate returns ambiguity for close ties", () => {
  const ranked = rankCandidates(candidates, { query: "Dune", hintType: "movie" });
  const picked = chooseCandidate(ranked);
  assert.equal(picked.status, "ambiguous");
});
