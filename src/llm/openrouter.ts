import { LLM_TIMEOUT_MS } from "../config/constants";
import { appendDebugEvent, getDebugState } from "../debug/store";
import type { LlmDebugEvent } from "../debug/types";
import type { AnyRecord, ExtensionSettings, LookupDetails } from "../types";

interface OpenRouterInput extends Partial<LookupDetails> {
  synopsis?: string;
  rawSourceText?: string;
}

interface OpenRouterOptions {
  skipDebugEvent?: boolean;
  includeDebugData?: boolean;
}

function buildPrompt({ title, mediaType, year, author, directorOrCreator, cast, synopsis }: OpenRouterInput) {
  const isBook = mediaType === "book";
  const metadataLines = [
    `Title: ${title || "Unknown"}`,
    `Media Type: ${mediaType || "Unknown"}`,
    `Year: ${year || "Unknown"}`,
    `Author: ${author || "Unknown"}`,
    `Director/Creator: ${directorOrCreator || "Unknown"}`,
    `Cast: ${Array.isArray(cast) && cast.length ? cast.join(", ") : "Unknown"}`,
  ];

  return [
    "Create a compelling NON-SPOILER synopsis and a best-guess genre label.",
    "Output must be valid JSON only using this schema:",
    '{"synopsis":"string","genres":["string","string"]}',
    "Rules:",
    "- Premise/setup only.",
    "- No ending, twists, reveals, deaths, or late-story events.",
    isBook
      ? "- Synopsis length: 95 to 140 words."
      : "- Synopsis length: 60 to 95 words.",
    isBook
      ? "- Tone for books: vivid, hook-forward jacket-copy energy (still factual and non-spoiler)."
      : "- Tone for movie/tv: clear, concise, informative, lightly hooky.",
    isBook
      ? "- For books, write 3 to 4 sentences: setup, character desire, pressure/stakes, and a final teaser sentence without revealing outcomes."
      : "- For movie/tv, keep it tight and premise-led.",
    "- Use concrete details from the source text when available.",
    "- Avoid vague filler. Make the opening line a strong hook.",
    "- Always provide 1 or 2 genre labels in `genres`.",
    "- Prefer common, user-friendly labels when possible (for example: Drama, Romance, Thriller, Fantasy, Sci-Fi, Horror, Comedy, Mystery, Action, Adventure, Crime).",
    "- You may combine related labels with a slash when it helps (example: Romance/Drama).",
    "",
    ...metadataLines,
    "",
    `Source Text: ${synopsis || ""}`,
  ].join("\n");
}

function cleanJsonCandidate(text: string) {
  if (!text) return "";
  const trimmed = text.trim();
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function toTitleCase(value: string) {
  return String(value)
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ""))
    .join(" ")
    .trim();
}

function normalizeGenre(value: string) {
  const cleaned = String(value || "")
    .replace(/^genres?\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;|]+|[,;|]+$/g, "");

  if (!cleaned) return "";

  const slashNormalized = cleaned.replace(/\s*\/\s*/g, "/");
  const titled = slashNormalized
    .split("/")
    .map((part) => toTitleCase(part))
    .filter(Boolean)
    .join("/");

  if (!titled || titled.length > 36) return "";
  return titled;
}

function normalizeGenres(input: string[] | string | undefined) {
  const rawItems = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,;\n]+/g)
      : [];

  const deduped: string[] = [];
  const seen = new Set();

  for (const item of rawItems) {
    const normalized = normalizeGenre(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
    if (deduped.length >= 2) break;
  }

  return deduped;
}

function tryParseJsonObject(rawText: string) {
  const cleaned = cleanJsonCandidate(rawText);
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch (_error) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    const snippet = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(snippet);
    } catch (_nestedError) {
      return null;
    }
  }
}

