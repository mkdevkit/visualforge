import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
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

function installLogFile() {
  return join(loadSettings().dataDir, "install.log");
}

let installRunning = false;

export function isInstallRunning() {
  return installRunning;
}

export function readInstallLog(maxChars = 80_000) {
  const path = installLogFile();
  if (!existsSync(path)) {
    return { text: "", path: formatOsPath(path), installing: installRunning, truncated: false };
  }
  const raw = readFileSync(path, "utf8");
  const truncated = raw.length > maxChars;
  return {
    text: truncated ? raw.slice(-maxChars) : raw,
    path: formatOsPath(path),
    installing: installRunning,
    truncated,
  };
}

function pythonBin() {
  const custom = loadSettings().comfy.pythonPath.trim();
  if (custom) return custom;
  const detected = detectComfyPython(loadSettings().comfy.installDir);
  if (detected) return detected;
  return resolveSystemPython()?.executable || (process.platform === "win32" ? "python" : "python3");
}

export function hostOs() {
  if (process.platform === "win32") return { id: "windows" as const, label: "Windows" };
  if (process.platform === "darwin") return { id: "macos" as const, label: "macOS" };
  try {
    const text = readFileSync("/etc/os-release", "utf8");
    const pretty = text.match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] || "";
    const id = (text.match(/^ID="?([^"\n]+)/m)?.[1] || "linux").toLowerCase();
    return { id: id === "ubuntu" ? "ubuntu" as const : "linux" as const, label: pretty || "Linux" };
  } catch {
    return { id: "linux" as const, label: "Linux" };
  }
}

function probeGit() {
  const r = spawnSync("git", ["--version"], {
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
    shell: process.platform === "win32",
  });
  const ok = r.status === 0;
  const os = hostOs();
  return {
    ok,
    version: ok ? String(r.stdout || r.stderr || "").trim() : "",
    hint: ok
      ? ""
      : os.id === "windows"
        ? "未检测到 Git。请自行安装 https://git-scm.com 并勾选加入 PATH 后重试。"
        : "未检测到 Git。请自行安装，例如：sudo apt install git",
  };
}

export function resolveSystemPython() {
  const custom = loadSettings().comfy.pythonPath.trim();
  const tries: Array<{ cmd: string; args: string[] }> = [];
  if (custom) tries.push({ cmd: custom, args: [] });
  if (process.platform === "win32") {
    tries.push(
      { cmd: "py", args: ["-3.12"] },
      { cmd: "py", args: ["-3.11"] },
      { cmd: "py", args: ["-3.10"] },
      { cmd: "py", args: ["-3"] },
      { cmd: "python", args: [] },
      { cmd: "python3", args: [] },
    );
  } else {
    tries.push(
      { cmd: "python3.12", args: [] },
      { cmd: "python3.11", args: [] },
      { cmd: "python3.10", args: [] },
      { cmd: "python3", args: [] },
      { cmd: "python", args: [] },
    );
  }
  for (const t of tries) {
    const r = spawnSync(t.cmd, [...t.args, "-c", "import sys; print('%d.%d' % sys.version_info[:2]); print(sys.executable)"], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
      shell: process.platform === "win32",
    });
    if (r.status !== 0) continue;
    const lines = String(r.stdout || "").trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const ver = lines[0] || "";
    const [major, minor] = ver.split(".").map(Number);
    if (!major || minor < 0 || major < 3 || (major === 3 && minor < 10)) continue;
    const executable = lines[1] || "";
    if (!executable) continue;
    return { executable, version: ver };
  }
  return null;
}

function pythonHint() {
  const os = hostOs();
  if (os.id === "windows") {
    return "未检测到 Python 3.10+。请自行从 https://www.python.org 安装，并勾选 Add python.exe to PATH。";
  }
  if (os.id === "ubuntu") {
    return "未检测到 Python 3.10+。请自行安装，例如：sudo apt install python3 python3-venv python3-pip";
  }
  return "未检测到 Python 3.10+。请自行安装 python3、python3-venv、python3-pip。";
}

