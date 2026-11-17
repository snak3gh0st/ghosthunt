import { afterEach, expect, it, vi } from "vitest";
import {
  openAICompletion,
  openAIStatus,
} from "../../src/bounty/openai-advisor.js";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("does not call an API when the credential is pending", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(openAIStatus().configured).toBe(false);
  await expect(openAICompletion("instructions", "question")).rejects.toThrow(
    "pendente",
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it("uses Responses without storage or tools and records tokens without inventing cost", async () => {
  vi.stubEnv("OPENAI_API_KEY", "sk-proj-test-only-not-a-real-api-key");
  vi.stubEnv("OPENAI_BASE_URL", "https://wrong-host.invalid");
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_lab",
          object: "response",
          status: "completed",
          model: "gpt-4.1-mini",
          output: [
            {
              id: "msg_lab",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: "Ainda falta evidência.",
                  annotations: [],
                },
              ],
            },
          ],
          usage: { input_tokens: 123, output_tokens: 15, total_tokens: 138 },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const result = await openAICompletion("system", "prompt");
  const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toBe("https://api.openai.com/v1/responses");
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({
    store: false,
    tools: [],
    max_output_tokens: 1500,
    input: "prompt",
    instructions: "system",
  });
  expect(result).toMatchObject({
    provider: "openai",
    costUsd: null,
    inputTokens: 123,
    outputTokens: 15,
    answer: "Ainda falta evidência.",
  });
});
it("does not expose provider error bodies or retry a failed billable request", async () => {
  vi.stubEnv("OPENAI_API_KEY", "sk-proj-test-only-not-a-real-api-key");
  const fetcher = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "private evidence and secret",
              type: "invalid_request_error",
            },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(openAICompletion("system", "prompt")).rejects.toThrow("recusou");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
