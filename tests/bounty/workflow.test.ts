import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BountyStore } from "../../src/bounty/store.js";
import { buildBountyApp } from "../../src/bounty/server.js";
import type { Finding, Program } from "../../src/bounty/model.js";

const key = "test-key-not-a-production-credential";
const programInput = {
  name: "Example lab",
  url: "https://hackerone.com/example",
  offersBounties: true,
  inScope: ["api.example.test"],
  outOfScope: ["https://api.example.test/admin"],
  scopeConfirmed: true,
  automationAllowed: true,
  policy: "Use only researcher-owned test accounts.",
};
const complete = {
  title: "Test account isolation issue",
  target: "https://api.example.test/account",
  category: "Access control",
  severity: "medium",
  summary: "Test account A can read the test resource owned by test account B.",
  preconditions: "Two researcher-controlled accounts.",
  steps:
    "1. Sign in as A.\n2. Request B test resource.\n3. Compare the response.",
  expected: "Only the owner should access this test resource.",
  actual: "The response contains B test record.",
  impact: "Unauthorized read of the other test account record.",
  reproductionConfirmed: true,
};

describe("personal bug bounty workflow", () => {
  let directory: string;
  let store: BountyStore;
  let app: Awaited<ReturnType<typeof buildBountyApp>>;
  const runner = vi
    .fn()
    .mockResolvedValue({ code: 0, output: "Offline classifier observation" });
  const advisor = vi.fn().mockResolvedValue({
    answer: "Compare duas contas de teste e guarde as respostas.",
    sources: ["https://github.com/elementalsouls/Claude-BugHunter"],
    costUsd: 0,
    provider: "local",
    model: "ghosthunt-local:q4",
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(join(tmpdir(), "ghosthunt-bounty-test-"));
    store = new BountyStore(directory);
    await store.init();
    app = await buildBountyApp({ store, apiKey: key, runner, advisor });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  function req(method: "GET" | "POST" | "PUT", url: string, payload?: unknown) {
    return app.inject({
      method,
      url,
      headers: { "x-api-key": key },
      ...(payload !== undefined ? { payload } : {}),
    });
  }
  async function program(): Promise<Program> {
    const r = await req("POST", "/api/bounty/programs", programInput);
    expect(r.statusCode).toBe(201);
    const p = r.json();
    const evaluated = await req("POST", `/api/bounty/programs/${p.id}/assessment`, { target: "https://api.example.test/account", objective: "Compare ownership checks with two test accounts", timeBudgetMinutes: 120, access: "test-accounts", policyReviewed: true, limits: "Only own test data; stop on unrelated data." });
    expect(evaluated.statusCode).toBe(200);
    expect((await req("POST", `/api/bounty/programs/${p.id}/assessment/approve`, { assessmentId: evaluated.json().assessment.id })).statusCode).toBe(200);
    return (await store.read()).programs.find(item => item.id === p.id)!;
  }
  async function finding(p: Program, body = complete): Promise<Finding> {
    const r = await req("POST", `/api/bounty/programs/${p.id}/findings`, body);
    expect(r.statusCode).toBe(201);
    return r.json();
  }
  async function ready(p: Program) {
    const f = await finding(p);
    await req("POST", `/api/bounty/findings/${f.id}/evidence`, {
      title: "Controlled comparison",
      kind: "request-response",
      content:
        "GET /account\nAccount A\nResponse: B test record\n```\npayload\n```",
    });
    await req("PUT", `/api/bounty/findings/${f.id}`, complete);
    return f;
  }

  it("protects data, catalog and executors with authentication", async () => {
    for (const url of [
      "/api/session",
      "/api/bounty/workspace",
      "/api/bounty/catalog",
      "/api/bounty/integrations",
    ])
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bounty/programs",
          payload: programInput,
        })
      ).statusCode,
    ).toBe(401);
    expect((await req("GET", "/api/session")).json()).toEqual({
      mode: "bounty",
    });
    expect(
      (await app.inject({ method: "GET", url: "/healthz" })).statusCode,
    ).toBe(200);
  });
  it("rejects unconfirmed and excluded assets before recording findings or starting work", async () => {
    const p = await program();
    expect(
      (
        await req("POST", `/api/bounty/programs/${p.id}/findings`, {
          ...complete,
          target: "https://api.example.test/admin/secret",
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await req("POST", `/api/bounty/programs/${p.id}/runs`, {
          tool: "cbh-classify",
          target: "https://other.example.test",
        })
      ).statusCode,
    ).toBe(422);
    await req("PUT", `/api/bounty/programs/${p.id}`, {
      ...programInput,
      scopeConfirmed: false,
    });
    expect(
      (await req("POST", `/api/bounty/programs/${p.id}/findings`, complete))
        .statusCode,
    ).toBe(409);
    expect(runner).not.toHaveBeenCalled();
  });
  it("rejects an incompatible tool before creating a failed job", async () => {
    const response = await req("POST", "/api/bounty/programs", {
      ...programInput,
      inScope: ["https://github.com/example/lab"],
      outOfScope: [],
    });
    const p = response.json();
    const result = await req("POST", `/api/bounty/programs/${p.id}/runs`, {
      tool: "subfinder",
      target: "https://github.com/example/lab",
    });
    expect(result.statusCode).toBe(422);
    expect((await store.read()).runs).toHaveLength(0);
    expect(runner).not.toHaveBeenCalled();
  });
  it("does not promote a hypothesis without reproduction and evidence", async () => {
    const p = await program();
    const f = await finding(p, { ...complete, reproductionConfirmed: false });
    expect(
      (
        await req("POST", `/api/bounty/findings/${f.id}/status`, {
          status: "validated",
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await req("GET", `/api/bounty/findings/${f.id}/report?final=true`))
        .statusCode,
    ).toBe(422);
    expect(
      (await req("GET", `/api/bounty/findings/${f.id}/report`)).body,
    ).toContain("DRAFT");
  });
  it("completes evidence -> validation -> report -> submission -> confirmed payment", async () => {
    const p = await program();
    const f = await ready(p);
    expect(
      (await req("GET", `/api/bounty/findings/${f.id}/report?final=true`))
        .statusCode,
    ).toBe(409);
    const material = (
      await req("GET", `/api/bounty/findings/${f.id}/evidence`)
    ).json();
    expect(material[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const status of ["validated"])
      expect(
        (await req("POST", `/api/bounty/findings/${f.id}/status`, { status }))
          .statusCode,
      ).toBe(200);
    expect((await req("POST", `/api/bounty/findings/${f.id}/status`, { status: "ready" })).statusCode).toBe(409);
    const preview = (await req("GET", `/api/bounty/findings/${f.id}/report/preview`)).json();
    expect(preview.gaps).toEqual([]); expect(preview.approved).toBe(false);
    expect((await req("POST", `/api/bounty/findings/${f.id}/report/approve`, { revision: preview.revision })).statusCode).toBe(200);
    const report = await req(
      "GET",
      `/api/bounty/findings/${f.id}/report?final=true`,
    );
    expect(report.statusCode).toBe(200);
    expect(report.body).toContain("## Steps to reproduce");
    expect(report.body).toContain("````text");
    expect(report.body).toContain("SHA-256");
    expect(report.body).not.toContain("DRAFT");
    expect(
      (
        await req("POST", `/api/bounty/findings/${f.id}/status`, {
          status: "submitted",
          reportUrl: "https://evil.test/reports/1",
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await req("POST", `/api/bounty/findings/${f.id}/status`, {
          status: "submitted",
          reportUrl: "https://hackerone.com/reports/123",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await req("POST", `/api/bounty/findings/${f.id}/status`, {
          status: "paid",
          rewardCents: 0,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await req("POST", `/api/bounty/findings/${f.id}/status`, {
          status: "paid",
          rewardCents: 25000,
          currency: "USD",
          minutesSpent: 180,
        })
      ).statusCode,
    ).toBe(200);
    const workspace = (await req("GET", "/api/bounty/workspace")).json();
    expect(workspace.summary.rewards.USD).toBe(25000);
    expect(workspace.summary.minutesSpent).toBe(180);
    expect(workspace.evidence[0].content).toBeUndefined();
    expect(
      (await req("PUT", `/api/bounty/findings/${f.id}`, complete)).statusCode,
    ).toBe(409);
  });
  it("scope edits invalidate the previously reviewed report", async () => {
    const p = await program();
    const f = await ready(p);
    await req("POST", `/api/bounty/findings/${f.id}/status`, {
      status: "validated",
    });
    await req("PUT", `/api/bounty/programs/${p.id}`, {
      ...programInput,
      policy: "Changed restrictions.",
    });
    const result = await req(
      "GET",
      `/api/bounty/findings/${f.id}/report?final=true`,
    );
    expect(result.statusCode).toBe(422);
    expect(result.body).toContain("mudança de escopo");
  });
  it("adding evidence requires another reproduction confirmation", async () => {
    const p = await program();
    const f = await ready(p);
    await req("POST", `/api/bounty/findings/${f.id}/status`, {
      status: "validated",
    });
    await req("POST", `/api/bounty/findings/${f.id}/evidence`, {
      title: "New evidence",
      kind: "reproduction",
      content: "New test",
    });
    expect(
      (
        await req("POST", `/api/bounty/findings/${f.id}/status`, {
          status: "validated",
        })
      ).statusCode,
    ).toBe(422);
  });
  it("stores AI advice and rejects cross-program context", async () => {
    const p = await program();
    const f = await finding(p);
    const other = (
      await req("POST", "/api/bounty/programs", {
        ...programInput,
        name: "Other",
        url: "https://hackerone.com/other",
      })
    ).json();
    expect(
      (
        await req("POST", `/api/bounty/programs/${other.id}/advice`, {
          question: "Compare the accounts",
          skill: "hunt-idor",
          findingId: f.id,
        })
      ).statusCode,
    ).toBe(422);
    const response = await req("POST", `/api/bounty/programs/${p.id}/advice`, {
      question: "What evidence is missing?",
      skill: "hunt-idor",
      findingId: f.id,
      provider: "local",
      localModel: "ollama:ghosthunt-local:q4",
    });
    expect(response.statusCode).toBe(200);
    expect(advisor).toHaveBeenCalledOnce();
    expect(advisor).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "local",
        localModel: "ollama:ghosthunt-local:q4",
      }),
    );
    expect(
      (await req("GET", "/api/bounty/workspace")).json().summary.aiCostUsd,
    ).toBe(0);
    expect(
      (await req("GET", "/api/bounty/workspace")).json().summary
        .localAdviceCount,
    ).toBe(1);
  });
  it("provides the latest completed observations to the advisor in chronological order", async () => {
    const p = await program();
    await store.mutate((state) => {
      state.runs = [4, 3, 2, 1].map((n) => ({
        id: String(n),
        programId: p.id,
        tool: "cbh-classify",
        target: complete.target,
        scopeVersion: p.scopeVersion,
        status: "completed",
        createdAt: String(n),
        output: `observation ${n}`,
      }));
    });
    const response = await req("POST", `/api/bounty/programs/${p.id}/advice`, {
      question: "Quais observações devo revisar?",
      skill: "triage-validation",
      provider: "local",
    });
    expect(response.statusCode).toBe(200);
    expect(advisor).toHaveBeenCalledWith(
      expect.objectContaining({
        observations: ["observation 2", "observation 3", "observation 4"],
      }),
    );
  });
  it("accounts for OpenAI separately and reports an unknown cost as unknown", async () => {
    const p = await program();
    advisor.mockResolvedValueOnce({
      answer: "Falta evidência.",
      sources: [],
      costUsd: null,
      provider: "openai",
      model: "gpt-4.1-mini",
      inputTokens: 100,
      outputTokens: 20,
    } as never);
    const response = await req("POST", `/api/bounty/programs/${p.id}/advice`, {
      question: "Quais evidências ainda faltam?",
      skill: "triage-validation",
      provider: "openai",
    });
    expect(response.statusCode).toBe(200);
    const summary = (await req("GET", "/api/bounty/workspace")).json().summary;
    expect(summary.openaiAdviceCount).toBe(1);
    expect(summary.claudeAdviceCount).toBe(0);
    expect(summary.unpricedAdviceCount).toBe(1);
  });
  it("requires permission before scheduling an active probe", async () => {
    const p = await program();
    const result = await req("POST", `/api/bounty/programs/${p.id}/runs`, {
      tool: "httpx",
      target: complete.target,
    });
    expect(result.statusCode).toBe(409);
    expect((await store.read()).runs).toHaveLength(0);
    expect(runner).not.toHaveBeenCalled();
  });
  it("persists offline classification separately from findings", async () => {
    const p = await program();
    const response = await req("POST", `/api/bounty/programs/${p.id}/runs`, {
      tool: "cbh-classify",
      target: complete.target,
    });
    expect(response.statusCode).toBe(202);
    await vi.waitFor(async () =>
      expect((await store.read()).runs[0].status).toBe("completed"),
    );
    expect((await store.read()).findings).toHaveLength(0);
    expect((await store.read()).runs[0].output).toContain("observation");
  });
  it("gates the injected runner behind current program assessment and refuses stale plan approval", async () => {
    const p = (await req("POST", "/api/bounty/programs", programInput)).json();
    const runBody = { tool: "cbh-classify", target: complete.target };
    expect((await req("POST", `/api/bounty/programs/${p.id}/runs`, runBody)).statusCode).toBe(409);
    expect(runner).not.toHaveBeenCalled(); expect((await store.read()).runs).toHaveLength(0);
    const assessed = (await req("POST", `/api/bounty/programs/${p.id}/assessment`, { target: complete.target, objective: "Review access control with owned test accounts", timeBudgetMinutes: 60, access: "test-accounts", policyReviewed: true, limits: "Own test accounts only." })).json();
    expect((await req("POST", `/api/bounty/programs/${p.id}/assessment/approve`, { assessmentId: assessed.assessment.id })).statusCode).toBe(200);
    await req("PUT", `/api/bounty/programs/${p.id}`, { ...programInput, focus: "A different feature" });
    expect((await req("GET", `/api/bounty/programs/${p.id}/assessment`)).json().approved).toBe(false);
    expect((await req("POST", `/api/bounty/programs/${p.id}/assessment/approve`, { assessmentId: assessed.assessment.id })).statusCode).toBe(409);
    expect((await req("POST", `/api/bounty/programs/${p.id}/runs`, runBody)).statusCode).toBe(409);
  });
  it("does not approve a plan with missing requirements", async () => {
    const p = (await req("POST", "/api/bounty/programs", programInput)).json();
    const assessed = (await req("POST", `/api/bounty/programs/${p.id}/assessment`, { target: "https://api.example.test/admin", objective: "Review permitted public information", timeBudgetMinutes: 60, access: "pending", policyReviewed: false, limits: "" })).json();
    expect(assessed.assessment.blockers).toHaveLength(4);
    expect((await req("POST", `/api/bounty/programs/${p.id}/assessment/approve`, { assessmentId: assessed.assessment.id })).statusCode).toBe(422);
  });
  it("preserves the reviewed report revision and requires new approval after editing or attaching evidence", async () => {
    const p = await program(), f = await ready(p);
    await req("POST", `/api/bounty/findings/${f.id}/status`, { status: "validated" });
    const before = (await req("GET", `/api/bounty/findings/${f.id}/report/preview`)).json();
    await req("PUT", `/api/bounty/findings/${f.id}`, { ...complete, impact: "Updated controlled-test impact." });
    expect((await req("POST", `/api/bounty/findings/${f.id}/report/approve`, { revision: before.revision })).statusCode).toBe(409);
    await req("POST", `/api/bounty/findings/${f.id}/status`, { status: "validated" });
    const current = (await req("GET", `/api/bounty/findings/${f.id}/report/preview`)).json();
    expect((await req("POST", `/api/bounty/findings/${f.id}/report/approve`, { revision: current.revision })).statusCode).toBe(200);
    const approved = (await req("GET", `/api/bounty/findings/${f.id}/report/preview`)).json();
    expect(approved.approved).toBe(true);
    expect(approved.markdown).toBe((await req("GET", `/api/bounty/findings/${f.id}/report?final=true`)).body);
    await req("PUT", `/api/bounty/programs/${p.id}`, { ...programInput, name: "Renamed program" });
    const renamed = (await req("GET", `/api/bounty/findings/${f.id}/report/preview`)).json();
    expect(renamed.approved).toBe(false);
    expect((await req("GET", `/api/bounty/findings/${f.id}/report?final=true`)).statusCode).toBe(409);
    expect((await req("POST", `/api/bounty/findings/${f.id}/report/approve`, { revision: renamed.revision })).statusCode).toBe(200);
    await req("POST", `/api/bounty/findings/${f.id}/evidence`, { title: "Additional observation", kind: "notes", content: "Needs another review" });
    expect((await req("GET", `/api/bounty/findings/${f.id}/report/preview`)).json().approved).toBe(false);
    expect((await req("GET", `/api/bounty/findings/${f.id}/report?final=true`)).statusCode).toBe(422);
  });
  it("turns a completed run into one traceable hypothesis, never a confirmed vulnerability", async () => {
    const p = await program();
    const run = (await req("POST", `/api/bounty/programs/${p.id}/runs`, { tool: "cbh-classify", target: complete.target })).json();
    await vi.waitFor(async () => expect((await store.read()).runs[0].status).toBe("completed"));
    const response = await req("POST", `/api/bounty/runs/${run.id}/finding`, {});
    expect(response.statusCode).toBe(201); const f = response.json();
    expect(f.status).toBe("hypothesis"); expect(f.reproductionConfirmed).toBe(false); expect(f.sourceRunId).toBe(run.id);
    expect((await req("POST", `/api/bounty/runs/${run.id}/finding`, {})).json().id).toBe(f.id);
    const evidence = (await req("GET", `/api/bounty/findings/${f.id}/evidence`)).json();
    expect(evidence).toHaveLength(1); expect(evidence[0].kind).toBe("tool-output");
    expect((await req("GET", `/api/bounty/findings/${f.id}/report/preview`)).json().gaps.join(" ")).toContain("reprodução");
  });
  it("serializes writes and prevents a second workspace writer", async () => {
    await Promise.all(
      Array.from({ length: 15 }, (_, index) =>
        store.mutate((data) =>
          data.advice.push({
            id: String(index),
            programId: "test",
            question: "test",
            answer: "test",
            sources: [],
            costUsd: null,
            createdAt: new Date().toISOString(),
          }),
        ),
      ),
    );
    expect((await store.read()).advice).toHaveLength(15);
    await expect(new BountyStore(directory).init()).rejects.toThrow(
      "Outro processo",
    );
  });
});
