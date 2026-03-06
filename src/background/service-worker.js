import {
  MENU_LABEL_LOOKUP_MANUAL,
  MENU_LABEL_LOOKUP_SELECTION,
  MENU_LOOKUP_MANUAL,
  MENU_LOOKUP_SELECTION,
} from "../config/constants.js";
import { lookupSynopsis, requestAlternatives, resolveAmbiguity } from "./router.js";

const DEBUG_LOGS = false;

function swLog(...args) {
  if (!DEBUG_LOGS) return;
  console.log("[VS][SW]", ...args);
}

async function createContextMenu() {
  swLog("createContextMenu:start");
  chrome.contextMenus.removeAll(() => {
    // This can fail during startup races; safe to ignore and still try creates.
    if (chrome.runtime?.lastError) {
      swLog("createContextMenu:removeAll:lastError", chrome.runtime.lastError.message);
    }

    chrome.contextMenus.create(
      {
        id: MENU_LOOKUP_SELECTION,
        title: MENU_LABEL_LOOKUP_SELECTION,
        contexts: ["selection"],
      },
      () => {
        // Ignore duplicate creation during rapid extension reloads.
        if (chrome.runtime?.lastError) {
          swLog("createContextMenu:createSelection:lastError", chrome.runtime.lastError.message);
        } else {
          swLog("createContextMenu:createSelection:ok");
        }
      },
    );

    chrome.contextMenus.create(
      {
        id: MENU_LOOKUP_MANUAL,
        title: MENU_LABEL_LOOKUP_MANUAL,
        contexts: ["page"],
      },
      () => {
        if (chrome.runtime?.lastError) {
          swLog("createContextMenu:createManual:lastError", chrome.runtime.lastError.message);
        } else {
          swLog("createContextMenu:createManual:ok");
        }
      },
    );
  });
}

if (chrome?.runtime?.onInstalled?.addListener) {
  chrome.runtime.onInstalled.addListener(() => {
    swLog("runtime:onInstalled");
    createContextMenu();
  });
}

if (chrome?.runtime?.onStartup?.addListener) {
  chrome.runtime.onStartup.addListener(() => {
    swLog("runtime:onStartup");
    createContextMenu();
  });
}

swLog("runtime:boot");
createContextMenu();

async function injectUiAssets(tabId) {
  swLog("injectUiAssets:start", { tabId });
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["src/content/card.css"],
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/content/inject-card.js"],
  });
  swLog("injectUiAssets:ok", { tabId });
}

function safeSendMessage(tabId, payload) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, payload, () => {
    if (chrome.runtime?.lastError) {
      swLog("safeSendMessage:lastError", {
        tabId,
        type: payload?.type,
        message: chrome.runtime.lastError.message,
      });
    }
  });
}

function sendMessageWithAck(tabId, payload) {
  if (!tabId) return Promise.resolve(false);

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime?.lastError) {
        swLog("sendMessageWithAck:lastError", {
          tabId,
          type: payload?.type,
          message: chrome.runtime.lastError.message,
        });
        resolve(false);
        return;
      }
      swLog("sendMessageWithAck:response", { tabId, type: payload?.type, response });
      resolve(Boolean(response?.ok));
    });
  });
}

async function ensureUiAssets(tabId) {
  if (!tabId) return false;

  const alreadyReady = await sendMessageWithAck(tabId, { type: "VS_PING" });
  if (alreadyReady) {
    swLog("ensureUiAssets:alreadyReady", { tabId });
    return true;
  }

  try {
    await injectUiAssets(tabId);
  } catch (error) {
    swLog("ensureUiAssets:inject:failed", {
      tabId,
      message: error?.message || String(error),
    });
    return false;
  }

  const readyAfterInject = await sendMessageWithAck(tabId, { type: "VS_PING" });
  swLog("ensureUiAssets:readyAfterInject", { tabId, readyAfterInject });
  return readyAfterInject;
}

