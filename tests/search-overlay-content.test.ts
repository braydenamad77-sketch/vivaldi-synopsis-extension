// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

import { startSynopsisContentScript } from "../src/content/inject-card";

type RuntimeListener = (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
) => boolean | void;

function createChromeHarness() {
  let runtimeListener: RuntimeListener | null = null;

  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(async () => ({
          settings: {
            searchShortcutKey: "\\",
          },
        })),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    runtime: {
      sendMessage: vi.fn(async () => ({ status: "ok" })),
      openOptionsPage: vi.fn(),
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          runtimeListener = listener;
        }),
        removeListener: vi.fn((listener: RuntimeListener) => {
          if (runtimeListener === listener) {
            runtimeListener = null;
          }
        }),
      },
    },
  } as any;

  async function dispatch(message: any) {
    assert.ok(runtimeListener, "runtime listener should be registered");

    return await new Promise<any>((resolve) => {
      const keepOpen = runtimeListener?.(message, {} as chrome.runtime.MessageSender, (response) => resolve(response));
      if (keepOpen !== true) {
        resolve(undefined);
      }
    });
  }

  return {
    chromeMock,
    dispatch,
  };
}

function getSearchCard() {
  return document.getElementById("vivaldi-synopsis-card") as HTMLElement | null;
}

function getSearchInput() {
  return document.querySelector(".vs-search-input") as HTMLInputElement | null;
}

afterEach(() => {
  (window as Window & { __VIVALDI_SYNOPSIS_CLEANUP__?: () => void }).__VIVALDI_SYNOPSIS_CLEANUP__?.();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  Reflect.deleteProperty(document, "activeElement");
});

test("show search input opens a fixed overlay and focuses the field", async () => {
  const harness = createChromeHarness();
  globalThis.chrome = harness.chromeMock;
  document.body.innerHTML = '<button id="launcher">Launch</button>';

  const launcher = document.getElementById("launcher") as HTMLButtonElement;
  launcher.focus();

  startSynopsisContentScript();

  const response = await harness.dispatch({ type: "SHOW_SEARCH_INPUT" });
  const card = getSearchCard();
  const input = getSearchInput();

  assert.ok(card);
  assert.ok(input);
  assert.equal(card.classList.contains("vs-card--search-overlay"), true);
  assert.equal(card.style.position, "fixed");
  assert.equal(document.activeElement, input);
  assert.deepEqual(response, {
    ok: true,
    opened: true,
    focused: true,
  });
});

test("show search input reuses the existing overlay and refocuses it", async () => {
  const harness = createChromeHarness();
  globalThis.chrome = harness.chromeMock;
  document.body.innerHTML = '<button id="launcher">Launch</button>';

  startSynopsisContentScript();

  await harness.dispatch({ type: "SHOW_SEARCH_INPUT" });
  const firstCard = getSearchCard();
  const firstInput = getSearchInput();
  assert.ok(firstCard);
  assert.ok(firstInput);

  firstInput.value = "along fo";
  (document.getElementById("launcher") as HTMLButtonElement).focus();

  const response = await harness.dispatch({ type: "SHOW_SEARCH_INPUT" });
  const secondCard = getSearchCard();
  const secondInput = getSearchInput();

  assert.equal(secondCard, firstCard);
  assert.equal(secondInput, firstInput);
  assert.equal(secondInput?.value, "along fo");
  assert.equal(document.activeElement, firstInput);
  assert.deepEqual(response, {
    ok: true,
    opened: true,
    focused: true,
  });
});

test("show search input reports failure when focus cannot be applied", async () => {
  const harness = createChromeHarness();
  globalThis.chrome = harness.chromeMock;
  const focusSpy = vi.spyOn(HTMLInputElement.prototype, "focus").mockImplementation(() => {});

  Object.defineProperty(document, "activeElement", {
    configurable: true,
    get: () => document.body,
  });

  startSynopsisContentScript();

  const response = await harness.dispatch({ type: "SHOW_SEARCH_INPUT" });

  assert.deepEqual(response, {
    ok: false,
    opened: true,
    focused: false,
  });

  focusSpy.mockRestore();
});

test("typing inside the search input does not leak to page shortcut listeners", async () => {
  const harness = createChromeHarness();
  globalThis.chrome = harness.chromeMock;

  startSynopsisContentScript();
  await harness.dispatch({ type: "SHOW_SEARCH_INPUT" });

  const input = getSearchInput();
  assert.ok(input);

  let captureTriggered = false;
  let bubbleTriggered = false;

  document.addEventListener(
    "keydown",
    () => {
      captureTriggered = true;
    },
    true,
  );
  document.addEventListener("keydown", () => {
    bubbleTriggered = true;
  });

  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "f",
      bubbles: true,
      cancelable: true,
    }),
  );

  assert.equal(captureTriggered, false);
  assert.equal(bubbleTriggered, false);
});

test("clicking the search pill refocuses the input", async () => {
  const harness = createChromeHarness();
  globalThis.chrome = harness.chromeMock;
  document.body.innerHTML = '<button id="launcher">Launch</button>';

  startSynopsisContentScript();
  await harness.dispatch({ type: "SHOW_SEARCH_INPUT" });

  const card = getSearchCard();
  const input = getSearchInput();
  assert.ok(card);
  assert.ok(input);

  (document.getElementById("launcher") as HTMLButtonElement).focus();
  card.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    }),
  );
  card.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }),
  );

  await new Promise((resolve) => window.setTimeout(resolve, 0));
  assert.equal(document.activeElement, input);
});
