import {
  getSynopsisPopupUiFlagVersion,
  MENU_LABEL_LOOKUP_MANUAL,
  MENU_LABEL_LOOKUP_SELECTION,
  MENU_LOOKUP_MANUAL,
  MENU_LOOKUP_SELECTION,
} from "../config/constants";
import { getManualSearchAvailability, SUPPORTED_LOOKUP_PAGE_PATTERNS } from "../core/manual-search";
import { getSettings, lookupSynopsis, requestAlternatives, resolveAmbiguity, runGoodreadsVisualDebugTest } from "./router";
import type { LookupResponse } from "../types";
import type {
  BackgroundRuntimeRequest,
  ContentScriptAckResponse,
  ContentUiMessage,
  StatusErrorResponse,
} from "../runtime/messages";

const DEBUG_LOGS = false;
let backgroundStarted = false;
const CONTENT_SCRIPT_CSS_FILE = "content-scripts/synopsis.css";
const CONTENT_SCRIPT_JS_FILE = "content-scripts/synopsis.js";

function swLog(...args: unknown[]) {
  if (!DEBUG_LOGS) return;
  console.log("[VS][SW]", ...args);
}

function hasTabId(tabId: number | null | undefined): tabId is number {
  return typeof tabId === "number";
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
        documentUrlPatterns: [...SUPPORTED_LOOKUP_PAGE_PATTERNS],
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
        documentUrlPatterns: [...SUPPORTED_LOOKUP_PAGE_PATTERNS],
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

function safeSendMessage(tabId: number, payload: ContentUiMessage) {
  if (!hasTabId(tabId)) return;
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

async function resolveTargetTabId(tab?: chrome.tabs.Tab): Promise<number | null> {
  if (typeof tab?.id === "number") return tab.id;

  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  return typeof tabs?.[0]?.id === "number" ? tabs[0].id : null;
}

function sendMessageWithAck(tabId: number, payload: ContentUiMessage): Promise<boolean> {
  if (!hasTabId(tabId)) return Promise.resolve(false);

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, payload, (response?: ContentScriptAckResponse) => {
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

function pingUi(tabId: number): Promise<ContentScriptAckResponse | null> {
  if (!hasTabId(tabId)) return Promise.resolve(null);

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "VS_PING" }, (response?: ContentScriptAckResponse) => {
      if (chrome.runtime?.lastError) {
        swLog("pingUi:lastError", {
          tabId,
          message: chrome.runtime.lastError.message,
        });
        resolve(null);
        return;
      }

      resolve(response || null);
    });
  });
}

function buildSynopsisUiFlags(settings: Awaited<ReturnType<typeof getSettings>>) {
  const editorialSynopsisPopup = settings.editorialSynopsisPopupEnabled !== false;
  return {
    editorialSynopsisPopup,
    version: getSynopsisPopupUiFlagVersion(editorialSynopsisPopup),
  };
}

