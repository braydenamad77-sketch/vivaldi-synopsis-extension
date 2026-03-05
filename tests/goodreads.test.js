import test from "node:test";
import assert from "node:assert/strict";

import { parseGoodreadsFromHtml } from "../src/providers/goodreads.js";

function buildHtml(payload) {
  return `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`;
}

test("parseGoodreadsFromHtml extracts stripped description, author, year, and genres", () => {
  const payload = {
    props: {
      pageProps: {
        apolloState: {
          "Contributor:1": {
            __typename: "Contributor",
            name: "Nikki Sloane",
          },
          "Book:1": {
            __typename: "Book",
            title: "The Pool Boy",
            'description({"stripped":true})': "Nothing says happy birthday like catching your husband in a compromising position.",
            bookGenres: [
              { genre: { name: "Romance" } },
              { genre: { name: "Contemporary Romance" } },
            ],
            primaryContributorEdge: { __ref: "Contributor:1" },
            details: {
              publicationTime: 1596870000000,
            },
          },
        },
      },
    },
  };

  const parsed = parseGoodreadsFromHtml(buildHtml(payload), {
    title: "The Pool Boy",
    author: "Nikki Sloane",
    year: 2020,
  });

  assert.equal(parsed.title, "The Pool Boy");
  assert.equal(parsed.author, "Nikki Sloane");
  assert.equal(parsed.year, 2020);
  assert.equal(parsed.synopsisSource.startsWith("Nothing says happy birthday"), true);
  assert.deepEqual(parsed.genres.slice(0, 2), ["Romance", "Contemporary Romance"]);
});

test("parseGoodreadsFromHtml rejects mismatched title/author candidates", () => {
  const payload = {
    props: {
      pageProps: {
        apolloState: {
          "Contributor:1": {
            __typename: "Contributor",
            name: "Someone Else",
          },
          "Book:1": {
            __typename: "Book",
            title: "Totally Different Book",
            'description({"stripped":true})': "A mismatched description.",
            bookGenres: [{ genre: { name: "Comedy" } }],
            primaryContributorEdge: { __ref: "Contributor:1" },
            details: {
              publicationTime: 1596870000000,
            },
          },
        },
      },
    },
  };

  const parsed = parseGoodreadsFromHtml(buildHtml(payload), {
    title: "The Pool Boy",
    author: "Nikki Sloane",
    year: 2020,
  });

  assert.equal(parsed, undefined);
});
