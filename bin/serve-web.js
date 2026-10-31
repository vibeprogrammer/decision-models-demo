#!/usr/bin/env node
// Local web demo, zero dependencies: http://localhost:4280
// Serves web/ and the same API as the Azure Functions (/api/run, /api/decide, /api/health).
// Reads the same AZURE_* variables (.env or shell). No key = the page shows the recorded run.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";
import { loadEnv } from "../src/env.js";

loadEnv();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { makeApi } = await import("../api/core.mjs");
const api = makeApi(process.env);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const port = Number(process.env.PORT || 4280);

http.createServer(async (req, res) => {
  const send = (r) => { res.writeHead(r.status, r.headers); res.end(r.body); };
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/health") return send(api.health());
    if ((url.pathname === "/api/decide" || url.pathname === "/api/run") && req.method === "POST") {
      let raw = "";
      for await (const c of req) { raw += c; if (raw.length > 4096) break; }
      const fn = url.pathname === "/api/run" ? api.run : api.decide;
      return send(await fn({ rawBody: raw, headers: { "x-forwarded-for": req.socket.remoteAddress } }));
    }
    const p = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
    const file = join(root, "web", p);
    if (!file.startsWith(join(root, "web"))) throw new Error("bad path");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found");
  }
}).listen(port, () => {
  const live = api.health();
  console.log(`Web demo: http://localhost:${port}   (${JSON.parse(live.body).live ? "both models configured" : "no key: the page shows the recorded run"})`);
});
