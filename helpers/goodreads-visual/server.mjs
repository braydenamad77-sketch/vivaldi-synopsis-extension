import http from "node:http";

import { captureGoodreadsDescriptionScreenshots } from "./src/goodreads-runner.mjs";
import { extractVisibleDescriptionFromScreenshots } from "./src/openrouter-vision.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 4317;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

function toDataUrl(buffer) {
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.method !== "POST" || req.url !== "/goodreads/extract-description") {
    sendJson(res, 404, {
      status: "not_found",
    });
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const title = String(payload.title || "").trim();
    if (!title) {
      sendJson(res, 400, {
        status: "extraction_failed",
        debug: {
          reason: "Missing title.",
        },
      });
      return;
    }

    const capture = await captureGoodreadsDescriptionScreenshots(payload);
    if (capture.status !== "ready") {
      sendJson(res, 200, {
        status: capture.status,
        descriptionText: "",
        resolvedUrl: capture.resolvedUrl || "",
        screenshotsCaptured: capture.screenshotsCaptured || 0,
        debug: capture.debug || {},
      });
      return;
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
      sendJson(res, 200, {
        status: "extraction_failed",
        descriptionText: "",
        resolvedUrl: capture.resolvedUrl || "",
        screenshotsCaptured: capture.screenshotsCaptured || 0,
        debug: {
          ...(capture.debug || {}),
          ...(extraction.debug || {}),
          previewScreenshot: payload.includeDebugAssets ? toDataUrl(capture.screenshots[0]) : undefined,
        },
      });
      return;
    }

    sendJson(res, 200, {
      status: "ok",
      descriptionText: extraction.descriptionText,
      resolvedUrl: capture.resolvedUrl || "",
      screenshotsCaptured: capture.screenshotsCaptured || 0,
      debug: {
        ...(capture.debug || {}),
        ...(extraction.debug || {}),
        previewScreenshot: payload.includeDebugAssets ? toDataUrl(capture.screenshots[0]) : undefined,
      },
    });
  } catch (error) {
    sendJson(res, 500, {
      status: "extraction_failed",
      debug: {
        reason: error?.message || "Unexpected helper failure.",
      },
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[goodreads-visual-helper] listening on http://${HOST}:${PORT}`);
});
