import test from "node:test";
import assert from "node:assert/strict";

import { chooseCandidate, collapseBookCandidates, rankCandidates } from "../src/core/disambiguate.js";

const candidates = [
  { id: "1", provider: "tmdb", title: "Dune", mediaType: "movie", year: 2021, popularity: 400, voteCount: 18000 },
  { id: "2", provider: "tmdb", title: "Dune", mediaType: "movie", year: 1984, popularity: 22, voteCount: 1700 },
  { id: "3", provider: "openlibrary", title: "Dune Messiah", mediaType: "book", year: 1969 },
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

test("collapseBookCandidates merges near-identical Open Library editions", () => {
  const raw = [
    { id: "m1", provider: "tmdb", title: "The Greatest Showman", mediaType: "movie", year: 2017 },
    {
      id: "b1",
      provider: "openlibrary",
      title: "The Greatest Showman",
      mediaType: "book",
      year: 2018,
      authorOrDirector: "Benj Pasek",
    },
    {
      id: "b2",
      provider: "openlibrary",
      title: "The greatest showman",
      mediaType: "book",
      year: 2018,
      authorOrDirector: "Benj Pasek",
      artworkUrl: "https://covers.openlibrary.org/b/id/123-L.jpg",
    },
    {
      id: "b3",
      provider: "openlibrary",
      title: "The Greatest Showman",
      mediaType: "book",
      year: 2018,
      authorOrDirector: "Michael Gracey",
    },
  ];

  const collapsed = collapseBookCandidates(raw);

  assert.equal(collapsed.length, 3);
  assert.equal(collapsed.some((item) => item.id === "b2"), true);
  assert.equal(collapsed.some((item) => item.id === "b1"), false);
});

test("chooseCandidate includes both audiovisual and book options when mixed", () => {
  const mixed = [
    { id: "m1", provider: "tmdb", title: "The Greatest Showman", mediaType: "movie", year: 2017, popularity: 260, voteCount: 9200 },
    { id: "t1", provider: "tmdb", title: "The Greatest Showman", mediaType: "tv", year: 2017, popularity: 12, voteCount: 80 },
    { id: "b1", provider: "openlibrary", title: "The Greatest Showman", mediaType: "book", year: 2018, authorOrDirector: "Benj Pasek" },
    { id: "b2", provider: "openlibrary", title: "The Greatest Showman", mediaType: "book", year: 2018, authorOrDirector: "Michael Gracey" },
    { id: "b3", provider: "openlibrary", title: "The Greatest Showman", mediaType: "book", year: 2018, authorOrDirector: "Another Author" },
  ];

  const ranked = rankCandidates(mixed, { query: "The Greatest Showman" });
  const picked = chooseCandidate(ranked);

  assert.equal(picked.status, "ambiguous");
  assert.equal(picked.candidates.some((item) => item.mediaType === "movie" || item.mediaType === "tv"), true);
  assert.equal(picked.candidates.some((item) => item.mediaType === "book"), true);
});