export function hostPrereqs() {
  const git = probeGit();
  const py = resolveSystemPython();
  const venv = detectComfyPython(loadSettings().comfy.installDir);
  return {
    os: hostOs(),
    git,
    python: py
      ? { ok: true as const, version: py.version, executable: displayMaybePath(py.executable) || py.executable, hint: "" }
      : { ok: false as const, version: "", executable: "", hint: pythonHint() },
    venvPython: venv ? displayMaybePath(venv) : "",
  };
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

export function detectAccel() {
  const override = (process.env.COMFYUI_CUDA || "").trim().toLowerCase();
  if (override === "cpu") {
    return {
      kind: "cpu" as const,
      tag: "cpu",
      extraIndexUrl: "https://download.pytorch.org/whl/cpu",
      label: "CPU",
      gpu: "",
      cudaVersion: "",
    };
  }
  if (/^cu\d+$/.test(override)) {
    return {
      kind: "cuda" as const,
      tag: override,
      extraIndexUrl: `https://download.pytorch.org/whl/${override}`,
      label: `CUDA ${override}`,
      gpu: "",
      cudaVersion: "",
    };
  }
  if (process.platform === "darwin") {
    return {
      kind: "mps" as const,
      tag: "",
      extraIndexUrl: "",
      label: "Apple Silicon / MPS",
      gpu: "",
      cudaVersion: "",
    };
  }

  const smiBin = process.platform === "win32" && existsSync("C:\\Windows\\System32\\nvidia-smi.exe")
    ? "C:\\Windows\\System32\\nvidia-smi.exe"
    : "nvidia-smi";
  const gpuInfo = spawnSync(smiBin, ["--query-gpu=name", "--format=csv,noheader"], {
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
    shell: process.platform === "win32",
  });
  const gpu = String(gpuInfo.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)[0] || "";
  const header = spawnSync(smiBin, [], {
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
    shell: process.platform === "win32",
  });
  const cudaVersion = `${header.stdout || ""}\n${header.stderr || ""}`.match(/CUDA Version:\s*([\d.]+)/i)?.[1] || "";
  const nvidiaOk = Boolean(gpu) || (header.status === 0 && cudaVersion);

  if (!nvidiaOk) {
    return {
      kind: "cpu" as const,
      tag: "cpu",
      extraIndexUrl: "https://download.pytorch.org/whl/cpu",
      label: "CPU（未检测到 NVIDIA GPU）",
      gpu: "",
      cudaVersion: "",
    };
  }

  const tag = pickCudaTag(gpu, cudaVersion);
  return {
    kind: "cuda" as const,
    tag,
    extraIndexUrl: `https://download.pytorch.org/whl/${tag}`,
    label: [gpu, cudaVersion ? `驱动 CUDA ${cudaVersion}` : "", tag].filter(Boolean).join(" · "),
    gpu,
    cudaVersion,
  };
}

function pickCudaTag(gpu: string, cudaVersion: string) {
  if (/GTX\s*1[06]\d{2}|Tesla P40|Quadro P\d/i.test(gpu)) return "cu126";
  const v = Number.parseFloat(cudaVersion || "13");
  if (v >= 13) return "cu130";
  if (v >= 12.8) return "cu128";
  if (v >= 12.6) return "cu126";
  if (v >= 12.4) return "cu124";
  if (v >= 12.1) return "cu121";
  if (v >= 11.8) return "cu118";
  return "cu130";
}

async function torchCudaReady(cwd: string) {
  const r = await run(pythonBin(), ["-c", "import torch; print('CUDA' if torch.cuda.is_available() else 'CPU')"], cwd);
  return /\bCUDA\b/.test(r.log);
}

async function installCudaDeps(cwd: string, alsoRequirements: boolean) {
  const accel = detectAccel();
  appendLog(`加速：${accel.label}`);
  const torchArgs = ["-m", "pip", "install", "--upgrade", "--progress-bar", "on", "torch", "torchvision", "torchaudio"];
  if (accel.kind === "cuda") {
    torchArgs.push("--extra-index-url", accel.extraIndexUrl);
  } else if (accel.kind === "cpu") {
    torchArgs.push("--extra-index-url", accel.extraIndexUrl);
  }
  const torch = await run(pythonBin(), torchArgs, cwd);
  if (torch.code !== 0) {
    throw new Error(
      `安装 PyTorch 失败${accel.kind === "cuda" ? `（需要 ${accel.tag} CUDA 轮子）` : ""}。请确认已装 NVIDIA 驱动与 Python 3.10+。\n${torch.log.slice(-1200)}`,
    );
  }
  if (alsoRequirements && existsSync(join(cwd, "requirements.txt"))) {
    const req = ["-m", "pip", "install", "--progress-bar", "on", "-r", "requirements.txt"];
    if (accel.extraIndexUrl) req.push("--extra-index-url", accel.extraIndexUrl);
    const pip = await run(pythonBin(), req, cwd);
    if (pip.code !== 0) throw new Error(`安装 Python 依赖失败。请确认已安装 Python 3.10+。\n${pip.log.slice(-800)}`);
  }
  return accel;
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
    accel: detectAccel(),
    prereqs: hostPrereqs(),
    pid: alive ? proc.pid : undefined,
    processRunning: alive,
    api: ping,
    baseUrl: s.baseUrl,
    listenHost: s.listenHost,
    listenPort: s.listenPort,
    logFile: formatOsPath(logFile()),
    installLog: formatOsPath(installLogFile()),
    installing: installRunning,
  };
}

