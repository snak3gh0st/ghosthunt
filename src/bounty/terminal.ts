import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { type ExecutionEvent } from "./execution.js";
import { type Run } from "./model.js";

export interface TerminalEvent extends ExecutionEvent {
  seq: number;
  time: string;
}
export function terminalRedact(raw: string) {
  return stripVTControlCharacters(raw)
    .replace(
      /\b(?:sk-(?:proj-)?[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9_]{15,}|AKIA[A-Z0-9]{16})\b/g,
      "[REDACTED]",
    )
    .replace(
      /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key):.*$/gim,
      "$1: [REDACTED]",
    )
    .replace(
      /([?&](?:token|api_key|access_token|secret|password)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /("(?:password|token|secret|api_key|access_token)"\s*:\s*")[^"]*"/gi,
      '$1[REDACTED]"',
    );
}

class TerminalSession {
  events: TerminalEvent[] = [];
  ended = false;
  private bytes = 0;
  private truncated = false;
  private pending = { stdout: "", stderr: "" };
  private dropping = { stdout: false, stderr: false };
  private listeners = new Set<(event: TerminalEvent) => void>();
  emit = (event: ExecutionEvent) => {
    if (this.ended) return;
    if (event.kind === "stdout" || event.kind === "stderr") {
      const stream = event.kind;
      const parts = (this.pending[stream] + event.text).split(/\r\n|\n|\r/);
      this.pending[stream] = parts.pop() || "";
      for (const line of parts) {
        if (!this.dropping[stream]) this.push({ ...event, text: line + "\n" });
        this.dropping[stream] = false;
      }
      if (this.pending[stream].length > 16000) {
        this.pending[stream] = "";
        if (!this.dropping[stream])
          this.push({
            kind: "system",
            text: "Linha longa omitida do terminal; confira o resultado filtrado.\n",
          });
        this.dropping[stream] = true;
      }
    } else {
      if (event.kind === "exit") this.flush();
      this.push(event);
    }
  };
  private push(event: ExecutionEvent) {
    let text = terminalRedact(event.text);
    if (
      (this.truncated ||
        this.events.length >= 2000 ||
        this.bytes +
          Buffer.byteLength(JSON.stringify({ ...event, text })) +
          70 >
          245000) &&
      event.kind !== "status"
    ) {
      if (this.truncated) return;
      this.truncated = true;
      event = {
        kind: "system",
        text: "Limite de transcrição atingido; o processo continua até concluir ou ser cancelado.\n",
      };
      text = event.text;
    }
    const record = {
      ...event,
      text,
      seq: this.events.length + 1,
      time: new Date().toISOString(),
    };
    this.bytes += Buffer.byteLength(JSON.stringify(record));
    this.events.push(record);
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }
  private flush() {
    for (const stream of ["stdout", "stderr"] as const) {
      if (this.pending[stream] && !this.dropping[stream])
        this.push({ kind: stream, text: this.pending[stream] + "\n" });
      this.pending[stream] = "";
      this.dropping[stream] = false;
    }
  }
  finish(status: string, error?: string) {
    if (this.ended) return;
    this.flush();
    if (error) this.push({ kind: "system", text: error + "\n" });
    this.push({ kind: "status", text: `Execução ${status}.\n`, status });
    this.ended = true;
  }
  subscribe(listener: (event: TerminalEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
export class RunTerminals {
  private sessions = new Map<string, TerminalSession>();
  constructor(private directory: string) {}
  start(run: Run) {
    const session = new TerminalSession();
    this.sessions.set(run.id, session);
    session.emit({
      kind: "system",
      text: `GHOSTHUNT // ${run.tool}\nAlvo: ${run.target}\nEscopo confirmado: v${run.scopeVersion}\n`,
    });
    return session;
  }
  async finish(run: Run) {
    const session = this.sessions.get(run.id);
    if (!session) return;
    session.finish(run.status, run.error);
    const folder = join(this.directory, "terminals");
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const path = join(folder, `${run.id}.json`);
    await writeFile(path + ".tmp", JSON.stringify(session.events), {
      mode: 0o600,
    });
    await rename(path + ".tmp", path);
    // Keep active sessions and a small replay cache; older transcripts stay on disk.
    const completed = [...this.sessions.entries()].filter(([, s]) => s.ended);
    for (const [id] of completed.slice(0, Math.max(0, completed.length - 20)))
      this.sessions.delete(id);
  }
  async get(run: Run) {
    const active = this.sessions.get(run.id);
    if (active) return active;
    const session = new TerminalSession();
    try {
      const bytes = await readFile(
        join(this.directory, "terminals", `${run.id}.json`),
        "utf8",
      );
      if (bytes.length > 1_000_000) throw Error("limit");
      session.events = JSON.parse(bytes);
      session.ended = true;
    } catch {
      session.emit({
        kind: "system",
        text: "Histórico de resultado: esta execução não possui transcrição ao vivo.\n",
      });
      if (run.output) session.emit({ kind: "stdout", text: run.output + "\n" });
      session.finish(run.status, run.error);
    }
    return session;
  }
}
