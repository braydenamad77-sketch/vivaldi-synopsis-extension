import { normalizeTitleForCompare } from "./normalize";
import type { Candidate, MediaType, NormalizedQuery } from "../types";

const BOOK_RECENCY_FLOOR_YEAR = 1900;
const BOOK_RECENCY_CEILING_YEAR = 2025;
const BOOK_RECENCY_MAX_BOOST = 0.05;
export const AMBIGUITY_CANDIDATE_MAX = 6;

type RankedCandidate = Candidate & { score: number };
type CandidateDecision =
  | { status: "not_found" }
  | { status: "resolved"; candidate: RankedCandidate }
  | { status: "ambiguous"; candidates: Candidate[] };

function diceCoefficient(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const gram = a.slice(i, i + 2);
    bigrams.set(gram, (bigrams.get(gram) || 0) + 1);
  }

  let overlap = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const gram = b.slice(i, i + 2);
    const count = bigrams.get(gram) || 0;
    if (count > 0) {
      bigrams.set(gram, count - 1);
      overlap += 1;
    }
  }

  return (2 * overlap) / (a.length + b.length - 2);
}

function mediaTypeScore(candidateType: MediaType | undefined, hintType: MediaType | undefined) {
  if (!hintType) return 0;
  return candidateType === hintType ? 0.12 : -0.06;
}

function yearScore(candidateYear: number | undefined, hintYear: number | undefined) {
  if (!hintYear) return 0;
  if (!candidateYear) return -0.015;
  const diff = Math.abs(candidateYear - hintYear);
  if (diff === 0) return 0.16;
  if (diff <= 1) return 0.08;
  if (diff <= 3) return 0.03;
  return -0.05;
}

function providerPrior(candidate: Candidate) {
  // Title-only usage is common; when ties happen, prefer TMDB to keep movies/TV visible.
  if (candidate.provider === "tmdb") return 0.1;
  return 0;
}

function tmdbPopularityBonus(candidate: Candidate) {
  if (candidate.provider !== "tmdb") return 0;

  const popularity = Number(candidate.popularity || 0);
  const votes = Number(candidate.voteCount || 0);
  const popPart = Math.min(0.07, Math.log1p(Math.max(0, popularity)) / 25);
  const votePart = Math.min(0.05, Math.log1p(Math.max(0, votes)) / 80);
  return popPart + votePart;
}

function bookRecencyBoost(candidate: Candidate) {
  if (candidate?.mediaType !== "book") return 0;

  const year = Number(candidate?.year);
  if (!Number.isFinite(year)) return 0;

  const clampedYear = Math.min(BOOK_RECENCY_CEILING_YEAR, Math.max(BOOK_RECENCY_FLOOR_YEAR, year));
  const normalized = (clampedYear - BOOK_RECENCY_FLOOR_YEAR) / (BOOK_RECENCY_CEILING_YEAR - BOOK_RECENCY_FLOOR_YEAR);
  return normalized * BOOK_RECENCY_MAX_BOOST;
}

function preferAudiovisual(candidate: Candidate) {
  return candidate.mediaType === "movie" || candidate.mediaType === "tv";
}

function dedupeKeyForBook(candidate: Candidate) {
  const titleKey = normalizeTitleForCompare(candidate.title);
  const authorKey = normalizeTitleForCompare(candidate.authorOrDirector || "");
  const yearBucket = candidate.year ? String(candidate.year) : "unknown";
  return `${titleKey}::${authorKey}::${yearBucket}`;
}

export function collapseBookCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Map<string, Candidate>();
  const result: Candidate[] = [];

  for (const candidate of candidates) {
    if (candidate.mediaType !== "book" || candidate.provider !== "openlibrary") {
      result.push(candidate);
      continue;
    }

    const key = dedupeKeyForBook(candidate);
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, candidate);
      result.push(candidate);
      continue;
    }

    const existingIndex = result.indexOf(existing);
    const shouldReplace = Boolean(candidate.artworkUrl) && !existing.artworkUrl;
    if (shouldReplace && existingIndex >= 0) {
      result[existingIndex] = candidate;
      seen.set(key, candidate);
    }
  }

  return result;
}

