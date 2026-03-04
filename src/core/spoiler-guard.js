import { SPOILER_PATTERNS } from "../config/constants.js";

function splitSentences(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function wordCount(text) {
  return (text.match(/\b[\w'-]+\b/g) || []).length;
}

export function looksSpoilery(text) {
  const content = (text || "").trim();
  if (!content) return true;
  return SPOILER_PATTERNS.some((pattern) => pattern.test(content));
}

export function trimToWordLimit(text, maxWords = 90) {
  const words = (text || "").split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

export function safeTemplate(metadata = {}) {
  const role = metadata.mediaType === "book" ? "main character" : "central character";
  return `${metadata.title || "This story"} follows a ${role} facing escalating challenges, relationships, and choices that define the journey's premise.`;
}

export function sanitizeSynopsis(rawText, metadata = {}) {
  const sentences = splitSentences(rawText);
  const safeSentences = sentences.filter((sentence) => !looksSpoilery(sentence));

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
