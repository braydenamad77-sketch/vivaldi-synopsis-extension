import { test } from "vitest";
import assert from "node:assert/strict";

import { AMBIGUITY_CANDIDATE_MAX, chooseCandidate, collapseBookCandidates, rankCandidates } from "../src/core/disambiguate";

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
  const mergedBook = collapsed.find((item) => item.id === "b2");
  assert.deepEqual(mergedBook?.goodreadsIds || [], []);
});

test("collapseBookCandidates preserves identifiers from duplicate Open Library rows", () => {
  const collapsed = collapseBookCandidates([
    {
      id: "b1",
      provider: "openlibrary",
      title: "Atlas",
      mediaType: "book",
      year: 2018,
      authorOrDirector: "Example Author",
      goodreadsIds: ["111"],
    },
    {
      id: "b2",
      provider: "openlibrary",
      title: "Atlas",
      mediaType: "book",
      year: 2018,
      authorOrDirector: "Example Author",
      artworkUrl: "https://covers.openlibrary.org/b/id/123-L.jpg",
      isbn13: ["9781234567890"],
    },
  ]);

  assert.equal(collapsed.length, 1);
  assert.deepEqual(collapsed[0].goodreadsIds, ["111"]);
  assert.deepEqual(collapsed[0].isbn13, ["9781234567890"]);
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
  if (picked.status !== "ambiguous") {
    throw new Error("Expected ambiguous candidates");
  }
  assert.equal(picked.candidates.some((item) => item.mediaType === "movie" || item.mediaType === "tv"), true);
  assert.equal(picked.candidates.some((item) => item.mediaType === "book"), true);
});

test("chooseCandidate returns 3 audiovisual and 3 books when both are available", () => {
  const mixed = [
    { id: "m1", provider: "tmdb", title: "Atlas", mediaType: "movie", year: 2025, popularity: 600, voteCount: 15000 },
    { id: "m2", provider: "tmdb", title: "Atlas", mediaType: "movie", year: 2021, popularity: 300, voteCount: 5000 },
    { id: "t1", provider: "tmdb", title: "Atlas", mediaType: "tv", year: 2023, popularity: 250, voteCount: 2400 },
    { id: "t2", provider: "tmdb", title: "Atlas", mediaType: "tv", year: 2019, popularity: 100, voteCount: 900 },
    { id: "b1", provider: "openlibrary", title: "Atlas", mediaType: "book", year: 2025, authorOrDirector: "A One" },
    { id: "b2", provider: "openlibrary", title: "Atlas", mediaType: "book", year: 2020, authorOrDirector: "A Two" },
    { id: "b3", provider: "openlibrary", title: "Atlas", mediaType: "book", year: 2010, authorOrDirector: "A Three" },
    { id: "b4", provider: "openlibrary", title: "Atlas", mediaType: "book", year: 2000, authorOrDirector: "A Four" },
  ];

  const ranked = rankCandidates(mixed, { query: "Atlas" });
  const picked = chooseCandidate(ranked);

  assert.equal(picked.status, "ambiguous");
  if (picked.status !== "ambiguous") {
    throw new Error("Expected ambiguous candidates");
  }
  assert.equal(picked.candidates.length, AMBIGUITY_CANDIDATE_MAX);

  const avCount = picked.candidates.filter((item) => item.mediaType === "movie" || item.mediaType === "tv").length;
  const bookCount = picked.candidates.filter((item) => item.mediaType === "book").length;
  assert.equal(avCount, 3);
  assert.equal(bookCount, 3);
});

test("rankCandidates gives a gentle per-year boost to newer books", () => {
  const ranked = rankCandidates(
    [
      { id: "b-old", provider: "openlibrary", title: "The Correspondent", mediaType: "book", year: 1995 },
      { id: "b-new", provider: "openlibrary", title: "The Correspondent", mediaType: "book", year: 2025 },
    ],
    { query: "The Correspondent" },
  );

  assert.equal(ranked[0].id, "b-new");
  assert.equal(ranked[1].id, "b-old");
  const delta = ranked[0].score - ranked[1].score;
  assert.equal(delta > 0.01 && delta < 0.02, true);
});

test("rankCandidates keeps stronger title matches ahead even when older", () => {
  const ranked = rankCandidates(
    [
      { id: "older-closer", provider: "openlibrary", title: "The Correspondent", mediaType: "book", year: 1995 },
      { id: "newer-weaker", provider: "openlibrary", title: "The Correspondence", mediaType: "book", year: 2025 },
    ],
    { query: "The Correspondent" },
  );

  assert.equal(ranked[0].id, "older-closer");
});

test("rankCandidates clamps book recency boost between 1900 and 2025", () => {
  const ranked = rankCandidates(
    [
      { id: "below-floor", provider: "openlibrary", title: "Atlas", mediaType: "book", year: 1800 },
      { id: "at-floor", provider: "openlibrary", title: "Atlas", mediaType: "book", year: 1900 },
      { id: "at-ceiling", provider: "openlibrary", title: "Atlas", mediaType: "book", year: 2025 },
      { id: "above-ceiling", provider: "openlibrary", title: "Atlas", mediaType: "book", year: 2100 },
    ],
    { query: "Atlas" },
  );

  const scoreById = new Map(ranked.map((item) => [item.id, item.score]));
  const belowFloorScore = scoreById.get("below-floor");
  const atFloorScore = scoreById.get("at-floor");
  const atCeilingScore = scoreById.get("at-ceiling");
  const aboveCeilingScore = scoreById.get("above-ceiling");
  if (
    belowFloorScore === undefined ||
    atFloorScore === undefined ||
    atCeilingScore === undefined ||
    aboveCeilingScore === undefined
  ) {
    throw new Error("Expected all book scores to be present");
  }
  assert.equal(belowFloorScore, atFloorScore);
  assert.equal(atCeilingScore, aboveCeilingScore);
  assert.equal(atCeilingScore > atFloorScore, true);
});

test("rankCandidates leaves non-book ordering behavior intact", () => {
  const ranked = rankCandidates(
    [
      { id: "m-low", provider: "tmdb", title: "Atlas", mediaType: "movie", year: 2020, popularity: 10, voteCount: 100 },
      { id: "m-high", provider: "tmdb", title: "Atlas", mediaType: "movie", year: 2020, popularity: 500, voteCount: 9000 },
      { id: "t-mid", provider: "tmdb", title: "Atlas", mediaType: "tv", year: 2020, popularity: 120, voteCount: 1000 },
    ],
    { query: "Atlas", hintType: "movie" },
  );

  assert.equal(ranked[0].id, "m-high");
  assert.equal(ranked[1].id, "m-low");
});

test("rankCandidates handles missing or invalid book years safely", () => {
  const ranked = rankCandidates(
    [
      { id: "missing-year", provider: "openlibrary", title: "Atlas", mediaType: "book" },
      { id: "invalid-year", provider: "openlibrary", title: "Atlas", mediaType: "book", year: Number.NaN },
      { id: "floor-year", provider: "openlibrary", title: "Atlas", mediaType: "book", year: 1900 },
    ],
    { query: "Atlas" },
  );

  ranked.forEach((item) => assert.equal(Number.isFinite(item.score), true));
  const scoreById = new Map(ranked.map((item) => [item.id, item.score]));
  assert.equal(scoreById.get("missing-year"), scoreById.get("invalid-year"));
  assert.equal(scoreById.get("missing-year"), scoreById.get("floor-year"));
});
