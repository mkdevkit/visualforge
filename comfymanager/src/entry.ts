import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { createServer as createVite } from "vite";
import { app } from "./api/app.ts";
import { loadSettings } from "./api/config.ts";

const settings = loadSettings();
const PORT = settings.port;
const HOST = settings.host;

async function main() {
  const api = getRequestListener(app.fetch);
  const isProd = process.env.NODE_ENV === "production";
  const dist = join(process.cwd(), "dist");

  if (isProd && existsSync(join(dist, "index.html"))) {
    const server = http.createServer((req, res) => {
      if (req.url?.startsWith("/api")) return api(req, res);
      const file = req.url && req.url !== "/" && existsSync(join(dist, req.url))
        ? join(dist, req.url)
        : join(dist, "index.html");
      const html = readFileSync(file);
      const ext = file.split(".").pop();
      const mime = ext === "js" ? "text/javascript" : ext === "css" ? "text/css" : "text/html";
      res.setHeader("Content-Type", mime);
      res.end(html);
    });
    server.listen(PORT, HOST, () => {
      console.log(`ComfyManager  http://${HOST}:${PORT}`);
    });
    return;
  }

  const vite = await createVite({
    server: { middlewareMode: true },
    appType: "spa",
  });
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/api")) return api(req, res);
    vite.middlewares(req, res);
  });
  server.listen(PORT, HOST, () => {
    console.log(`ComfyManager  http://${HOST}:${PORT}`);
    console.log(`数据目录      ${settings.dataDir}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