async function injectUiAssets(tabId: number): Promise<boolean> {
  if (!hasTabId(tabId)) return false;
  if (!chrome.scripting?.insertCSS || !chrome.scripting?.executeScript) return false;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: [CONTENT_SCRIPT_CSS_FILE],
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_JS_FILE],
    });

    swLog("injectUiAssets:ok", { tabId });
    return true;
  } catch (error) {
    swLog("injectUiAssets:failed", {
      tabId,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function ensureUiAssets(tabId: number): Promise<boolean> {
  if (!hasTabId(tabId)) return false;
  const settings = await getSettings();
  const flags = buildSynopsisUiFlags(settings);

  let ping = await pingUi(tabId);
  const alreadyReady = Boolean(ping?.ok) && ping?.uiFlagVersion === flags.version;
  if (alreadyReady) return true;

  await new Promise((resolve) => setTimeout(resolve, 60));
  ping = await pingUi(tabId);
  if (Boolean(ping?.ok) && ping?.uiFlagVersion === flags.version) {
    swLog("ensureUiAssets:readyAfterRetry", { tabId, uiFlagVersion: ping?.uiFlagVersion });
    return true;
  }

  const injected = await injectUiAssets(tabId);
  if (!injected) return false;

  await new Promise((resolve) => setTimeout(resolve, 60));
  ping = await pingUi(tabId);
  const ready = Boolean(ping?.ok) && ping?.uiFlagVersion === flags.version;
  swLog("ensureUiAssets:readyAfterInject", { tabId, ready, uiFlagVersion: ping?.uiFlagVersion, expectedVersion: flags.version });
  return ready;
}

async function showManualSearchInput(tabId: number): Promise<boolean> {
  if (!hasTabId(tabId)) return false;
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
  if (delivered) return true;

  const reinjected = await injectUiAssets(tabId);
  if (!reinjected) return false;

  await new Promise((resolve) => setTimeout(resolve, 60));
  delivered = await sendMessageWithAck(tabId, { type: "SHOW_SEARCH_INPUT" });
  swLog("showManualSearchInput:afterReinjectAck", { tabId, delivered });

  return delivered;
}

async function processLookup(selectionText: string, tabId: number, options: { widerSearch?: boolean } = {}): Promise<void> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  safeSendMessage(tabId, {
    type: "SHOW_LOADING",
    requestId,
    query: selectionText,
  });

  let response: LookupResponse;
  try {
    response = await lookupSynopsis({
      query: selectionText,
      widerSearch: Boolean(options.widerSearch),
    });
  } catch (error) {
    response = {
      status: "error",
      errorCode: "LOOKUP_FAILED",
      message: error instanceof Error ? error.message : "Lookup failed.",
    };
  }

  if (response.status === "ok") {
    if (!response.result) {
      safeSendMessage(tabId, {
        type: "SHOW_ERROR",
        requestId,
        errorCode: "LOOKUP_RESULT_MISSING",
        message: "Lookup finished without a result payload.",
        lookupQuery: selectionText,
        allowWideSearch: false,
      });
      return;
    }

    safeSendMessage(tabId, {
      type: "SHOW_RESULT",
      requestId,
      result: response.result,
      autoResolved: true,
    });
    return;
  }

  if (response.status === "ambiguous") {
    if (!response.requestId || !response.candidates) {
      safeSendMessage(tabId, {
        type: "SHOW_ERROR",
        requestId,
        errorCode: "AMBIGUITY_RESULT_MISSING",
        message: "Lookup found multiple matches but could not build the chooser.",
        lookupQuery: selectionText,
        allowWideSearch: false,
      });
      return;
    }

    safeSendMessage(tabId, {
      type: "SHOW_AMBIGUOUS",
      requestId,
      ambiguityRequestId: response.requestId,
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
    lookupQuery: response.lookupQuery || selectionText,
    allowWideSearch: Boolean(response.allowWideSearch),
  });
}

export function startBackground() {
  if (backgroundStarted) return;
  backgroundStarted = true;

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

  if (chrome?.contextMenus?.onClicked?.addListener) {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
      const tabId = await resolveTargetTabId(tab);
      swLog("contextMenus:onClicked", {
        menuItemId: info?.menuItemId,
        hasSelectionText: Boolean(info?.selectionText),
        pageUrl: info?.pageUrl,
        tabId: tab?.id,
        tabUrl: tab?.url,
        resolvedTabId: tabId,
      });

      if (!hasTabId(tabId)) return;

      if (info.menuItemId === MENU_LOOKUP_SELECTION) {
        if (!info.selectionText) return;
        const ready = await ensureUiAssets(tabId);
        if (!ready) {
          swLog("contextMenus:onClicked:selection:uiNotReady", { tabId });
          return;
        }
        await processLookup(info.selectionText, tabId);
        return;
      }

      if (info.menuItemId === MENU_LOOKUP_MANUAL) {
        const availability = getManualSearchAvailability(info.pageUrl || tab?.url);
        if (!availability.enabled) {
          swLog("contextMenus:onClicked:manual:unavailable", { tabId, pageLabel: availability.pageLabel });
          return;
        }
        await showManualSearchInput(tabId);
      }
    });
  }

  if (chrome?.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message: BackgroundRuntimeRequest, sender, sendResponse) => {
      swLog("runtime:onMessage", {
        type: message?.type,
        tabId: sender?.tab?.id,
        tabUrl: sender?.tab?.url,
      });

      if (message?.type === "RUN_LOOKUP_QUERY") {
        const tabId = sender?.tab?.id;
        const query = String(message.query || "").trim();

        if (!hasTabId(tabId) || !query) {
          sendResponse({
            status: "error",
            errorCode: "INVALID_QUERY",
            message: "Type a title first.",
          } satisfies StatusErrorResponse);
          return false;
        }

        processLookup(query, tabId, { widerSearch: Boolean(message.widerSearch) })
          .then(() => sendResponse({ status: "ok" }))
          .catch((error: unknown) =>
            sendResponse({
              status: "error",
              errorCode: "LOOKUP_FAILED",
              message: error instanceof Error ? error.message : "Lookup failed.",
            } satisfies StatusErrorResponse),
          );

        return true;
      }

      if (message?.type === "REQUEST_ALTERNATIVES") {
        requestAlternatives(message)
          .then((response) => sendResponse(response))
          .catch((error: unknown) =>
            sendResponse({
              status: "error",
              errorCode: "ALTERNATIVES_LOOKUP_FAILED",
              message: error instanceof Error ? error.message : "Could not load alternative matches.",
            } satisfies StatusErrorResponse),
          );
        return true;
      }

      if (message?.type === "OPEN_SEARCH_IN_ACTIVE_TAB") {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
          const activeTab = tabs?.[0];
          const tabId = activeTab?.id;
          if (!hasTabId(tabId)) {
            sendResponse({
              status: "error",
              errorCode: "NO_ACTIVE_TAB",
              message: "Could not find the active tab.",
            } satisfies StatusErrorResponse);
            return;
          }

          const availability = getManualSearchAvailability(activeTab?.url);
          if (!availability.enabled) {
            sendResponse({
              status: "error",
              errorCode: "SEARCH_INPUT_UNAVAILABLE",
              message: availability.message,
            } satisfies StatusErrorResponse);
            return;
          }

          try {
            const opened = await showManualSearchInput(tabId);
            if (!opened) {
              sendResponse({
                status: "error",
                errorCode: "SEARCH_INPUT_UNAVAILABLE",
                message: "Manual search could not open on this page. Reload the tab and try again.",
              } satisfies StatusErrorResponse);
              return;
            }

            sendResponse({ status: "ok" });
          } catch (error: unknown) {
            sendResponse({
              status: "error",
              errorCode: "SEARCH_INPUT_FAILED",
              message: error instanceof Error ? error.message : "Could not open manual search on this page.",
            } satisfies StatusErrorResponse);
          }
        });

        return true;
      }

      if (message?.type === "OPEN_GOOGLE_RESULT_SEARCH") {
        const query = String(message.query || "").trim();

        if (!query) {
          sendResponse({
            status: "error",
            errorCode: "INVALID_SEARCH_QUERY",
            message: "Could not build a Google search for this result.",
          } satisfies StatusErrorResponse);
          return false;
        }

        chrome.tabs.create(
          {
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          },
          (tab) => {
            if (chrome.runtime?.lastError || !tab?.id) {
              sendResponse({
                status: "error",
                errorCode: "OPEN_GOOGLE_SEARCH_FAILED",
                message: chrome.runtime?.lastError?.message || "Could not open Google search.",
              } satisfies StatusErrorResponse);
              return;
            }

            sendResponse({ status: "ok", tabId: tab.id });
          },
        );

        return true;
      }

      if (message?.type === "RUN_GOODREADS_VISUAL_TEST") {
        runGoodreadsVisualDebugTest()
          .then((response) => sendResponse(response))
          .catch((error: unknown) =>
            sendResponse({
              status: "error",
              errorCode: "GOODREADS_TEST_FAILED",
              message: error instanceof Error ? error.message : "Could not run Goodreads debug test.",
            } satisfies StatusErrorResponse),
          );
        return true;
      }

      if (message?.type !== "RESOLVE_AMBIGUITY") return false;

      resolveAmbiguity(message)
        .then((response) => sendResponse(response))
        .catch((error: unknown) =>
          sendResponse({
            status: "error",
            errorCode: "AMBIGUITY_RESOLVE_FAILED",
            message: error instanceof Error ? error.message : "Could not resolve selection.",
          } satisfies StatusErrorResponse),
        );

      return true;
    });
  }
}
