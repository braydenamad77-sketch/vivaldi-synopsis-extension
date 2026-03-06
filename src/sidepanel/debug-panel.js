import { clearDebugEvents, getDebugState } from "../debug/store.js";

const els = {
  clearBtn: document.getElementById("clearBtn"),
  stateText: document.getElementById("stateText"),
  events: document.getElementById("events"),
};

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function renderEvent(event) {
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

  if (event.error) {
    const errorLabel = document.createElement("p");
    errorLabel.className = "block-label";
    errorLabel.textContent = "Error";
    const errorPre = document.createElement("pre");
    errorPre.textContent = event.error;
    article.append(errorLabel, errorPre);
  }

  const requestLabel = document.createElement("p");
  requestLabel.className = "block-label";
  requestLabel.textContent = "LLM Input";
  const requestPre = document.createElement("pre");
  requestPre.textContent = JSON.stringify(event.request || {}, null, 2);

  const outputLabel = document.createElement("p");
  outputLabel.className = "block-label";
  outputLabel.textContent = "LLM Raw Output";
  const outputPre = document.createElement("pre");
  outputPre.textContent = event.rawOutput || "(empty)";

  article.append(requestLabel, requestPre, outputLabel, outputPre);
  return article;
}

async function render() {
  const state = await getDebugState();
  els.events.textContent = "";

  if (!state.enabled) {
    els.stateText.textContent = "Debug mode is off. Turn it on from the extension popup.";
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No traces are being recorded right now.";
    els.events.appendChild(empty);
    return;
  }

  els.stateText.textContent = "Debug mode is on. The newest OpenRouter traces appear here.";

  if (!state.events.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No LLM traces yet. Run a lookup that uses OpenRouter.";
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

if (chrome?.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.debugState) return;
    render().catch(() => {});
  });
}

render().catch((error) => {
  els.stateText.textContent = error?.message || "Could not load debug panel.";
});
