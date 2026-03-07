import { SPOILER_PATTERNS } from "../config/constants";
import type { LookupDetails } from "../types";

function splitSentences(text: string) {
  return (text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((part: string) => part.trim())
    .filter(Boolean);
}

function wordCount(text: string) {
  return (text.match(/\b[\w'-]+\b/g) || []).length;
}

export function looksSpoilery(text: string) {
  const content = (text || "").trim();
  if (!content) return true;
  return SPOILER_PATTERNS.some((pattern) => pattern.test(content));
}

export function trimToWordLimit(text: string, maxWords = 90) {
  const words = (text || "").split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

export function safeTemplate(metadata: Partial<LookupDetails> = {}) {
  const role = metadata.mediaType === "book" ? "main character" : "central character";
  return `${metadata.title || "This story"} follows a ${role} facing escalating challenges, relationships, and choices that define the journey's premise.`;
}

export function sanitizeSynopsis(rawText: string, metadata: Partial<LookupDetails> = {}) {
  const sentences = splitSentences(rawText);
  const safeSentences = sentences.filter((sentence: string) => !looksSpoilery(sentence));

  let candidate = safeSentences.join(" ").trim();
  candidate = trimToWordLimit(candidate, 90);

  if (!candidate || wordCount(candidate) < 14) {
    candidate = safeTemplate(metadata);
  }

  if (looksSpoilery(candidate)) {
    candidate = safeTemplate(metadata);
  }

  return candidate;
}
