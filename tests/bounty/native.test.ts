import { mkdtemp, readFile, rm, writeFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { nativeEnvironment, nativeManifest, prepareNativeSession, runNativeTool, archiveNativeRun } from "../../src/bounty/native.js";
import { validateToolRequest } from "../../src/bounty/tools.js";
import { programInput, type Program } from "../../src/bounty/model.js";
let directory: string;
const program: Program = { ...programInput.parse({ name: "Native bridge test", url: "https://hackerone.com/example", inScope: ["https://github.com/example/source"], outOfScope: ["https://github.com/example/source/private"], scopeConfirmed: true }), id: "aabbcc", createdAt: "2026-11-17", updatedAt: "2026-11-17", scopeVersion: 2 };
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "ghosthunt-native-")); });
afterEach(async () => { await rm(directory, { force: true, recursive: true }); });
it("runs the actual Ghosthunt CLI against a per-program session, preserving CURRENT", async () => {
  const base = join(directory, "native"); await mkdir(base); await writeFile(join(base, "CURRENT"), "original");
  validateToolRequest("ghosthunt-status", program.inScope[0], program);
  const result = await runNativeTool(directory, "ghosthunt-status", program);
  expect(result?.code).toBe(0); expect(result?.output).toContain("Program: Native bridge test");
  expect(result?.output).toContain(program.inScope[0]);
  expect(await readFile(join(base, "CURRENT"), "utf8")).toBe("original");
  const session = await prepareNativeSession(directory, program);
  const state = JSON.parse(await readFile(join(session.folder, "engagement.json"), "utf8"));
  expect(state.scope).toEqual(program.inScope); expect(state.out_of_scope).toEqual(program.outOfScope);
  expect(state.scope_version).toBe(2); expect(state.web_managed).toBe(true);
});
it("archives actual outputs for the native report without mixing programs", async () => {
  await archiveNativeRun(directory, program, { id: "run1", programId: program.id, tool: "ghosthunt-status", target: program.inScope[0], scopeVersion: 2, status: "completed", createdAt: "", output: "observed output" });
  const result = await runNativeTool(directory, "ghosthunt-report", program);
  expect(result?.code).toBe(0);
  const first = await prepareNativeSession(directory, program);
  expect(await readFile(join(first.folder, "report.md"), "utf8")).toContain("run1.txt");
  expect(await readFile(join(first.folder, "evidence", "run1.txt"), "utf8")).toContain("observed output");
  const second = await prepareNativeSession(directory, { ...program, id: "second-program" });
  await expect(access(join(second.folder, "evidence", "run1.txt"))).rejects.toThrow();
});
it("returns inventory from Python and keeps local AI the explicit child default", async () => {
  const manifest = await nativeManifest(directory);
  expect(manifest.available).toBe(true); expect(manifest.engines).toHaveLength(10);
  expect(manifest.tools.some((tool: { id: string }) => tool.id === "msfconsole")).toBe(true);
  expect(nativeEnvironment(directory).BOUNTY_LLM).toBe("local");
});
it("rejects arbitrary native command names and invalid program paths", async () => {
  expect(await runNativeTool(directory, "ghosthunt-install", program)).toBeNull();
  await expect(prepareNativeSession(directory, { ...program, id: "../escape" })).rejects.toThrow("Identificador");
  expect(() => validateToolRequest("ghosthunt-status", "https://outside.example", program)).toThrow();
});
it("serves authenticated polling events for a real native CLI run", async () => {
  const { BountyStore } = await import("../../src/bounty/store.js");
  const { buildBountyApp } = await import("../../src/bounty/server.js");
  const store = new BountyStore(directory); await store.init();
  const key = "native-test-key-strong-and-local";
  const app = await buildBountyApp({ store, apiKey: key });
  const headers = { "x-api-key": key };
  try {
    const created = await app.inject({ method: "POST", url: "/api/bounty/programs", headers, payload: program });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const started = await app.inject({ method: "POST", url: `/api/bounty/programs/${id}/runs`, headers, payload: { tool: "ghosthunt-status", target: program.inScope[0] } });
    expect(started.statusCode).toBe(202);
    const url = `/api/bounty/runs/${started.json().id}/terminal?transport=poll`;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    let body: { ended: boolean; events: { seq: number; pid?: number; text: string; status?: string }[] } = { ended: false, events: [] };
    for (let i = 0; i < 100 && !body.ended; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      body = (await app.inject({ method: "GET", url, headers })).json();
    }
    expect(body.ended).toBe(true);
    expect(body.events.some((event) => event.pid && event.text.includes("ghosthunt.py"))).toBe(true);
    expect(body.events.map((event) => event.text).join("")).toContain("Program: Native bridge test");
    expect(body.events.at(-1)?.status).toBe("completed");
    const after = body.events.at(-1)!.seq;
    expect((await app.inject({ method: "GET", url: `${url}&after=${after}`, headers })).json().events).toEqual([]);
    const folder = join(directory, "native", "engagements", `web-${id}`, "evidence");
    expect(await readFile(join(folder, `${started.json().id}.txt`), "utf8")).toContain("Program: Native bridge test");
  } finally { await app.close(); await store.close(); }
});
