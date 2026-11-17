import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";
import { basename } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { executionEvent } from "./execution.js";

export async function binaryPath(
  name: string,
  directory: string,
): Promise<string | null> {
  for (const root of [
    join(directory, "bin"),
    ...(process.env.PATH || "").split(delimiter),
  ]) {
    const candidate = join(root, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* next */
    }
  }
  return null;
}

export interface ProcessResult {
  output: string;
  code: number;
  stderr?: string;
}
export function runProcess(
  binary: string,
  args: string[],
  options: {
    cwd: string;
    timeout?: number;
    input?: string;
    maxBytes?: number;
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
    onStdout?: (text: string) => void;
    onStderr?: (text: string) => void;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...options.env, NO_COLOR: "1" },
    });
    executionEvent({
      kind: "command",
      text: `$ ${[basename(binary), ...args.map((arg) => (/^[a-zA-Z0-9_./:=@-]+$/.test(arg) ? arg : JSON.stringify(arg)))].join(" ")}\n`,
      pid: child.pid,
    });
    const stdoutDecoder = new StringDecoder("utf8"),
      stderrDecoder = new StringDecoder("utf8");
    const limit = options.maxBytes ?? 1_000_000;
    let output = "";
    let stderr = "";
    let bytes = 0;
    let failure: Error | null = null;
    const stop = (reason: string) => {
      failure = new Error(reason);
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* already exited */
      }
    };
    const abort = () => stop("Execução cancelada.");
    const timer = setTimeout(
      () => stop("Tempo máximo de execução atingido."),
      options.timeout ?? 120000,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const receive = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) {
        stop("Saída excedeu o limite.");
        return;
      }
      const text = stdoutDecoder.write(chunk);
      output += text;
      if (options.onStdout) options.onStdout(text);
      else executionEvent({ kind: "stdout", text, pid: child.pid });
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) stop("Saída excedeu o limite.");
      else {
        const text = stderrDecoder.write(chunk);
        stderr += text;
        if (options.onStderr) options.onStderr(text);
        else executionEvent({ kind: "stderr", text, pid: child.pid });
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      output += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      executionEvent({
        kind: "exit",
        text: `Processo ${child.pid || "sem PID"} encerrado: ${code === null ? "interrompido" : `código ${code}`}\n`,
        pid: child.pid,
        code: code ?? undefined,
      });
      if (failure) reject(failure);
      else resolve({ output, stderr, code: code ?? 1 });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
  });
}
