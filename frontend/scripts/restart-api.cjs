"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const http = require("node:http");

const KILL_ONLY = process.argv.includes("--kill-only");
const PORT = Number(process.env.VISUALFORGE_PORT || process.argv.find((arg) => /^\d+$/.test(arg)) || 18787);
const SELF = process.pid;

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function localPort(addr) {
  const m = String(addr || "").match(/:(\d+)\s*$/);
  return m ? Number(m[1]) : NaN;
}

function pidsListening(port) {
  const pids = new Set();
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        if (localPort(parts[1]) !== port) continue;
        const pid = Number(parts[parts.length - 1]);
        if (pid) pids.add(pid);
      }
    } else {
      try {
        const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
        for (const raw of out.split(/\s+/)) {
          const pid = Number(raw);
          if (pid) pids.add(pid);
        }
      } catch {
        /* lsof 不在 PATH 时忽略 */
      }
    }
  } catch {
    /* netstat 失败时靠下面的进程扫描 */
  }
  pids.delete(SELF);
  pids.delete(0);
  return [...pids];
}

function isApiCommand(cmd) {
  if (!cmd) return false;
  const s = String(cmd).replace(/\\/g, "/").toLowerCase();
  if (s.includes("restart-api.cjs")) return false;
  if (s.includes("/vite") || s.endsWith(" vite") || s.includes("vite.js")) return false;
  return s.includes("server/src/index.ts") || s.includes("server/dist/index.js");
}

function nodePidsForApi() {
  const pids = new Set();
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { Write-Output (($_.ProcessId.ToString()) + \"`t\" + $_.CommandLine) }",
        ],
        { encoding: "utf8", windowsHide: true, timeout: 15000 },
      );
      for (const line of out.split(/\r?\n/)) {
        const tab = line.indexOf("\t");
        if (tab <= 0) continue;
        const pid = Number(line.slice(0, tab));
        if (pid && isApiCommand(line.slice(tab + 1))) pids.add(pid);
      }
    } else {
      const out = execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
      for (const line of out.split(/\n/)) {
        const m = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!m) continue;
        const pid = Number(m[1]);
        if (pid && isApiCommand(m[2])) pids.add(pid);
      }
    }
  } catch {
    /* 扫描失败则只杀监听端口的进程 */
  }
  pids.delete(SELF);
  return [...pids];
}

function killPid(pid) {
  if (!pid || pid === SELF) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    /* 进程可能已经退出 */
  }
}

function resolveTsx() {
  return [join(FRONTEND, "node_modules/tsx/dist/cli.mjs"), join(FRONTEND, "../node_modules/tsx/dist/cli.mjs")].find(existsSync);
}

function startApi() {
  const src = join(FRONTEND, "server/src/index.ts");
  const dist = join(FRONTEND, "server/dist/index.js");
  const tsx = resolveTsx();
  const args = tsx && existsSync(src) ? [tsx, "watch", "server/src/index.ts"] : existsSync(dist) ? [dist] : null;
  if (!args) throw new Error("找不到生成服务入口（server/src/index.ts 或 server/dist/index.js）");
  const child = spawn(process.execPath, args, {
    cwd: FRONTEND,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  return child.pid;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpJson(path) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path, timeout: 1500 }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 8000) req.destroy();
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(res.statusCode && res.statusCode < 500 ? { ok: true } : null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function ping() {
  const pingBody = await httpJson("/api/ping");
  if (pingBody && pingBody.ok) return pingBody;
  const settings = await httpJson("/api/settings");
  if (settings && settings.ok) return { ok: true, engine: "unknown" };
  return null;
}

async function main() {
  const targets = [...new Set([...pidsListening(PORT), ...nodePidsForApi()])];
  for (const pid of targets) killPid(pid);
  for (let i = 0; i < 25; i += 1) {
    const still = pidsListening(PORT);
    if (!still.length) break;
    for (const pid of still) killPid(pid);
    await sleep(200);
  }
  if (KILL_ONLY) {
    emit({ ok: true, action: "killed", port: PORT });
    return;
  }
  if (await ping()) {
    emit({ ok: true, action: "already-up", port: PORT });
    return;
  }
  const pid = startApi();
  for (let i = 0; i < 40; i += 1) {
    await sleep(250);
    const body = await ping();
    if (body && body.ok) {
      emit({ ok: true, action: "started", engine: body.engine, pid: body.pid || pid, port: PORT });
      return;
    }
  }
  emit({ ok: false, error: `已尝试启动，但 ${PORT} 在 10 秒内没有就绪` });
  process.exitCode = 1;
}

main().catch((err) => {
  emit({ ok: false, error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
