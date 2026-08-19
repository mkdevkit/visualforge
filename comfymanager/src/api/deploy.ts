import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadSettings, saveSettings } from "./config.ts";
import { pingComfy } from "./ping.ts";
import { MODEL_FOLDERS } from "./types.ts";
import { loadJson, saveJson } from "./json.ts";

interface ComfyProc {
  pid?: number;
  startedAt?: string;
}

function procFile() {
  return join(loadSettings().dataDir, "comfy-process.json");
}

function logFile() {
  return join(loadSettings().dataDir, "comfyui.log");
}

function pythonBin() {
  const custom = loadSettings().comfy.pythonPath.trim();
  if (custom) return custom;
  return process.platform === "win32" ? "python" : "python3";
}

export function writeExtraModelPaths() {
  const { comfy } = loadSettings();
  mkdirSync(comfy.installDir, { recursive: true });
  mkdirSync(comfy.modelsDir, { recursive: true });
  const lines = ["# ComfyManager extra model paths", "comfymanager:"];
  for (const folder of MODEL_FOLDERS) {
    const abs = join(comfy.modelsDir, folder).replace(/\\/g, "/");
    lines.push(`    ${folder}: ${abs}`);
  }
  const dest = join(comfy.installDir, "extra_model_paths.yaml");
  writeFileSync(dest, `${lines.join("\n")}\n`, "utf8");
  return dest;
}

export function comfyInstalled() {
  return existsSync(join(loadSettings().comfy.installDir, "main.py"));
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function comfyStatus() {
  const s = loadSettings().comfy;
  const proc = loadJson<ComfyProc>(procFile(), {});
  const alive = proc.pid ? isPidAlive(proc.pid) : false;
  const ping = await pingComfy(s.baseUrl);
  return {
    installed: comfyInstalled(),
    installDir: s.installDir,
    modelsDir: s.modelsDir,
    python: pythonBin(),
    pid: alive ? proc.pid : undefined,
    processRunning: alive,
    api: ping,
    baseUrl: s.baseUrl,
    listenHost: s.listenHost,
    listenPort: s.listenPort,
    logFile: logFile(),
  };
}

function run(cmd: string, args: string[], cwd: string) {
  return new Promise<{ code: number; log: string }>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: true, windowsHide: true });
    let log = `$ ${cmd} ${args.join(" ")}\n`;
    child.stdout?.on("data", (d) => {
      log += d.toString();
    });
    child.stderr?.on("data", (d) => {
      log += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, log }));
  });
}

function appendLog(text: string) {
  const prev = existsSync(logFile()) ? readFileSync(logFile(), "utf8") : "";
  writeFileSync(logFile(), `${prev}${text}\n`, "utf8");
}

export async function installComfy() {
  const { installDir } = loadSettings().comfy;
  mkdirSync(installDir, { recursive: true });
  if (!comfyInstalled()) {
    const parent = join(installDir, "..");
    const name = installDir.split(/[/\\]/).pop() || "ComfyUI";
    const cloned = await run("git", ["clone", "--depth", "1", "https://github.com/comfyanonymous/ComfyUI.git", name], parent);
    appendLog(cloned.log);
    if (cloned.code !== 0) throw new Error(`克隆 ComfyUI 失败。请确认已安装 Git。\n${cloned.log.slice(-800)}`);
  }
  const pip = await run(pythonBin(), ["-m", "pip", "install", "-r", "requirements.txt"], installDir);
  appendLog(pip.log);
  if (pip.code !== 0) throw new Error(`安装 Python 依赖失败。请确认已安装 Python 3.10+。\n${pip.log.slice(-800)}`);
  writeExtraModelPaths();
  return { ok: true, installDir };
}

export function startComfy() {
  if (!comfyInstalled()) throw new Error("尚未安装 ComfyUI");
  const s = loadSettings().comfy;
  writeExtraModelPaths();
  const args = ["main.py", "--listen", s.listenHost, "--port", String(s.listenPort), "--enable-cors-header"];
  if (s.extraArgs.trim()) args.push(...s.extraArgs.trim().split(/\s+/));
  const out = createWriteStream(logFile(), { flags: "a" });
  const child: ChildProcess = spawn(pythonBin(), args, {
    cwd: s.installDir,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    shell: process.platform === "win32",
  });
  child.unref();
  if (!child.pid) throw new Error("无法启动 ComfyUI 进程");
  saveJson(procFile(), { pid: child.pid, startedAt: new Date().toISOString() } satisfies ComfyProc);
  const baseUrl = `http://${s.listenHost === "0.0.0.0" ? "127.0.0.1" : s.listenHost}:${s.listenPort}`;
  saveSettings({ comfy: { ...s, baseUrl } });
  return { ok: true, pid: child.pid, baseUrl };
}

export function stopComfy() {
  const proc = loadJson<ComfyProc>(procFile(), {});
  if (proc.pid && isPidAlive(proc.pid)) {
    try {
      process.kill(proc.pid);
    } catch {
      if (process.platform === "win32") spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { shell: true });
    }
  }
  saveJson(procFile(), {});
  return { ok: true };
}