export function parseOpenRouterOutput(rawText: string) {
  const parsed = tryParseJsonObject(rawText);
  if (parsed && typeof parsed === "object") {
    const synopsis = String(parsed.synopsis || parsed.summary || "").trim();
    const predictedGenres = normalizeGenres(parsed.genres || parsed.genre || parsed.predictedGenres);
    if (synopsis) {
      return { synopsis, predictedGenres };
    }
  }

  const plain = cleanJsonCandidate(rawText);
  const lines = plain
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean);

  const genreLine = lines.find((line) => /^genres?\s*:/i.test(line));
  const predictedGenres = normalizeGenres(genreLine ? genreLine.replace(/^genres?\s*:/i, "") : "");

  const synopsis = lines
    .filter((line: string) => !/^genres?\s*:/i.test(line))
    .join(" ")
    .replace(/^synopsis\s*:/i, "")
    .trim();

  return { synopsis, predictedGenres };
}

export async function rewriteSynopsisWithOpenRouter(
  input: OpenRouterInput,
  settings: Pick<ExtensionSettings, "openrouterApiKey" | "openrouterModel">,
  options: OpenRouterOptions = {},
) {
  if (!settings.openrouterApiKey) {
    throw new Error("OpenRouter API key missing");
  }
  const isBook = input?.mediaType === "book";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  let debugCaptured = false;
  const prompt = buildPrompt(input);
  const requestPayload = {
    model: settings.openrouterModel,
    temperature: isBook ? 0.3 : 0.2,
    max_tokens: isBook ? 280 : 220,
    messages: [
      {
        role: "system",
        content:
          "You are a careful media assistant. Respond with valid JSON only, with non-spoiler synopsis text plus broad audience-friendly genre labels. For books, favor compelling jacket-copy style hooks without spoilers.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  };

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.openrouterApiKey}`,
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      if (!options.skipDebugEvent) {
        await captureDebugEvent({
          input,
          requestPayload,
          rawOutput: "",
          status: "error",
          error: `OpenRouter request failed: ${response.status}`,
        });
      }
      debugCaptured = true;
      throw new Error(`OpenRouter request failed: ${response.status}`);
    }

    const data = (await response.json()) as AnyRecord;
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      if (!options.skipDebugEvent) {
        await captureDebugEvent({
          input,
          requestPayload,
          rawOutput: "",
          status: "error",
          error: "OpenRouter returned empty response",
        });
      }
      debugCaptured = true;
      throw new Error("OpenRouter returned empty response");
    }

    if (!options.skipDebugEvent) {
      await captureDebugEvent({
        input,
        requestPayload,
        rawOutput: content,
        status: "success",
      });
    }
    debugCaptured = true;

    const parsed = parseOpenRouterOutput(content);
    if (options.includeDebugData) {
      return {
        ...parsed,
        debug: {
          requestPayload,
          rawOutput: content,
        },
      };
    }

    return parsed;
  } catch (error) {
    const message = controller.signal.aborted
      ? `OpenRouter request timed out after ${LLM_TIMEOUT_MS}ms.`
      : error instanceof Error
        ? error.message
        : String(error);
    if (!debugCaptured) {
      if (!options.skipDebugEvent) {
        await captureDebugEvent({
          input,
          requestPayload,
          rawOutput: "",
          status: "error",
          error: message,
        });
      }
    }
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

async function captureDebugEvent({
  input,
  requestPayload,
  rawOutput,
  status,
  error = "",
}: {
  input: OpenRouterInput;
  requestPayload: AnyRecord;
  rawOutput: string;
  status: string;
  error?: string;
}) {
  const debugState = await getDebugState();
  if (!debugState.enabled) return;

  const event: LlmDebugEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    kind: "llm",
    status,
    error: error || "",
    title: input?.title || "Unknown",
    mediaType: input?.mediaType || "unknown",
    year: input?.year,
    providerSourceText: String(input?.rawSourceText || ""),
    llmSourceText: String(input?.synopsis || ""),
    request: requestPayload,
    rawOutput: rawOutput || "",
  };

  await appendDebugEvent(event);
}
