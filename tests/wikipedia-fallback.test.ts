import { test } from "vitest";
import assert from "node:assert/strict";

import { rankCandidates } from "../src/core/disambiguate";
import { chooseWikipediaFallbackCandidate } from "../src/background/router";
import { inferWikipediaMediaType } from "../src/providers/wikipedia";

test("chooseWikipediaFallbackCandidate rejects disambiguation-style exact matches", () => {
  const ranked = rankCandidates(
    [
      {
        id: "wikipedia:Dealer",
        provider: "wikipedia",
        title: "Dealer",
        mediaType: "unknown",
        wikiDescription: "Topics referred to by the same term",
      },
      {
        id: "wikipedia:Dealer_(band)",
        provider: "wikipedia",
        title: "Dealer (band)",
        mediaType: "unknown",
        wikiDescription: "Australian band",
      },
    ],
    { query: "dealer" },
  );

  const decision = chooseWikipediaFallbackCandidate(ranked, { query: "dealer" });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reason, "disambiguation_page");
});

test("chooseWikipediaFallbackCandidate rejects weakly related wikipedia titles", () => {
  const ranked = rankCandidates(
    [
      {
        id: "wikipedia:Death_Row_Records",
        provider: "wikipedia",
        title: "Death Row Records",
        mediaType: "unknown",
        wikiDescription: "American record label",
      },
      {
        id: "wikipedia:Drug_Dealer",
        provider: "wikipedia",
        title: "Drug Dealer",
        mediaType: "unknown",
        wikiDescription: "Song by Macklemore",
      },
    ],
    { query: "dealer" },
  );

  const decision = chooseWikipediaFallbackCandidate(ranked, { query: "dealer" });

  assert.equal(decision.status, "rejected");
  assert.equal(decision.reason, "low_title_confidence");
});

test("chooseWikipediaFallbackCandidate accepts a clean exact wikipedia title", () => {
  const ranked = rankCandidates(
    [
      {
        id: "wikipedia:Heat",
        provider: "wikipedia",
        title: "Heat",
        mediaType: "movie",
        wikiDescription: "1995 American crime film",
      },
      {
        id: "wikipedia:Heat_(1995_film_soundtrack)",
        provider: "wikipedia",
        title: "Heat (soundtrack)",
        mediaType: "unknown",
        wikiDescription: "Soundtrack album",
      },
    ],
    { query: "heat", hintType: "movie" },
  );

  const decision = chooseWikipediaFallbackCandidate(ranked, { query: "heat", hintType: "movie" });

  assert.equal(decision.status, "resolved");
  if (decision.status !== "resolved") {
    throw new Error("Expected Wikipedia fallback candidate to resolve");
  }
  assert.equal(decision.candidate.title, "Heat");
});

test("chooseWikipediaFallbackCandidate accepts clarified wikipedia titles when they clearly match", () => {
  const ranked = rankCandidates(
    [
      {
        id: "wikipedia:It_(novel)",
        provider: "wikipedia",
        title: "It (novel)",
        mediaType: "book",
        wikiDescription: "1986 horror novel by Stephen King",
      },
      {
        id: "wikipedia:It_(miniseries)",
        provider: "wikipedia",
        title: "It (miniseries)",
        mediaType: "tv",
        wikiDescription: "1990 television miniseries",
      },
    ],
    { query: "it", hintType: "book" },
  );

  const decision = chooseWikipediaFallbackCandidate(ranked, { query: "it", hintType: "book" });

  assert.equal(decision.status, "resolved");
  if (decision.status !== "resolved") {
    throw new Error("Expected clarified Wikipedia title to resolve");
  }
  assert.equal(decision.candidate.title, "It (novel)");
});

test("inferWikipediaMediaType recognizes books, TV, and movies from descriptions", () => {
  assert.equal(inferWikipediaMediaType("2015 novel by Example Author"), "book");
  assert.equal(inferWikipediaMediaType("American television series"), "tv");
  assert.equal(inferWikipediaMediaType("2020 documentary film"), "movie");
  assert.equal(inferWikipediaMediaType("company", "book"), "book");
});
