import http from "node:http";

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export function createCompanionHttpServer({ cacheDb, goodreadsService, host = "127.0.0.1", port = 4317 }) {
  let server;

  return {
    async start() {
      if (server) return;

      server = http.createServer(async (req, res) => {
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

        if (req.method === "POST" && req.url === "/cache/upsert") {
          try {
            const payload = await readJsonBody(req);
            const cacheKey = String(payload.cacheKey || "").trim();
            const lookupQuery = String(payload.lookupQuery || "").trim();
            const result = payload.result || {};
            const expiresAt = Number(payload.expiresAt) || 0;

            if (!cacheKey || !lookupQuery || !result?.title || !expiresAt) {
              sendJson(res, 400, {
                status: "error",
                message: "cacheKey, lookupQuery, result, and expiresAt are required.",
              });
              return;
            }

            cacheDb.upsertCacheEntry({
              cacheKey,
              lookupQuery,
              result,
              expiresAt,
            });

            sendJson(res, 200, { status: "ok" });
          } catch (error) {
            sendJson(res, 500, {
              status: "error",
              message: error?.message || "Could not upsert cache entry.",
            });
          }
          return;
        }

        if (req.method === "POST" && req.url === "/goodreads/extract-description") {
          try {
            const payload = await readJsonBody(req);
            const response = await goodreadsService.extractDescription(payload);
            sendJson(res, 200, response);
          } catch (error) {
            sendJson(res, 500, {
              status: "extraction_failed",
              descriptionText: "",
              resolvedUrl: "",
              screenshotsCaptured: 0,
              debug: {
                reason: error?.message || "Unexpected app Goodreads failure.",
              },
            });
          }
          return;
        }

        sendJson(res, 404, { status: "not_found" });
      });

      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    async stop() {
      if (!server) return;
      const current = server;
      server = undefined;
      await new Promise((resolve, reject) => {
        current.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