function compareRankedCandidates(a: RankedCandidate, b: RankedCandidate) {
  if (b.score !== a.score) return b.score - a.score;

  if (a.provider !== b.provider) {
    if (a.provider === "tmdb") return -1;
    if (b.provider === "tmdb") return 1;
  }

  const aIsAv = preferAudiovisual(a);
  const bIsAv = preferAudiovisual(b);
  if (aIsAv !== bIsAv) {
    return aIsAv ? -1 : 1;
  }

  if (a.provider === "tmdb" && b.provider === "tmdb") {
    const popDiff = Number(b.popularity || 0) - Number(a.popularity || 0);
    if (popDiff !== 0) return popDiff;

    const voteDiff = Number(b.voteCount || 0) - Number(a.voteCount || 0);
    if (voteDiff !== 0) return voteDiff;
  }

  return 0;
}

export function selectAmbiguousCandidates(ranked: RankedCandidate[], max = AMBIGUITY_CANDIDATE_MAX): Candidate[] {
  const audiovisual = ranked.filter((candidate) => preferAudiovisual(candidate));
  const books = ranked.filter((candidate) => candidate.mediaType === "book");

  if (!audiovisual.length || !books.length) {
    return ranked.slice(0, max).map(({ score, ...candidate }) => candidate);
  }

  const selected: RankedCandidate[] = [];
  const takeAv = Math.min(3, audiovisual.length);
  const takeBooks = Math.min(3, books.length);

  selected.push(...audiovisual.slice(0, takeAv));
  selected.push(...books.slice(0, takeBooks));

  if (selected.length < max) {
    const usedIds = new Set(selected.map((item) => item.id));
    for (const candidate of ranked) {
      if (selected.length >= max) break;
      if (!usedIds.has(candidate.id)) {
        selected.push(candidate);
      }
    }
  }

  return selected.slice(0, max).map(({ score, ...candidate }) => candidate);
}

export function rankCandidates(candidates: Candidate[], normalizedQuery: NormalizedQuery): RankedCandidate[] {
  const target = normalizeTitleForCompare(normalizedQuery.query || normalizedQuery.raw || "");

  return candidates
    .map((candidate) => {
      const candidateTitle = normalizeTitleForCompare(candidate.title);
      const titleSimilarity = diceCoefficient(target, candidateTitle);
      const exactBoost = target === candidateTitle ? 0.22 : 0;
      const startsWithBoost = candidateTitle.startsWith(target) || target.startsWith(candidateTitle) ? 0.08 : 0;

      const score =
        titleSimilarity * 0.72 +
        exactBoost +
        startsWithBoost +
        yearScore(candidate.year, normalizedQuery.hintYear) +
        mediaTypeScore(candidate.mediaType, normalizedQuery.hintType) +
        providerPrior(candidate) +
        tmdbPopularityBonus(candidate) +
        bookRecencyBoost(candidate);

      return {
        ...candidate,
        score: Number(score.toFixed(6)),
      };
    })
    .sort(compareRankedCandidates);
}

export function chooseCandidate(ranked: RankedCandidate[]): CandidateDecision {
  if (!ranked || ranked.length === 0) {
    return { status: "not_found" };
  }

  if (ranked.length === 1) {
    return { status: "resolved", candidate: ranked[0] };
  }

  const [top, second] = ranked;
  const gap = top.score - second.score;

  if (top.score >= 1.05 && gap >= 0.12) {
    return { status: "resolved", candidate: top };
  }

  return {
    status: "ambiguous",
    candidates: selectAmbiguousCandidates(ranked, AMBIGUITY_CANDIDATE_MAX),
  };
}
