import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { join, relative } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { app, prepare, startTaskPump } from "./app.js";
import { webDistDir } from "./config.js";
import { handleMcpHttp, isMcpPath } from "./mcp-http.js";

const settings = prepare();
const dist = webDistDir();

if (existsSync(dist)) {
  const root = relative(process.cwd(), dist) || dist;
  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/") || c.req.path === "/mcp") return next();
    return serveStatic({ root })(c, next);
  });
  app.notFound((c) => {
    if (c.req.path.startsWith("/api/") || c.req.path === "/mcp") {
      return c.json({ ok: false, error: "Not Found" }, 404);
    }
    const index = join(dist, "index.html");
    if (existsSync(index)) return c.html(readFileSync(index, "utf8"));
    return c.text("Not Found", 404);
  });
}

startTaskPump();

const listener = getRequestListener(app.fetch);
const server = http.createServer((req, res) => {
  if (isMcpPath(req.url)) {
    void handleMcpHttp(req, res);
    return;
  }
  listener(req, res);
});
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
server.listen(settings.port, settings.host, () => {
  console.log(`VisualForge API  http://${settings.host}:${settings.port}`);
  console.log(`MCP              http://${settings.host}:${settings.port}/mcp`);
  console.log(`资源目录          ${settings.dataDir}`);
  if (existsSync(dist)) console.log(`Web 静态资源      ${dist}`);
  else console.log("Web 未构建，开发请同时运行 Vite (端口 5173)");
});
