const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite-preview";

function toDataUrl(buffer) {
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

function cleanText(value) {
  return String(value || "")
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^description\s*:\s*/i, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractVisibleDescriptionFromScreenshots({
  title,
  author,
  year,
  screenshots,
  openrouterApiKey,
  openrouterModel,
}) {
  if (!openrouterApiKey) {
    return {
      status: "extraction_failed",
      debug: {
        reason: "Missing OpenRouter API key.",
      },
    };
  }

  if (!Array.isArray(screenshots) || !screenshots.length) {
    return {
      status: "extraction_failed",
      debug: {
        reason: "No Goodreads screenshots were captured.",
      },
    };
  }

  const requestPayload = {
    model: openrouterModel || DEFAULT_MODEL,
    temperature: 0,
    max_tokens: 900,
    messages: [
      {
        role: "system",
        content:
          "You extract only the visible Goodreads book description from screenshots. Do not summarize. Ignore ratings, reviews, ads, author bios, recommendations, navigation, and any unrelated page text. If no clear book description is visible, reply with exactly NO_DESCRIPTION_FOUND.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Read the Goodreads screenshots and return only the visible book description text as plain text.",
              "Do not paraphrase and do not add commentary.",
              "Ignore reviews, ratings, shelves, ads, recommendations, and author biography sections.",
              `Title: ${title || "Unknown"}`,
              `Author: ${author || "Unknown"}`,
              `Year: ${year || "Unknown"}`,
            ].join("\n"),
          },
          ...screenshots.map((buffer) => ({
            type: "image_url",
            image_url: {
              url: toDataUrl(buffer),
            },
          })),
        ],
      },
    ],
  };

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openrouterApiKey}`,
    },
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
    return {
      status: "extraction_failed",
      debug: {
        reason: `OpenRouter extraction failed: ${response.status}.`,
        model: requestPayload.model,
        rawOutput: "",
      },
    };
  }

  const data = await response.json();
  const rawOutput = String(data?.choices?.[0]?.message?.content || "").trim();
  const content = cleanText(rawOutput);
  if (!content || /^NO_DESCRIPTION_FOUND$/i.test(content)) {
    return {
      status: "extraction_failed",
      debug: {
        reason: "No clear Goodreads description was found in the screenshots.",
        model: requestPayload.model,
        rawOutput,
      },
    };
  }

  return {
    status: "ok",
    descriptionText: content,
    debug: {
      model: requestPayload.model,
      extractedCharacters: content.length,
      rawOutput,
    },
  };
}
