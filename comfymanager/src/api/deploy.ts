import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { formatOsPath, loadSettings, PACKAGE_ROOT, saveSettings } from "./config.ts";
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
  const detected = detectComfyPython(loadSettings().comfy.installDir);
  if (detected) return detected;
  return process.platform === "win32" ? "python" : "python3";
}

export function isComfyRoot(dir: string) {
  if (!dir || !existsSync(dir)) return false;
  return existsSync(join(dir, "main.py")) && (
    existsSync(join(dir, "folder_paths.py")) || existsSync(join(dir, "comfy", "__init__.py"))
  );
}

function comfyRootAt(dir: string) {
  if (isComfyRoot(dir)) return resolve(dir);
  const nested = join(dir, "ComfyUI");
  if (isComfyRoot(nested)) return resolve(nested);
  return "";
}

export function detectComfyPython(installDir: string) {
  if (!installDir) return "";
  const win = process.platform === "win32";
  const parent = dirname(installDir);
  const candidates = win
    ? [
        join(installDir, "python_embeded", "python.exe"),
        join(installDir, "python_embedded", "python.exe"),
        join(parent, "python_embeded", "python.exe"),
        join(parent, "python_embedded", "python.exe"),
        join(installDir, ".venv", "Scripts", "python.exe"),
        join(installDir, "venv", "Scripts", "python.exe"),
      ]
    : [
        join(installDir, ".venv", "bin", "python"),
        join(installDir, "venv", "bin", "python"),
        join(parent, "python_embeded", "bin", "python"),
      ];
  return candidates.find((p) => existsSync(p)) || "";
}

function listDirs(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name));
  } catch {
    return [];
  }
}

function looksLikeComfyName(name: string) {
  return /comfyui/i.test(name) || /^comfy$/i.test(name);
}

export function listExistingComfyInstalls() {
  const s = loadSettings();
  const home = homedir();
  const seeds: string[] = [
    s.comfy.installDir,
    process.env.COMFYUI_INSTALL_DIR || "",
    join(PACKAGE_ROOT, "comfy"),
    join(home, "ComfyUI"),
    join(home, "comfyui"),
    join(home, "Documents", "ComfyUI"),
    join(home, "Desktop", "ComfyUI"),
    join(home, "Downloads", "ComfyUI"),
  ];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || "";
    const roaming = process.env.APPDATA || "";
    seeds.push(
        "C:\\ComfyUI",
        "D:\\ComfyUI",
        "E:\\ComfyUI",
        "C:\\ComfyUI_windows_portable",
        "D:\\ComfyUI_windows_portable",
        "E:\\ComfyUI_windows_portable",
      local ? join(local, "Programs", "ComfyUI") : "",
      roaming ? join(roaming, "StabilityMatrix", "Packages", "ComfyUI") : "",
    );
  }
  for (const parent of [home, join(home, "Desktop"), join(home, "Documents"), join(home, "Downloads")]) {
    for (const child of listDirs(parent)) {
      if (looksLikeComfyName(child.split(/[/\\]/).pop() || "")) seeds.push(child);
    }
  }
  const found: string[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    if (!seed) continue;
    const root = comfyRootAt(seed);
    if (!root) continue;
    const key = root.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(root);
  }
  return found;
}

function isBundledInstall(dir: string) {
  const root = resolve(PACKAGE_ROOT);
  const abs = resolve(dir);
  return abs === join(root, "comfy") || abs.startsWith(root + sep);
}

