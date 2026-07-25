import { spawn } from "node:child_process";

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export async function runProcess(
  command: string,
  args: string[],
  options: { timeoutMs: number; cwd?: string; maxOutputBytes?: number }
): Promise<ProcessResult> {
  const maximum = options.maxOutputBytes ?? 2_000_000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...(options.cwd ? { cwd: options.cwd } : {})
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (work: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      work();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      const forceTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      forceTimer.unref();
      finish(() => reject(new Error(`Process timed out after ${options.timeoutMs}ms: ${command}`)));
    }, options.timeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout) > maximum) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (Buffer.byteLength(stderr) > maximum) child.kill("SIGTERM");
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code, signal) => finish(() => {
      if (Buffer.byteLength(stdout) > maximum || Buffer.byteLength(stderr) > maximum) {
        reject(new Error(`Process output exceeded ${maximum} bytes: ${command}`));
      } else if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`Process failed (${code ?? signal ?? "unknown"}): ${command}: ${stderr.trim()}`));
      }
    }));
  });
}