function run(cmd: string, args: string[], cwd: string) {
  return new Promise<{ code: number; log: string }>((resolve, reject) => {
    const line = `$ ${cmd} ${args.join(" ")}\n`;
    appendLog(line.trimEnd());
    const child = spawn(cmd, args, {
      cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
    });
    let log = line;
    const onChunk = (d: Buffer | string) => {
      const t = d.toString();
      log += t;
      appendLogChunk(t);
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", reject);
    child.on("close", (code) => {
      if (!log.endsWith("\n")) appendLogChunk("\n");
      resolve({ code: code ?? 1, log });
    });
  });
}

function appendLog(text: string) {
  mkdirSync(loadSettings().dataDir, { recursive: true });
  appendFileSync(installLogFile(), `${text}\n`, "utf8");
}

function appendLogChunk(text: string) {
  mkdirSync(loadSettings().dataDir, { recursive: true });
  appendFileSync(installLogFile(), text, "utf8");
}

function venvPythonPath(installDir: string) {
  return process.platform === "win32"
    ? join(installDir, ".venv", "Scripts", "python.exe")
    : join(installDir, ".venv", "bin", "python");
}

async function ensureVenv(installDir: string) {
  const portable = detectComfyPython(installDir);
  if (portable && !portable.replace(/\\/g, "/").includes("/.venv/") && !portable.replace(/\\/g, "/").includes("/venv/")) {
    return portable;
  }
  const existing = venvPythonPath(installDir);
  if (existsSync(existing)) {
    saveSettings({ comfy: { ...loadSettings().comfy, pythonPath: existing } });
    return existing;
  }
  const sys = resolveSystemPython();
  if (!sys) throw new Error(pythonHint());
  mkdirSync(installDir, { recursive: true });
  appendLog(`创建虚拟环境：${formatOsPath(join(installDir, ".venv"))}（Python ${sys.version}）`);
  const created = await run(sys.executable, ["-m", "venv", join(installDir, ".venv")], installDir);
  if (created.code !== 0 || !existsSync(existing)) {
    const extra = hostOs().id === "ubuntu" || hostOs().id === "linux"
      ? " Ubuntu/Debian 请确认已自行安装 python3-venv：sudo apt install python3-venv"
      : "";
    throw new Error(`无法创建 Python 虚拟环境。${extra}\n${created.log.slice(-800)}`);
  }
  const pip = await run(existing, ["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"], installDir);
  if (pip.code !== 0) throw new Error(`升级 pip 失败。\n${pip.log.slice(-800)}`);
  saveSettings({ comfy: { ...loadSettings().comfy, pythonPath: existing } });
  return existing;
}

function requireGit() {
  const git = probeGit();
  if (!git.ok) throw new Error(git.hint);
}

export async function installComfy() {
  if (installRunning) throw new Error("正在安装，请稍候");
  installRunning = true;
  appendLog(`======== ${new Date().toISOString()} 开始安装 ========`);
  try {
    const result = await doInstallComfy();
    appendLog("======== 安装完成 ========");
    return result;
  } catch (err) {
    appendLog(`======== 安装失败：${err instanceof Error ? err.message.split("\n")[0] : String(err)} ========`);
    throw err;
  } finally {
    installRunning = false;
  }
}

async function doInstallComfy() {
  const current = loadSettings();
  const existing = listExistingComfyInstalls();
  const configured = current.comfy.installDir;
  const found = isComfyRoot(configured) ? resolve(configured) : existing[0] || "";
  if (found) {
    const bundled = isBundledInstall(found);
    const pythonPath = bundled
      ? await ensureVenv(found)
      : current.comfy.pythonPath.trim() || detectComfyPython(found) || (await ensureVenv(found));
    saveSettings({
      comfy: {
        ...loadSettings().comfy,
        installDir: found,
        pythonPath,
      },
    });
    writeExtraModelPaths();
    appendLog(`使用已安装 ComfyUI：${formatOsPath(found)}\n模型目录：${formatOsPath(loadSettings().comfy.modelsDir)}`);
    let accel = detectAccel();
    if (bundled || !(await torchCudaReady(found))) {
      accel = await installCudaDeps(found, bundled);
    }
    return {
      ok: true,
      reused: true,
      bundled,
      accel,
      os: hostOs(),
      installDir: formatOsPath(found),
      modelsDir: formatOsPath(loadSettings().comfy.modelsDir),
      pythonPath: displayMaybePath(pythonBin()) || pythonBin(),
    };
  }
  requireGit();
  if (!resolveSystemPython()) throw new Error(pythonHint());
  const { installDir } = loadSettings().comfy;
  mkdirSync(installDir, { recursive: true });
  if (!comfyInstalled()) {
    const parent = join(installDir, "..");
    const name = installDir.split(/[/\\]/).pop() || "ComfyUI";
    const cloned = await run("git", ["clone", "--progress", "--depth", "1", "https://github.com/comfyanonymous/ComfyUI.git", name], parent);
    if (cloned.code !== 0) throw new Error(`${probeGit().ok ? "克隆 ComfyUI 失败。" : probeGit().hint}\n${cloned.log.slice(-800)}`);
  }
  await ensureVenv(installDir);
  const accel = await installCudaDeps(installDir, true);
  writeExtraModelPaths();
  return {
    ok: true,
    reused: false,
    bundled: true,
    accel,
    os: hostOs(),
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
