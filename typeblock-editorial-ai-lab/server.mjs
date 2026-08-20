import "dotenv/config";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEditorialScan } from "./api/editorial-scan.mjs";
import { runEditorialProjection } from "./api/editorial-projection.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) {
      throw Object.assign(new Error("Request body too large."), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function safeFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const normalized = path.normalize(relative);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return null;
  const full = path.join(ROOT, normalized);
  return full.startsWith(ROOT) ? full : null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        provider: "openrouter",
        model: process.env.OPENROUTER_MODEL || "openai/gpt-5-mini",
        hasKey: Boolean(process.env.OPENROUTER_API_KEY),
        capabilities: {
          editorialScan: true,
          editorialProjection: true
        }
      });
    }

    if (url.pathname === "/api/editorial-scan") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
      const payload = await readJson(req);
      const count = Array.isArray(payload?.items) ? payload.items.length : 0;
      const startedAt = Date.now();
      console.log(`[editorial-scan] request start · ${count} Entries`);
      const result = await runEditorialScan(payload);
      console.log(`[editorial-scan] request done · ${Date.now() - startedAt} ms · ${count} Entries`);
      return sendJson(res, 200, result);
    }

    if (url.pathname === "/api/editorial-projection") {
      if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
      const payload = await readJson(req);
      const count = Array.isArray(payload?.items) ? payload.items.length : 0;
      const startedAt = Date.now();
      console.log(`[editorial-projection] request start · ${count} Entries`);
      const result = await runEditorialProjection(payload);
      console.log(`[editorial-projection] request done · ${Date.now() - startedAt} ms · ${count} Entries`);
      return sendJson(res, 200, result);
    }

    if (!["GET", "HEAD"].includes(req.method || "GET")) {
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    const filePath = safeFilePath(url.pathname);
    if (!filePath) return sendJson(res, 400, { error: "Invalid path" });

    let finalPath = filePath;
    try {
      const info = await stat(finalPath);
      if (info.isDirectory()) finalPath = path.join(finalPath, "index.html");
    } catch {
      return sendJson(res, 404, { error: "Not found" });
    }

    const body = await readFile(finalPath);
    res.writeHead(200, {
      "content-type": MIME[path.extname(finalPath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    if (req.method === "HEAD") return res.end();
    res.end(body);
  } catch (error) {
    const status = Number(error.statusCode || 500);
    console.error(`[server] ${req.method || "REQUEST"} ${req.url || "/"} · ${status} · ${error.message || error}`);
    sendJson(res, status, { error: error.message || "Unexpected server error" });
  }
});

server.listen(PORT, () => {
  console.log(`TypeBlock Editorial AI Lab: http://localhost:${PORT}`);
  console.log(`Editorial scan: http://localhost:${PORT}/api/editorial-scan`);
  console.log(`Editorial projection: http://localhost:${PORT}/api/editorial-projection`);
  console.log(`OpenRouter model: ${process.env.OPENROUTER_MODEL || "openai/gpt-5-mini"}`);
  console.log(`OpenRouter key loaded: ${process.env.OPENROUTER_API_KEY ? "yes" : "NO — add OPENROUTER_API_KEY to .env"}`);
});
