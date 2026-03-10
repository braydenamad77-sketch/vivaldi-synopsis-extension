import { LLM_SOURCE_TEXT_MAX_WORDS } from "../config/constants";
import { clearDebugEvents, getDebugState } from "../debug/store";
import type { DebugEvent, GoodreadsTestDebugEvent, LlmDebugEvent, LookupDebugEvent } from "../debug/types";
import type { GoodreadsVisualTestResponse } from "../runtime/messages";

function byId<T extends HTMLElement>(id: string) {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing required sidepanel element: #${id}`);
  }
  return element as T;
}

const els = {
  clearBtn: byId<HTMLButtonElement>("clearBtn"),
  goodreadsTestBtn: byId<HTMLButtonElement>("goodreadsTestBtn"),
  stateText: byId<HTMLParagraphElement>("stateText"),
  events: byId<HTMLElement>("events"),
};

function formatTime(value: string | number | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function renderLookupEvent(article: HTMLElement, event: LookupDebugEvent) {
  const queryLabel = document.createElement("p");
  queryLabel.className = "block-label";
  queryLabel.textContent = "Lookup Query";
  const queryPre = document.createElement("pre");
  queryPre.textContent = event.query || "(empty)";

  const modeLabel = document.createElement("p");
  modeLabel.className = "block-label";
  modeLabel.textContent = "Lookup Mode";
  const modePre = document.createElement("pre");
  modePre.textContent = event.lookupMode || "default";

  const normalizedLabel = document.createElement("p");
  normalizedLabel.className = "block-label";
  normalizedLabel.textContent = "Normalized Query";
  const normalizedPre = document.createElement("pre");
  normalizedPre.textContent = JSON.stringify(event.normalizedQuery, null, 2);

  const healthLabel = document.createElement("p");
  healthLabel.className = "block-label";
  healthLabel.textContent = "Provider Health";
  const healthPre = document.createElement("pre");
  healthPre.textContent = JSON.stringify(event.providerHealth, null, 2);

  const detailLabel = document.createElement("p");
  detailLabel.className = "block-label";
  detailLabel.textContent = "Decision Detail";
  const detailPre = document.createElement("pre");
  const providerTrace = Array.isArray(event.detail.providerTrace) ? event.detail.providerTrace : [];
  detailPre.textContent = JSON.stringify(
    {
      primaryCandidateCount: event.primaryCandidateCount,
      chosenTitle: event.chosenTitle || "",
      ...Object.fromEntries(Object.entries(event.detail).filter(([key]) => key !== "providerTrace")),
    },
    null,
    2,
  );

  article.append(queryLabel, queryPre, modeLabel, modePre, normalizedLabel, normalizedPre, healthLabel, healthPre, detailLabel, detailPre);

  if (providerTrace.length) {
    const traceLabel = document.createElement("p");
    traceLabel.className = "block-label";
    traceLabel.textContent = "Provider Trace";
    const tracePre = document.createElement("pre");
    tracePre.textContent = JSON.stringify(providerTrace, null, 2);
    article.append(traceLabel, tracePre);
  }
}

function renderGoodreadsTestEvent(article: HTMLElement, event: GoodreadsTestDebugEvent) {
  const helperLabel = document.createElement("p");
  helperLabel.className = "block-label";
  helperLabel.textContent = "Goodreads Helper";
  const helperPre = document.createElement("pre");
  helperPre.textContent = JSON.stringify(
    {
      author: event.author || "",
      helperStatus: event.helperStatus || "",
      resolvedUrl: event.resolvedUrl || "",
      screenshotsCaptured: event.screenshotsCaptured || 0,
      ...event.helperDebug,
    },
    null,
    2,
  );

  article.append(helperLabel, helperPre);

  if (event.previewScreenshot) {
    const screenshotLabel = document.createElement("p");
    screenshotLabel.className = "block-label";
    screenshotLabel.textContent = "Goodreads Screenshot";
    const image = document.createElement("img");
    image.className = "shot";
    image.alt = `${event.title || "Goodreads"} screenshot`;
    image.src = event.previewScreenshot;
    article.append(screenshotLabel, image);
  }

  const providerLabel = document.createElement("p");
  providerLabel.className = "block-label";
  providerLabel.textContent = "Extracted Goodreads Description";
  const providerPre = document.createElement("pre");
  providerPre.textContent = event.providerSourceText || "(empty)";

  const visualLabel = document.createElement("p");
  visualLabel.className = "block-label";
  visualLabel.textContent = `Visual LLM Output${event.visualLlmModel ? ` (${event.visualLlmModel})` : ""}`;
  const visualPre = document.createElement("pre");
  visualPre.textContent = event.visualLlmOutput || "(empty)";

  const synopsisLabel = document.createElement("p");
  synopsisLabel.className = "block-label";
  synopsisLabel.textContent = "Synopsis LLM Request";
  const synopsisPre = document.createElement("pre");
  synopsisPre.textContent = JSON.stringify(event.synopsisRequest, null, 2);

  const synopsisOutputLabel = document.createElement("p");
  synopsisOutputLabel.className = "block-label";
  synopsisOutputLabel.textContent = "Synopsis LLM Output";
  const synopsisOutputPre = document.createElement("pre");
  synopsisOutputPre.textContent = event.synopsisLlmOutput || "(empty)";

  const finalLabel = document.createElement("p");
  finalLabel.className = "block-label";
  finalLabel.textContent = "Final Synopsis";
  const finalPre = document.createElement("pre");
  finalPre.textContent = event.finalSynopsis || "(empty)";

  const genresLabel = document.createElement("p");
  genresLabel.className = "block-label";
  genresLabel.textContent = "Final Genres";
  const genresPre = document.createElement("pre");
  genresPre.textContent = JSON.stringify(event.finalGenres, null, 2);

  article.append(
    providerLabel,
    providerPre,
    visualLabel,
    visualPre,
    synopsisLabel,
    synopsisPre,
    synopsisOutputLabel,
    synopsisOutputPre,
    finalLabel,
    finalPre,
    genresLabel,
    genresPre,
  );

  if (event.error) {
    const errorLabel = document.createElement("p");
    errorLabel.className = "block-label";
    errorLabel.textContent = "Error";
    const errorPre = document.createElement("pre");
    errorPre.textContent = event.error;
    article.append(errorLabel, errorPre);
  }
}

function renderLlmEvent(article: HTMLElement, event: LlmDebugEvent) {
  if (event.error) {
    const errorLabel = document.createElement("p");
    errorLabel.className = "block-label";
    errorLabel.textContent = "Error";
    const errorPre = document.createElement("pre");
    errorPre.textContent = event.error;
    article.append(errorLabel, errorPre);
  }

  const providerLabel = document.createElement("p");
  providerLabel.className = "block-label";
  providerLabel.textContent = "Raw Provider Text";
  const providerPre = document.createElement("pre");
  providerPre.textContent = event.providerSourceText || "(empty)";

  const llmSourceLabel = document.createElement("p");
  llmSourceLabel.className = "block-label";
  llmSourceLabel.textContent = `Text Sent To LLM (${LLM_SOURCE_TEXT_MAX_WORDS}-word cap)`;
  const llmSourcePre = document.createElement("pre");
  llmSourcePre.textContent = event.llmSourceText || "(empty)";

  const requestLabel = document.createElement("p");
  requestLabel.className = "block-label";
  requestLabel.textContent = "LLM Request Payload";
  const requestPre = document.createElement("pre");
  requestPre.textContent = JSON.stringify(event.request, null, 2);

  const outputLabel = document.createElement("p");
  outputLabel.className = "block-label";
  outputLabel.textContent = "LLM Raw Output";
  const outputPre = document.createElement("pre");
  outputPre.textContent = event.rawOutput || "(empty)";

  article.append(providerLabel, providerPre, llmSourceLabel, llmSourcePre, requestLabel, requestPre, outputLabel, outputPre);
}

function renderEvent(event: DebugEvent) {
  const article = document.createElement("article");
  article.className = "event";

  const head = document.createElement("div");
  head.className = "event-head";

  const title = document.createElement("h2");
  title.className = "event-title";
  title.textContent = event.title || "Untitled";

  const pill = document.createElement("span");
  pill.className = `pill ${event.status === "success" ? "success" : "error"}`;
  pill.textContent = event.status || "unknown";

  head.append(title, pill);

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = [event.mediaType, event.year, formatTime(event.createdAt)].filter(Boolean).join(" • ");

  article.append(head, meta);

  if (event.kind === "goodreads_test") {
    renderGoodreadsTestEvent(article, event);
    return article;
  }

  if (event.kind === "lookup") {
    renderLookupEvent(article, event);
    return article;
  }

  renderLlmEvent(article, event);
  return article;
}

async function render(statusMessage?: string) {
  const state = await getDebugState();
  els.events.textContent = "";
  els.goodreadsTestBtn.disabled = !state.enabled;

  if (!state.enabled) {
    els.stateText.textContent = statusMessage || "Debug mode is off. Turn it on from the extension popup.";
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No traces are being recorded right now.";
    els.events.appendChild(empty);
    return;
  }

  els.stateText.textContent = statusMessage || "Debug mode is on. The newest lookup and OpenRouter traces appear here.";

  if (!state.events.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No debug traces yet. Run a lookup to capture provider and LLM details.";
    els.events.appendChild(empty);
    return;
  }

  state.events.forEach((event) => {
    els.events.appendChild(renderEvent(event));
  });
}

els.clearBtn.addEventListener("click", async () => {
  await clearDebugEvents();
  await render();
});

els.goodreadsTestBtn.addEventListener("click", async () => {
  els.goodreadsTestBtn.disabled = true;
  const previous = els.stateText.textContent;
  let finalStatus = "";
  els.stateText.textContent = "Running Goodreads visual test...";

  try {
    const response = (await chrome.runtime.sendMessage({ type: "RUN_GOODREADS_VISUAL_TEST" })) as GoodreadsVisualTestResponse;
    finalStatus =
      response?.status === "ok"
        ? `Goodreads test finished for ${response.title || "book"}.`
        : response?.message || "Goodreads test failed.";
    await render(finalStatus);
  } catch (error: unknown) {
    els.stateText.textContent = error instanceof Error ? error.message : "Could not run Goodreads test.";
  } finally {
    els.goodreadsTestBtn.disabled = !(await getDebugState()).enabled;
    if (!els.events.children.length && !els.stateText.textContent) {
      els.stateText.textContent = previous;
    }
  }
});

if (chrome?.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.debugState) return;
    render().catch(() => {});
  });
}

render().catch((error) => {
  els.stateText.textContent = error?.message || "Could not load debug panel.";
});
