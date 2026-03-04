import { MENU_ID } from "../config/constants.js";
import { lookupSynopsis, resolveAmbiguity } from "./router.js";

async function createContextMenu() {
  chrome.contextMenus.remove(MENU_ID, () => {
    // This is expected on first run when the item does not exist yet.
    void chrome.runtime.lastError;

    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: "Get Synopsis",
        contexts: ["selection"],
      },
      () => {
        // Ignore duplicate creation during rapid extension reloads.
        void chrome.runtime.lastError;
      },
    );
  });
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenu();
});
createContextMenu();

async function ensureUiAssets(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["src/content/card.css"],
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content/inject-card.js"],
  });
}

function safeSendMessage(tabId, payload) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, payload, () => {
    void chrome.runtime.lastError;
  });
}

async function processLookup(selectionText, tabId) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  safeSendMessage(tabId, {
    type: "SHOW_LOADING",
    requestId,
    query: selectionText,
  });

  let response;
  try {
    response = await lookupSynopsis({ query: selectionText });
  } catch (error) {
    response = {
      status: "error",
      errorCode: "LOOKUP_FAILED",
      message: error?.message || "Lookup failed.",
    };
  }

  if (response.status === "ok") {
    safeSendMessage(tabId, {
      type: "SHOW_RESULT",
      requestId,
      result: response.result,
    });
    return;
  }

  if (response.status === "ambiguous") {
    safeSendMessage(tabId, {
      type: "SHOW_AMBIGUOUS",
      requestId: response.requestId,
      candidates: response.candidates,
      originalQuery: selectionText,
    });
    return;
  }

  safeSendMessage(tabId, {
    type: "SHOW_ERROR",
    requestId,
    errorCode: response.errorCode || response.status,
    message: response.message || "Could not fetch synopsis.",
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!info.selectionText || !tab?.id) return;

  try {
    await ensureUiAssets(tab.id);
  } catch (_error) {
    return;
  }

  await processLookup(info.selectionText, tab.id);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RESOLVE_AMBIGUITY") {
    return false;
  }

  resolveAmbiguity(message)
    .then((response) => sendResponse(response))
    .catch((error) =>
      sendResponse({
        status: "error",
        errorCode: "AMBIGUITY_RESOLVE_FAILED",
        message: error?.message || "Could not resolve selection.",
      }),
    );

  return true;
});