async function showManualSearchInput(tabId) {
  if (!tabId) return false;
  swLog("showManualSearchInput:start", { tabId });

  const ready = await ensureUiAssets(tabId);
  if (!ready) {
    swLog("showManualSearchInput:uiNotReady", { tabId });
    return false;
  }

  let delivered = await sendMessageWithAck(tabId, { type: "SHOW_SEARCH_INPUT" });
  swLog("showManualSearchInput:firstAck", { tabId, delivered });
  if (delivered) return true;

  // Retry once in case a page blocks/defers message handlers momentarily.
  delivered = await sendMessageWithAck(tabId, { type: "SHOW_SEARCH_INPUT" });
  swLog("showManualSearchInput:retryAck", { tabId, delivered });
  if (!delivered) {
    swLog("showManualSearchInput:fallbackSendWithoutAck", { tabId });
    safeSendMessage(tabId, { type: "SHOW_SEARCH_INPUT" });
  }

  return true;
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
      autoResolved: true,
    });
    return;
  }

  if (response.status === "ambiguous") {
    safeSendMessage(tabId, {
      type: "SHOW_AMBIGUOUS",
      requestId: response.requestId,
      candidates: response.candidates,
      originalQuery: selectionText,
      note: response.note,
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

if (chrome?.contextMenus?.onClicked?.addListener) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    swLog("contextMenus:onClicked", {
      menuItemId: info?.menuItemId,
      hasSelectionText: Boolean(info?.selectionText),
      pageUrl: info?.pageUrl,
      tabId: tab?.id,
      tabUrl: tab?.url,
    });

    if (!tab?.id) return;

    if (info.menuItemId === MENU_LOOKUP_SELECTION) {
      if (!info.selectionText) return;
      const ready = await ensureUiAssets(tab.id);
      if (!ready) {
        swLog("contextMenus:onClicked:selection:uiNotReady", { tabId: tab.id });
        return;
      }
      await processLookup(info.selectionText, tab.id);
      return;
    }

    if (info.menuItemId === MENU_LOOKUP_MANUAL) {
      await showManualSearchInput(tab.id);
    }
  });
}

if (chrome?.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    swLog("runtime:onMessage", {
      type: message?.type,
      tabId: sender?.tab?.id,
      tabUrl: sender?.tab?.url,
    });

    if (message?.type === "RUN_LOOKUP_QUERY") {
      const tabId = sender?.tab?.id;
      const query = String(message.query || "").trim();

      if (!tabId || !query) {
        sendResponse({
          status: "error",
          errorCode: "INVALID_QUERY",
          message: "Type a title first.",
        });
        return false;
      }

      processLookup(query, tabId)
        .then(() => sendResponse({ status: "ok" }))
        .catch((error) =>
          sendResponse({
            status: "error",
            errorCode: "LOOKUP_FAILED",
            message: error?.message || "Lookup failed.",
          }),
        );

      return true;
    }

    if (message?.type === "REQUEST_ALTERNATIVES") {
      requestAlternatives(message)
        .then((response) => sendResponse(response))
        .catch((error) =>
          sendResponse({
            status: "error",
            errorCode: "ALTERNATIVES_LOOKUP_FAILED",
            message: error?.message || "Could not load alternative matches.",
          }),
        );
      return true;
    }

    if (message?.type === "OPEN_SEARCH_IN_ACTIVE_TAB") {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tabId = tabs?.[0]?.id;
        if (!tabId) {
          sendResponse({
            status: "error",
            errorCode: "NO_ACTIVE_TAB",
            message: "Could not find the active tab.",
          });
          return;
        }

        try {
          const opened = await showManualSearchInput(tabId);
          if (!opened) {
            sendResponse({
              status: "error",
              errorCode: "SEARCH_INPUT_UNAVAILABLE",
              message: "Manual search could not open on this page.",
            });
            return;
          }

          sendResponse({ status: "ok" });
        } catch (error) {
          sendResponse({
            status: "error",
            errorCode: "SEARCH_INPUT_FAILED",
            message: error?.message || "Could not open manual search on this page.",
          });
        }
      });

      return true;
    }

    if (message?.type !== "RESOLVE_AMBIGUITY") return false;

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
}
