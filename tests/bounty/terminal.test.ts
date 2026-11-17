import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BountyStore } from "../../src/bounty/store.js";
import { buildBountyApp } from "../../src/bounty/server.js";
import { runProcess } from "../../src/bounty/process.js";
import { RunTerminals } from "../../src/bounty/terminal.js";
import { withExecution } from "../../src/bounty/execution.js";
import type { Run } from "../../src/bounty/model.js";
const key = "terminal-test-key-no-production-credential";
let directory: string,
  store: BountyStore,
  app: Awaited<ReturnType<typeof buildBountyApp>>,
  base: string;
let script =
  'process.stdout.write("phase one\\n");setTimeout(()=>process.stdout.write("phase two\\n"),900)';
beforeEach(async () => {
  script =
    'process.stdout.write("phase one\\n");setTimeout(()=>process.stdout.write("phase two\\n"),900)';
  directory = await mkdtemp(join(tmpdir(), "ghosthunt-terminal-"));
  store = new BountyStore(directory);
  await store.init();
  app = await buildBountyApp({
    store,
    apiKey: key,
    runner: async (_tool, _target, _program, signal) =>
      runProcess(process.execPath, ["-e", script], { cwd: directory, signal }),
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw Error("No address");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await app.close();
  await store.close();
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
function stdoutEvents(text: string) {
  return text
    .split("\n\n")
    .slice(0, -1)
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice(6)))
    .filter((event) => event.kind === "stdout")
    .map((event) => event.text)
    .join("");
}
async function start() {
  const p = await app.inject({
    method: "POST",
    url: "/api/bounty/programs",
    headers: { "x-api-key": key },
    payload: {
      name: "Terminal lab",
      url: "https://hackerone.com/example",
      inScope: ["app.example.test"],
      scopeConfirmed: true,
      policy: "Public test fixtures only.",
    },
  });
  const evaluated = await app.inject({ method: "POST", url: `/api/bounty/programs/${p.json().id}/assessment`, headers: { "x-api-key": key }, payload: { target: "https://app.example.test", objective: "Review isolated fixture behavior", timeBudgetMinutes: 30, access: "public", policyReviewed: true, limits: "Synthetic process output only; no target requests." } });
  await app.inject({ method: "POST", url: `/api/bounty/programs/${p.json().id}/assessment/approve`, headers: { "x-api-key": key }, payload: { assessmentId: evaluated.json().assessment.id } });
  const r = await app.inject({
    method: "POST",
    url: `/api/bounty/programs/${p.json().id}/runs`,
    headers: { "x-api-key": key },
    payload: { tool: "cbh-classify", target: "https://app.example.test" },
  });
  expect(r.statusCode).toBe(202);
  return r.json() as Run;
}
it("streams actual process output before completion and persists a replay with a real PID", async () => {
  const run = await start();
  const response = await fetch(`${base}/api/bounty/runs/${run.id}/terminal`, {
    headers: { "x-api-key": key },
  });
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body!.getReader();
  let output = "";
  while (!stdoutEvents(output).includes("phase one")) {
    const chunk = await reader.read();
    if (chunk.done) throw Error("Stream ended early");
    output += new TextDecoder().decode(chunk.value);
  }
  expect((await store.read()).runs[0].status).toBe("running");
  expect(output).toMatch(/"pid":\d+/);
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    output += new TextDecoder().decode(chunk.value);
  }
  expect(output).toContain("phase two");
  expect(output).toContain('"status":"completed"');
  await vi.waitFor(async () =>
    expect(
      (await stat(join(directory, "terminals", `${run.id}.json`))).mode & 0o777,
    ).toBe(0o600),
  );
  const replay = await fetch(
    `${base}/api/bounty/runs/${run.id}/terminal?after=1`,
    { headers: { "x-api-key": key } },
  );
  const replayText = await replay.text();
  expect(replayText).not.toContain('"seq":1,');
  expect(replayText).toContain("phase one");
  expect(
    (await fetch(`${base}/api/bounty/runs/${run.id}/terminal`)).status,
  ).toBe(401);
});
it("cancels the real child process and closes the stream with an interrupted status", async () => {
  script = 'process.stdout.write("waiting\\n");setInterval(()=>{},1000)';
  const run = await start();
  const response = await fetch(`${base}/api/bounty/runs/${run.id}/terminal`, {
    headers: { "x-api-key": key },
  });
  const reader = response.body!.getReader();
  let output = "";
  while (!stdoutEvents(output).includes("waiting")) {
    const { value } = await reader.read();
    output += new TextDecoder().decode(value);
  }
  const pid = Number(/"pid":(\d+)/.exec(output)![1]);
  process.kill(pid, 0);
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/bounty/runs/${run.id}/cancel`,
        headers: { "x-api-key": key },
      })
    ).statusCode,
  ).toBe(200);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += new TextDecoder().decode(value);
  }
  expect(output).toContain('"status":"interrupted"');
  expect(() => process.kill(pid, 0)).toThrow();
});
it("isolates simultaneous process streams and redacts credentials split across chunks", async () => {
  const terminals = new RunTerminals(directory);
  const makeRun = (): Run => ({
    id: randomUUID(),
    programId: "lab",
    tool: "test",
    target: "https://app.example.test",
    scopeVersion: 1,
    status: "running",
    createdAt: "",
    output: "",
  });
  const first = makeRun(),
    second = makeRun(),
    a = terminals.start(first),
    b = terminals.start(second);
  await Promise.all([
    withExecution(a.emit, () =>
      runProcess(
        process.execPath,
        [
          "-e",
          'process.stdout.write("Authorization: Bea");setTimeout(()=>process.stdout.write("rer PRIVATE_VALUE\\nalpha\\n"),40)',
        ],
        { cwd: directory },
      ),
    ),
    withExecution(b.emit, () =>
      runProcess(process.execPath, ["-e", 'process.stdout.write("beta\\n")'], {
        cwd: directory,
      }),
    ),
  ]);
  first.status = "completed";
  second.status = "completed";
  await terminals.finish(first);
  await terminals.finish(second);
  const aLog = await readFile(
      join(directory, "terminals", `${first.id}.json`),
      "utf8",
    ),
    bLog = await readFile(
      join(directory, "terminals", `${second.id}.json`),
      "utf8",
    );
  // Command arguments are part of the audit trail; check redaction on the actual stdout entries.
  const stdout = JSON.parse(aLog)
    .filter((event: { kind: string }) => event.kind === "stdout")
    .map((event: { text: string }) => event.text)
    .join("");
  expect(stdout).toContain("[REDACTED]");
  expect(stdout).not.toContain("PRIVATE_VALUE");
  expect(stdout).not.toContain("beta");
  expect(bLog).not.toContain("alpha");
});
it("bounds transcript memory and persisted bytes while preserving final status", async () => {
  const terminals = new RunTerminals(directory);
  const run: Run = {
    id: randomUUID(),
    programId: "lab",
    tool: "test",
    target: "https://app.example.test",
    scopeVersion: 1,
    status: "running",
    createdAt: "",
    output: "",
  };
  const session = terminals.start(run);
  for (let i = 0; i < 10000; i++)
    session.emit({ kind: "stdout", text: '"'.repeat(150) + "\n" });
  run.status = "completed";
  await terminals.finish(run);
  const bytes = await readFile(join(directory, "terminals", `${run.id}.json`));
  expect(bytes.length).toBeLessThan(250000);
  const events = JSON.parse(bytes.toString("utf8"));
  expect(
    events.some((event: { text: string }) =>
      event.text.includes("Limite de transcrição"),
    ),
  ).toBe(true);
  expect(events.at(-1).status).toBe("completed");
  expect(events.length).toBeLessThanOrEqual(2002);
});
