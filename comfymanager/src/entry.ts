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

function logListen(host: string, port: number) {
  const wan = host === "0.0.0.0" || host === "::";
  console.log(`ComfyManager  http://127.0.0.1:${port}`);
  if (wan) console.log(`外网访问      http://<服务器IP>:${port}  （防火墙 / 安全组放行 ${port}）`);
  else console.log(`监听          ${host}:${port}`);
}

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
      const mime =
        ext === "js" ? "text/javascript"
        : ext === "css" ? "text/css"
        : ext === "svg" ? "image/svg+xml"
        : ext === "png" ? "image/png"
        : ext === "ico" ? "image/x-icon"
        : "text/html";
      res.setHeader("Content-Type", mime);
      res.end(html);
    });
    server.listen(PORT, HOST, () => {
      logListen(HOST, PORT);
    });
    return;
  }

  const vite = await createVite({
    server: { middlewareMode: true, host: HOST, allowedHosts: true },
    appType: "spa",
  });
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/api")) return api(req, res);
    vite.middlewares(req, res);
  });
  server.listen(PORT, HOST, () => {
    logListen(HOST, PORT);
    console.log(`数据目录      ${settings.dataDir}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
