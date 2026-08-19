import { spawn } from "node:child_process";

export function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; log: string }> {
  return new Promise((resolve, reject) => {
    const abs = /[\\/]/.test(cmd);
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      windowsHide: true,
      shell: process.platform === "win32" && !abs,
      env: { ...process.env, PYTHONUTF8: "1", ...opts.env },
    });
    let log = `$ ${cmd} ${args.join(" ")}\n`;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          try {
            child.kill();
          } catch {
            /* ignore */
          }
          if (process.platform === "win32" && child.pid) {
            spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: true, windowsHide: true });
          }
        }, opts.timeoutMs)
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
      resolve({ code: code ?? 1, log });
    });
  });
}
