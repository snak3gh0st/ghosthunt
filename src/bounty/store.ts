import {
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { emptyWorkspace, type Workspace } from "./model.js";

/** Personal workspace: serialized transactions, exclusive writer, atomic rename, restrictive permissions. */
export class BountyStore {
  private queue: Promise<unknown> = Promise.resolve();
  private lockFile: string;
  private file: string;
  private locked = false;
  constructor(readonly directory: string) {
    this.file = join(directory, "workspace.json");
    this.lockFile = join(directory, "writer.lock");
  }
  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const lock = await open(this.lockFile, "wx", 0o600);
      await lock.writeFile(String(process.pid));
      await lock.close();
      this.locked = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await readFile(this.lockFile, "utf8"));
      if (!Number.isSafeInteger(pid) || pid < 1)
        throw new Error("Workspace bloqueado: verifique writer.lock.");
      try {
        process.kill(pid, 0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ESRCH") {
          await unlink(this.lockFile);
          return this.init();
        }
        throw e;
      }
      throw new Error("Outro processo já está usando este workspace.");
    }
    const current = await this.read();
    if (current.runs.some((run) => run.status === "running")) {
      await this.mutate((data) => {
        for (const run of data.runs)
          if (run.status === "running") {
            run.status = "interrupted";
            run.error = "Execução interrompida durante reinicialização.";
            run.finishedAt = new Date().toISOString();
            for (const stage of run.stages || []) if (["running", "waiting"].includes(stage.status)) { stage.status = "interrupted"; stage.reason = "Operação interrompida durante reinicialização."; stage.finishedAt = run.finishedAt; }
          }
      });
    }
  }
  async read(): Promise<Workspace> {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8")) as Workspace;
      if (
        data.version !== 1 ||
        !["programs", "findings", "evidence", "runs", "advice"].every((k) =>
          Array.isArray(data[k as keyof Workspace]),
        )
      )
        throw new Error(
          "Formato de workspace inválido. Preserve o arquivo para recuperação.",
        );
      return data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return emptyWorkspace();
      throw e;
    }
  }
  mutate<T>(operation: (data: Workspace) => T): Promise<T> {
    const result = this.queue.then(async () => {
      if (!this.locked) throw new Error("Workspace não inicializado.");
      const data = await this.read();
      const value = operation(data);
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      const handle = await open(tmp, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(data, null, 2));
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await rename(tmp, this.file);
      } catch (error) {
        await unlink(tmp).catch(() => {});
        throw error;
      }
      return value;
    });
    this.queue = result.catch(() => {});
    return result;
  }
  async close() {
    await this.queue;
    if (this.locked) {
      await unlink(this.lockFile);
      this.locked = false;
    }
  }
}
