import { LLM_TIMEOUT_MS } from "../config/constants.js";

function buildPrompt({ title, mediaType, year, author, directorOrCreator, cast, synopsis }) {
  const metadataLines = [
    `Title: ${title || "Unknown"}`,
    `Media Type: ${mediaType || "Unknown"}`,
    `Year: ${year || "Unknown"}`,
    `Author: ${author || "Unknown"}`,
    `Director/Creator: ${directorOrCreator || "Unknown"}`,
    `Cast: ${Array.isArray(cast) && cast.length ? cast.join(", ") : "Unknown"}`,
  ];

  return [
    "Rewrite this into a concise NON-SPOILER synopsis.",
    "Rules:",
    "- Premise/setup only.",
    "- No ending, twists, reveals, deaths, or late-story events.",
    "- 60 to 90 words.",
    "- Neutral, informative tone.",
    "- Return plain text only.",
    "",
    ...metadataLines,
    "",
    `Source Text: ${synopsis || ""}`,
  ].join("\n");
}

export async function rewriteSynopsisWithOpenRouter(input, settings) {
  if (!settings.openrouterApiKey) {
    throw new Error("OpenRouter API key missing");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.openrouterApiKey}`,
      },
      body: JSON.stringify({
        model: settings.openrouterModel,
        temperature: 0.2,
        max_tokens: 140,
        messages: [
          {
            role: "system",
            content:
              "You are a careful media assistant that writes short, premise-only, non-spoiler synopses.",
          },
          {
            role: "user",
            content: buildPrompt(input),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter request failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("OpenRouter returned empty response");
    }

    return content;
  } finally {
    clearTimeout(timeout);
  }
}
