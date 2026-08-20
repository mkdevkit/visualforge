import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = dirname(fileURLToPath(import.meta.url));
let ownedApi: ChildProcess | null = null;

function runRestartScript(args: string[] = []) {
  return new Promise<{ ok?: boolean; error?: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [join(frontendRoot, "scripts/restart-api.cjs"), ...args], {
      cwd: frontendRoot,
      windowsHide: true,
      env: process.env,
    });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      out += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("重启超时"));
    }, 25000);
    child.on("close", () => {
      clearTimeout(timer);
      const line = out.trim().split(/\n/).filter(Boolean).pop() || "";
      try {
        resolve(JSON.parse(line) as { ok?: boolean; error?: string });
      } catch {
        reject(new Error(out.trim() || "重启脚本没有返回结果"));
      }
    });
  });
}

function startOwnedApi() {
  ownedApi?.kill();
  const tsx = [join(frontendRoot, "node_modules/tsx/dist/cli.mjs"), join(frontendRoot, "../node_modules/tsx/dist/cli.mjs")].find(existsSync);
  const dist = join(frontendRoot, "server/dist/index.js");
  const src = join(frontendRoot, "server/src/index.ts");
  const args = tsx && existsSync(src) ? [tsx, "watch", "server/src/index.ts"] : existsSync(dist) ? [dist] : null;
  if (!args) throw new Error("找不到生成服务入口");
  ownedApi = spawn(process.execPath, args, { cwd: frontendRoot, env: process.env, stdio: "inherit" });
  ownedApi.on("exit", () => {
    ownedApi = null;
  });
}

async function pingApi() {
  try {
    const res = await fetch("http://127.0.0.1:18787/api/ping", { signal: AbortSignal.timeout(1500) });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function ensureApiRunning() {
  if (await pingApi()) return;
  startOwnedApi();
}

function proxyApiDown() {
  return {
    target: "http://127.0.0.1:18787",
    timeout: 600000,
    proxyTimeout: 600000,
    configure(proxy: { on: (ev: string, cb: (...args: unknown[]) => void) => void }) {
      proxy.on("error", (_err, _req, res) => {
        const socket = res as ServerResponse;
        if (!socket.headersSent) {
          socket.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        }
        socket.end(
          JSON.stringify({
            ok: false,
            error: "视铸生成服务 18787 未启动。请到设置页点「重启生成服务」。",
          }),
        );
      });
    },
  };
}

function visualforgeApiPlugin(): Plugin {
  return {
    name: "visualforge-api-control",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] || "";
        if (url !== "/__visualforge/restart-api") return next();
        if (req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true, hint: "POST 重启 18787 生成服务" }));
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        void (async () => {
          try {
            const killed = await runRestartScript(["--kill-only"]);
            if (killed.ok === false) throw new Error(killed.error || "结束旧进程失败");
            startOwnedApi();
            for (let i = 0; i < 40; i += 1) {
              await new Promise((r) => setTimeout(r, 250));
              try {
                const ping = await fetch("http://127.0.0.1:18787/api/ping", { signal: AbortSignal.timeout(1500) });
                if (ping.ok) {
                  const body = (await ping.json()) as { engine?: string; pid?: number };
                  res.statusCode = 200;
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify({ ok: true, action: "started", engine: body.engine, pid: body.pid }));
                  return;
                }
              } catch {
                /* 正在拉起 */
              }
            }
            throw new Error("已结束旧进程并拉起，但 10 秒内没有就绪");
          } catch (err) {
            if (res.writableEnded) return;
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
          }
        })();
      });
      return () => {
        void ensureApiRunning();
        server.httpServer?.once("close", () => ownedApi?.kill());
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), visualforgeApiPlugin()],
  server: {
    port: 5173,
    proxy: {
      "/api": proxyApiDown(),
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": proxyApiDown(),
    },
  },
});
