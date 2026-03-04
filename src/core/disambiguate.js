import { normalizeTitleForCompare } from "./normalize.js";

function diceCoefficient(a, b) {
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

function mediaTypeScore(candidateType, hintType) {
  if (!hintType) return 0;
  return candidateType === hintType ? 0.12 : -0.06;
}

function yearScore(candidateYear, hintYear) {
  if (!hintYear) return 0;
  if (!candidateYear) return -0.02;
  const diff = Math.abs(candidateYear - hintYear);
  if (diff === 0) return 0.2;
  if (diff <= 1) return 0.08;
  if (diff <= 3) return 0.02;
  return -0.06;
}

export function rankCandidates(candidates, normalizedQuery) {
  const target = normalizeTitleForCompare(normalizedQuery.query || normalizedQuery.raw);

  return candidates
    .map((candidate) => {
      const candidateTitle = normalizeTitleForCompare(candidate.title);
      const titleSimilarity = diceCoefficient(target, candidateTitle);
      const exactBoost = target === candidateTitle ? 0.2 : 0;
      const startsWithBoost = candidateTitle.startsWith(target) || target.startsWith(candidateTitle) ? 0.08 : 0;

      const score =
        titleSimilarity * 0.7 +
        exactBoost +
        startsWithBoost +
        yearScore(candidate.year, normalizedQuery.hintYear) +
        mediaTypeScore(candidate.mediaType, normalizedQuery.hintType);

      return {
        ...candidate,
        score: Math.max(0, Math.min(1, Number(score.toFixed(4)))),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function chooseCandidate(ranked) {
  if (!ranked || ranked.length === 0) {
    return { status: "not_found" };
  }

  if (ranked.length === 1) {
    return { status: "resolved", candidate: ranked[0] };
  }

  const [top, second] = ranked;
  const gap = top.score - second.score;

  if (top.score >= 0.84 && gap >= 0.12) {
    return { status: "resolved", candidate: top };
  }

  return {
    status: "ambiguous",
    candidates: ranked.slice(0, 5).map(({ score, ...candidate }) => candidate),
  };
}
