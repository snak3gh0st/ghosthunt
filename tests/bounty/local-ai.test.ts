import { afterEach, describe, expect, it, vi } from "vitest";
import { localCompletion, localRuntimes } from "../../src/bounty/local-ai.js";
import { makeAdvisor } from "../../src/bounty/advisor.js";
import type { AdviceRequest } from "../../src/bounty/advisor.js";

const { cloudCall } = vi.hoisted(() => ({ cloudCall: vi.fn() }));
vi.mock("../../src/bounty/process.js", () => ({
  binaryPath: vi.fn().mockResolvedValue("/fake/claude"),
  runProcess: cloudCall,
}));
vi.mock("../../src/bounty/tools.js", () => ({
  knowledge: vi.fn().mockResolvedValue({
    content: "Use only demonstrated evidence.",
    sources: ["https://example.test/reference"],
    truncated: false,
  }),
}));
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const model = {
  id: "ollama:ghosthunt-local:q4",
  backend: "ollama" as const,
  model: "ghosthunt-local:q4",
};
const request: AdviceRequest = {
  program: {
    id: "p",
    name: "Lab",
    url: "https://hackerone.com/example",
    offersBounties: true,
    bountyNote: "",
    inScope: ["api.example.test"],
    outOfScope: [],
    policy: "Use test accounts only.",
    focus: "Access control",
    automationAllowed: false,
    scopeConfirmed: true,
    scopeVersion: 1,
    createdAt: "2026-11-16",
    updatedAt: "2026-11-16",
  },
  question: "Do two 403 responses prove an IDOR?",
  skill: "hunt-idor",
  provider: "local",
  localModel: model.id,
  evidence: [
    {
      id: "e",
      findingId: "f",
      title: "Comparison",
      kind: "request-response",
      content:
        "Authorization: Bearer private-secret\nCookie: session=private\nHTTP/1.1 403 Forbidden",
      sha256: "hash",
      createdAt: "2026-11-16",
    },
  ],
  observations: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("local model discovery", () => {
  it("finds local chat models and excludes cloud and embedding entries", async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) =>
      url.includes("11434")
        ? reply({
            models: [
              { name: "ghosthunt-local:q4" },
              { name: "other:cloud" },
              { name: "alias", remote_host: "https://cloud.example.test" },
              { name: "nomic-embed-text" },
            ],
          })
        : reply({ data: [{ id: "local-qwen" }] }),
    );
    const runtimes = await localRuntimes(fetcher as typeof fetch);
    expect(runtimes[0].models).toEqual([model]);
    expect(runtimes[1].models[0].backend).toBe("lmstudio");
    expect(
      fetcher.mock.calls.every(([url]) =>
        String(url).startsWith("http://127.0.0.1:"),
      ),
    ).toBe(true);
  });
  it("reports an unavailable runtime without starting or loading it", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("offline"));
    const runtimes = await localRuntimes(fetcher);
    expect(runtimes.every((r) => !r.online && !r.models.length)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
describe("local completions", () => {
  it("uses bounded Ollama inference without tools and unloads after completion", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply({}))
      .mockResolvedValueOnce(
        reply({
          message: { content: "Não confirmado." },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 140,
          eval_count: 15,
        }),
      );
    const result = await localCompletion(model, "system", "context", fetcher);
    expect(result.provider).toBe("local");
    expect(result.costUsd).toBe(0);
    expect(result.outputTokens).toBe(15);
    const body = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(body.keep_alive).toBe(0);
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.tools).toBeUndefined();
    expect(body.options.num_ctx).toBe(8192);
  });
  it("rejects a cloud-backed alias before sending the prompt", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      reply({
        remote_host: "https://cloud.example.test",
        remote_model: "external",
      }),
    );
    await expect(
      localCompletion(model, "private", "context", fetcher),
    ).rejects.toThrow("remotamente");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("supports the local LM Studio chat endpoint and strips thinking blocks", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      reply({
        choices: [
          {
            message: { content: "<think>internal</think>Resposta final." },
            finish_reason: "length",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      }),
    );
    const result = await localCompletion(
      { id: "lmstudio:qwen", backend: "lmstudio", model: "qwen" },
      "system",
      "context",
      fetcher,
    );
    expect(result.answer).toBe("Resposta final.");
    expect(result.outputTruncated).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe(
      "http://127.0.0.1:1234/v1/chat/completions",
    );
  });
  it("surfaces local inference failure instead of inventing an answer", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply({}))
      .mockResolvedValueOnce(reply({ error: "insufficient memory" }, 500));
    await expect(
      localCompletion(model, "system", "context", fetcher),
    ).rejects.toThrow("Nenhuma chamada ao Claude");
  });
});
describe("advisor provider boundary", () => {
  it("uses local inference and redacts nested evidence before JSON serialization", async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/api/tags"))
        return reply({ models: [{ name: model.model }] });
      if (url.endsWith("/v1/models")) throw new TypeError("offline");
      if (url.endsWith("/api/show")) return reply({});
      return reply({
        message: { content: "As respostas 403 não demonstram a falha." },
        done: true,
        done_reason: "stop",
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await makeAdvisor("/tmp")(request);
    expect(result.provider).toBe("local");
    expect(cloudCall).not.toHaveBeenCalled();
    const chat = fetcher.mock.calls.find(([url]) => url.endsWith("/api/chat"));
    const body = JSON.parse(chat![1].body);
    expect(body.messages[1].content).not.toContain("private-secret");
    expect(body.messages[1].content).not.toContain("session=private");
    expect(body.messages[1].content).toContain("403 Forbidden");
  });
  it("never falls back to Claude for a failed local selection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(makeAdvisor("/tmp")(request)).rejects.toThrow(
      "Nenhuma chamada ao Claude",
    );
    expect(cloudCall).not.toHaveBeenCalled();
  });
  it("blocks cloud advisor calls until protected forwarding is available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(makeAdvisor("/tmp")({ ...request, provider: "claude", localModel: undefined })).rejects.toThrow("rede protegida");
    expect(cloudCall).not.toHaveBeenCalled();
  });
  it("does not spend API when a client omits the provider and the local runtime is offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(
      makeAdvisor("/tmp")({ ...request, provider: undefined }),
    ).rejects.toThrow("Nenhuma chamada ao Claude");
    expect(cloudCall).not.toHaveBeenCalled();
  });
});
