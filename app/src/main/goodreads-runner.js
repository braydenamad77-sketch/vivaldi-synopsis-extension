import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const MAX_SCREENSHOTS = 3;
const MAX_SHOT_HEIGHT = 1400;
const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function dedupe(values = [], limit = 8) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function sanitizeIsbn(value) {
  const cleaned = String(value || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (cleaned.length === 10 || cleaned.length === 13) return cleaned;
  return "";
}

function buildUrlCandidates(input = {}) {
  const urls = [];
  const goodreadsIds = dedupe(input.goodreadsIds || [], 6);
  const isbn10 = dedupe((input.isbn10 || []).map(sanitizeIsbn).filter(Boolean), 6);
  const isbn13 = dedupe((input.isbn13 || []).map(sanitizeIsbn).filter(Boolean), 6);
  const title = String(input.title || "").trim();

  for (const id of goodreadsIds) urls.push(`https://www.goodreads.com/book/show/${encodeURIComponent(id)}`);
  for (const isbn of [...isbn13, ...isbn10]) urls.push(`https://www.goodreads.com/book/isbn/${encodeURIComponent(isbn)}`);
  if (title) urls.push(`https://www.goodreads.com/book/title?id=${encodeURIComponent(title)}`);

  return dedupe(urls, 12);
}

async function findFirstVisibleLocator(page, selectors = []) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }

  return null;
}

async function maybeExpandDescription(page, container, debug) {
  const goodreadsSpecific = [
    container.locator("button[aria-label*='show more' i]").first(),
    container.locator("button:has-text('Show more')").first(),
    page.locator(".BookPageMetadataSection__description button[aria-label*='show more' i]").first(),
    page.locator(".BookPageMetadataSection__description button:has-text('Show more')").first(),
  ];

  for (const candidate of goodreadsSpecific) {
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) continue;

    const label =
      (await candidate.getAttribute("aria-label").catch(() => "")) ||
      (await candidate.innerText().catch(() => "")) ||
      "show more";

    try {
      await candidate.click({ timeout: 3000, force: true });
      await page.waitForFunction(
        () => !document.querySelector(".BookPageMetadataSection__description button[aria-label*='show more' i]"),
        { timeout: 4000 },
      ).catch(() => {});
      await page.waitForTimeout(900);
      debug.expandAction = `clicked:${label.trim() || "expand"}`;
      return "clicked";
    } catch (error) {
      debug.expandAction = `failed:${error?.message || "click_failed"}`;
      return "failed";
    }
  }

  debug.expandAction = "not_needed";
  return "not_needed";
}

async function captureLocatorScreenshots(page, locator) {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return [];

  const viewport = page.viewportSize() || { width: 1440, height: 1800 };
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => viewport.height);
  const clipX = Math.max(0, Math.floor(box.x - 16));
  const availableWidth = Math.max(1, viewport.width - clipX);
  const clipWidth = Math.min(Math.max(320, Math.ceil(box.width + 32)), availableWidth);
  const totalHeight = Math.max(120, Math.ceil(box.height + 32));
  const screenshots = [];

  for (let offset = 0; offset < totalHeight && screenshots.length < MAX_SCREENSHOTS; offset += MAX_SHOT_HEIGHT) {
    const clipY = Math.max(0, Math.floor(box.y - 16 + offset));
    const clipHeight = Math.min(MAX_SHOT_HEIGHT, totalHeight - offset, pageHeight - clipY);
    if (clipHeight <= 0) break;

    screenshots.push(
      await page.screenshot({
        clip: {
          x: clipX,
          y: clipY,
          width: clipWidth,
          height: clipHeight,
        },
        animations: "disabled",
        type: "jpeg",
        quality: 55,
      }),
    );
  }

  return screenshots;
}

export function createGoodreadsRunner({ runtimeDir, browserIdleMs = 1000 * 60 * 3 }) {
  const profileDir = path.join(runtimeDir, "goodreads-browser-profile");
  let contextPromise;
  let idleTimer;

  function scheduleIdleShutdown() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stop().catch(() => {});
    }, browserIdleMs);
  }

  async function ensureContext() {
    if (!contextPromise) {
      contextPromise = (async () => {
        await fs.mkdir(profileDir, { recursive: true });
        const baseOptions = {
          headless: true,
          viewport: { width: 1440, height: 1800 },
          locale: "en-US",
          timezoneId: "America/Detroit",
          userAgent: DESKTOP_CHROME_UA,
          args: ["--disable-blink-features=AutomationControlled"],
        };

        try {
          return await chromium.launchPersistentContext(profileDir, {
            ...baseOptions,
            channel: "chrome",
          });
        } catch (_error) {
          return chromium.launchPersistentContext(profileDir, baseOptions);
        }
      })();
    }

    const context = await contextPromise;
    scheduleIdleShutdown();
    return context;
  }

  async function stop() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    if (!contextPromise) return;
    const context = await contextPromise.catch(() => null);
    contextPromise = undefined;
    await context?.close().catch(() => {});
  }

  async function captureDescriptionScreenshots(input = {}) {
    const context = await ensureContext();
    const page = await context.newPage();
    const debug = {
      attemptedUrls: [],
      expandAction: "not_attempted",
    };

    try {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
      });

      const urls = buildUrlCandidates(input);
      if (!urls.length) {
        return {
          status: "page_not_found",
          screenshots: [],
          screenshotsCaptured: 0,
          debug: {
            ...debug,
            reason: "No Goodreads lookup URLs could be built.",
          },
        };
      }

      for (const url of urls) {
        const attempt = { url, finalUrl: "", status: 0 };
        try {
          const response = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          });
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(900);

          attempt.status = response?.status() || 0;
          attempt.finalUrl = page.url();

          if (attempt.status >= 400) {
            attempt.reason = "http_error";
            debug.attemptedUrls.push(attempt);
            continue;
          }

          const container = await findFirstVisibleLocator(page, [
            ".BookPageMetadataSection__description .TruncatedContent__text",
            ".BookPageMetadataSection__description",
            "[data-testid='description']",
            ".TruncatedContent__text",
          ]);

          if (!container) {
            attempt.reason = "description_container_missing";
            debug.attemptedUrls.push(attempt);
            continue;
          }

          await container.scrollIntoViewIfNeeded().catch(() => {});
          const expandStatus = await maybeExpandDescription(page, container, debug);
          const screenshots = await captureLocatorScreenshots(page, container);

          attempt.reason = screenshots.length ? "captured" : "capture_failed";
          attempt.finalUrl = page.url();
          debug.attemptedUrls.push(attempt);

          if (screenshots.length) {
            return {
              status: "ready",
              screenshots,
              resolvedUrl: page.url(),
              screenshotsCaptured: screenshots.length,
              debug: {
                ...debug,
                expandStatus,
              },
            };
          }

          if (expandStatus === "failed") {
            return {
              status: "expand_failed",
              screenshots: [],
              resolvedUrl: page.url(),
              screenshotsCaptured: 0,
              debug: {
                ...debug,
                reason: "Description expand control failed before capture.",
              },
            };
          }
        } catch (error) {
          attempt.reason = error?.message || "navigation_failed";
          attempt.finalUrl = page.url();
          debug.attemptedUrls.push(attempt);
        }
      }

      return {
        status: "page_not_found",
        screenshots: [],
        screenshotsCaptured: 0,
        debug: {
          ...debug,
          reason: "Could not capture a Goodreads description block.",
        },
      };
    } finally {
      await page.close().catch(() => {});
      scheduleIdleShutdown();
    }
  }

  return {
    captureDescriptionScreenshots,
    stop,
  };
}