function upsertYamlSection(text: string, name: string, section: string) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${name}:` || line.startsWith(`${name}:`));
  if (start < 0) {
    const trimmed = normalized.replace(/\s+$/, "");
    return `${trimmed}${trimmed ? "\n\n" : ""}${section.replace(/\s+$/, "")}\n`;
  }
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() && !/^[ \t]/.test(line)) break;
    end += 1;
  }
  return `${[...lines.slice(0, start), section.replace(/\s+$/, ""), ...lines.slice(end)].join("\n").replace(/\s+$/, "")}\n`;
}

export function writeExtraModelPaths() {
  const { comfy } = loadSettings();
  if (!existsSync(comfy.installDir)) mkdirSync(comfy.installDir, { recursive: true });
  mkdirSync(comfy.modelsDir, { recursive: true });
  const body = [
    "# ComfyManager extra model paths",
    "comfymanager:",
    ...MODEL_FOLDERS.map((folder) => {
      const abs = join(comfy.modelsDir, folder).replace(/\\/g, "/");
      return `    ${folder}: ${abs}`;
    }),
  ].join("\n");
  const dest = join(comfy.installDir, "extra_model_paths.yaml");
  const prev = existsSync(dest) ? readFileSync(dest, "utf8") : "";
  writeFileSync(dest, prev.trim() ? upsertYamlSection(prev, "comfymanager", body) : `${body}\n`, "utf8");
  return dest;
}

export function comfyInstalled() {
  return isComfyRoot(loadSettings().comfy.installDir);
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function displayMaybePath(p: string) {
  if (!p) return "";
  if (p.includes("/") || p.includes("\\") || existsSync(p)) return formatOsPath(p);
  return p;
}

export async function comfyStatus() {
  const s = loadSettings().comfy;
  const proc = loadJson<ComfyProc>(procFile(), {});
  const alive = proc.pid ? isPidAlive(proc.pid) : false;
  const ping = await pingComfy(s.baseUrl);
  const existingInstalls = listExistingComfyInstalls().map(formatOsPath);
  const installed = comfyInstalled();
  return {
    installed,
    reusedExisting: installed && !isBundledInstall(s.installDir),
    existingInstalls,
    installDir: formatOsPath(s.installDir),
    modelsDir: formatOsPath(s.modelsDir),
    python: displayMaybePath(pythonBin()),
    pid: alive ? proc.pid : undefined,
    processRunning: alive,
    api: ping,
    baseUrl: s.baseUrl,
    listenHost: s.listenHost,
    listenPort: s.listenPort,
    logFile: formatOsPath(logFile()),
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
  const current = loadSettings();
  const existing = listExistingComfyInstalls();
  const configured = current.comfy.installDir;
  const found = isComfyRoot(configured) ? resolve(configured) : existing[0] || "";
  if (found) {
    const pythonPath = current.comfy.pythonPath.trim() || detectComfyPython(found);
    saveSettings({
      comfy: {
        ...current.comfy,
        installDir: found,
        pythonPath,
      },
    });
    writeExtraModelPaths();
    appendLog(`使用已安装 ComfyUI：${formatOsPath(found)}\n模型目录：${formatOsPath(loadSettings().comfy.modelsDir)}`);
    if (isBundledInstall(found)) {
      const pip = await run(pythonBin(), ["-m", "pip", "install", "-r", "requirements.txt"], found);
      appendLog(pip.log);
      if (pip.code !== 0) throw new Error(`安装 Python 依赖失败。请确认已安装 Python 3.10+。\n${pip.log.slice(-800)}`);
    }
    return {
      ok: true,
      reused: true,
      bundled: isBundledInstall(found),
      installDir: formatOsPath(found),
      modelsDir: formatOsPath(loadSettings().comfy.modelsDir),
      pythonPath: displayMaybePath(pythonBin()) || pythonBin(),
    };
  }
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
  return {
    ok: true,
    reused: false,
    bundled: true,
    installDir: formatOsPath(installDir),
    modelsDir: formatOsPath(loadSettings().comfy.modelsDir),
  };
}

export function startComfy() {
  if (!comfyInstalled()) {
    const found = listExistingComfyInstalls()[0];
    if (!found) throw new Error("尚未安装 ComfyUI");
    const current = loadSettings();
    saveSettings({
      comfy: {
        ...current.comfy,
        installDir: found,
        pythonPath: current.comfy.pythonPath.trim() || detectComfyPython(found),
      },
    });
    writeExtraModelPaths();
  }
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
