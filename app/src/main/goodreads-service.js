import path from "node:path";

import { createGoodreadsRunner } from "./goodreads-runner.js";
import { extractVisibleDescriptionFromScreenshots } from "./openrouter-vision.js";

function toDataUrl(buffer) {
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

export function createGoodreadsVisualService({ runtimeDir }) {
  const runner = createGoodreadsRunner({
    runtimeDir: path.join(runtimeDir, "goodreads"),
  });

  return {
    async extractDescription(payload) {
      const title = String(payload.title || "").trim();
      if (!title) {
        return {
          status: "extraction_failed",
          descriptionText: "",
          resolvedUrl: "",
          screenshotsCaptured: 0,
          debug: {
            reason: "Missing title.",
          },
        };
      }

      const capture = await runner.captureDescriptionScreenshots(payload);
      if (capture.status !== "ready") {
        return {
          status: capture.status,
          descriptionText: "",
          resolvedUrl: capture.resolvedUrl || "",
          screenshotsCaptured: capture.screenshotsCaptured || 0,
          debug: capture.debug || {},
        };
      }

      const extraction = await extractVisibleDescriptionFromScreenshots({
        title: payload.title,
        author: payload.author,
        year: payload.year,
        screenshots: capture.screenshots,
        openrouterApiKey: payload.openrouterApiKey,
        openrouterModel: payload.openrouterModel,
      });

      if (extraction.status !== "ok") {
        return {
          status: "extraction_failed",
          descriptionText: "",
          resolvedUrl: capture.resolvedUrl || "",
          screenshotsCaptured: capture.screenshotsCaptured || 0,
          debug: {
            ...(capture.debug || {}),
            ...(extraction.debug || {}),
            previewScreenshot: payload.includeDebugAssets ? toDataUrl(capture.screenshots[0]) : undefined,
          },
        };
      }

      return {
        status: "ok",
        descriptionText: extraction.descriptionText,
        resolvedUrl: capture.resolvedUrl || "",
        screenshotsCaptured: capture.screenshotsCaptured || 0,
        debug: {
          ...(capture.debug || {}),
          ...(extraction.debug || {}),
          previewScreenshot: payload.includeDebugAssets ? toDataUrl(capture.screenshots[0]) : undefined,
        },
      };
    },
    stop() {
      return runner.stop();
    },
  };
}
