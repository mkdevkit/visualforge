import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { PACKAGE_ROOT, loadSettings } from "./config.ts";

const UNIRIG_TIMEOUT_MS = 20 * 60 * 1000;
const SUFFIX = "obj,fbx,FBX,dae,glb,gltf,vrm";

let running = false;

export function unirigDir() {
  const fromEnv = process.env.UNIRIG_DIR?.trim();
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : resolve(PACKAGE_ROOT, fromEnv);
  return join(PACKAGE_ROOT, "tools", "UniRig");
}

function venvPython(dir: string) {
  const win = join(dir, ".venv", "Scripts", "python.exe");
  const nix = join(dir, ".venv", "bin", "python");
  if (existsSync(win)) return win;
  if (existsSync(nix)) return nix;
  return "";
}

function unirigPython() {
  return (
    process.env.UNIRIG_PYTHON?.trim() ||
    venvPython(unirigDir()) ||
    loadSettings().comfy.pythonPath.trim() ||
    (process.platform === "win32" ? "python" : "python3")
  );
}

export function unirigStatus() {
  const dir = unirigDir();
  return {
    installed: existsSync(join(dir, "run.py")),
    dir,
    python: unirigPython(),
    repo: "https://github.com/VAST-AI-Research/UniRig",
    busy: running,
  };
}

function slash(p: string) {
  return p.replace(/\\/g, "/");
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}_${p(d.getMonth() + 1)}_${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
}

function runCommand(cmd: string, args: string[], cwd: string, timeoutMs?: number) {
  return new Promise<{ code: number; log: string }>((resolvePromise, reject) => {
    const abs = /[\\/]/.test(cmd);
    const child = spawn(cmd, args, {
      cwd,
      windowsHide: true,
      shell: process.platform === "win32" && !abs,
      env: { ...process.env, PYTHONUTF8: "1" },
    });
    let log = `$ ${cmd} ${args.join(" ")}\n`;
    const timer = timeoutMs
      ? setTimeout(() => {
          try {
            child.kill();
          } catch {
            /* ignore */
          }
          if (process.platform === "win32" && child.pid) {
            spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: true, windowsHide: true });
          }
        }, timeoutMs)
      : undefined;
    child.stdout?.on("data", (d) => {
      log += d.toString();
    });
    child.stderr?.on("data", (d) => {
      log += d.toString();
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code: code ?? 1, log });
    });
  });
}

async function py(args: string[], cwd: string) {
  const r = await runCommand(unirigPython(), args, cwd, UNIRIG_TIMEOUT_MS);
  if (r.code !== 0) {
    throw new Error(
      `UniRig 失败（exit ${r.code}）。请确认已按官方 README 装好 Python 3.11 + PyTorch 等，并可用 UNIRIG_PYTHON 指定解释器。\n${r.log.slice(-2000)}`,
    );
  }
  return r;
}

async function runUniRigPipeline(inputGlb: string, workDir: string): Promise<string> {
  const dir = unirigDir();
  if (!unirigStatus().installed) {
    throw new Error("尚未安装 UniRig。请到 ComfyManager 概览页安装。");
  }
  mkdirSync(workDir, { recursive: true });
  const npzDir = join(workDir, "npz");
  const skel = slash(join(workDir, "skeleton.fbx"));
  const skin = slash(join(workDir, "skin.fbx"));
  const out = slash(join(workDir, "rigged.glb"));
  const input = slash(inputGlb);
  const npz = slash(npzDir);
  mkdirSync(npzDir, { recursive: true });

  await py(
    [
      "-m",
      "src.data.extract",
      "--config=configs/data/quick_inference.yaml",
      `--require_suffix=${SUFFIX}`,
      "--force_override=true",
      "--num_runs=1",
      "--id=0",
      `--time=${stamp()}`,
      "--faces_target_count=50000",
      `--input=${input}`,
      `--output_dir=${npz}`,
    ],
    dir,
  );
  await py(
    [
      "run.py",
      "--task=configs/task/quick_inference_skeleton_articulationxl_ar_256.yaml",
      "--seed=12345",
      `--input=${input}`,
      `--output=${skel}`,
      `--npz_dir=${npz}`,
    ],
    dir,
  );
  await py(
    [
      "-m",
      "src.data.extract",
      "--config=configs/data/quick_inference.yaml",
      `--require_suffix=${SUFFIX}`,
      "--force_override=true",
      "--num_runs=1",
      "--id=0",
      `--time=${stamp()}`,
      "--faces_target_count=50000",
      `--input=${skel}`,
      `--output_dir=${npz}`,
    ],
    dir,
  );
  await py(
    [
      "run.py",
      "--task=configs/task/quick_inference_unirig_skin.yaml",
      "--seed=12345",
      `--input=${skel}`,
      `--output=${skin}`,
      `--npz_dir=${npz}`,
    ],
    dir,
  );
  await py(
    [
      "-m",
      "src.inference.merge",
      `--require_suffix=${SUFFIX}`,
      "--num_runs=1",
      "--id=0",
      `--source=${skin}`,
      `--target=${input}`,
      `--output=${out}`,
    ],
    dir,
  );
  if (!existsSync(out)) throw new Error("UniRig 没有写出 rigged.glb");
  return out;
}

export async function runUniRigFromBuffer(buffer: Buffer): Promise<Buffer> {
  if (running) throw new Error("UniRig 正在运行，请稍后再试");
  running = true;
  const workDir = join(loadSettings().dataDir, "tmp", `unirig-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });
  const input = join(workDir, "input.glb");
  writeFileSync(input, buffer);
  try {
    const out = await runUniRigPipeline(input, workDir);
    return readFileSync(out);
  } finally {
    running = false;
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export async function installUniRig() {
  const dir = unirigDir();
  const parent = join(dir, "..");
  mkdirSync(parent, { recursive: true });
  if (!existsSync(join(dir, "run.py"))) {
    const cloned = await runCommand("git", ["clone", "--depth", "1", "https://github.com/VAST-AI-Research/UniRig.git", "UniRig"], parent);
    if (cloned.code !== 0) throw new Error(`克隆 UniRig 失败。请确认已安装 Git。\n${cloned.log.slice(-800)}`);
  }
  return {
    ok: true,
    ...unirigStatus(),
    note: "仓库已就绪。请按 UniRig README 用 Python 3.11 + PyTorch 安装依赖，可用 UNIRIG_PYTHON 指向该解释器。视铸通过 POST /api/tools/unirig/run 调用，由本进程拉起 Python 子进程。",
  };
}
