import { BountyError } from "./model.js";

export interface LocalModel {
  id: string;
  backend: "ollama" | "lmstudio";
  model: string;
}
export interface LocalRuntime {
  backend: "ollama" | "lmstudio";
  online: boolean;
  models: LocalModel[];
}
type Fetcher = typeof fetch;
const endpoints = {
  ollama: "http://127.0.0.1:11434",
  lmstudio: "http://127.0.0.1:1234",
} as const;

async function requestJson(
  url: string,
  init: RequestInit,
  timeout: number,
  fetcher: Fetcher,
): Promise<Record<string, unknown>> {
  const response = await fetcher(url, {
    ...init,
    redirect: "error",
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error("Resposta vazia");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new Error("Resposta excedeu o limite");
    }
    chunks.push(value);
  }
  const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("Formato inválido");
  return result as Record<string, unknown>;
}

function localOnly(item: Record<string, unknown>, name: string): boolean {
  return (
    !item.remote_host &&
    !item.remote_model &&
    !/(?:[:\/-])cloud(?:$|[:\/-])/i.test(name)
  );
}

/** Discovery never loads a model and never contacts an external provider. */
export async function localRuntimes(
  fetcher: Fetcher = fetch,
): Promise<LocalRuntime[]> {
  return Promise.all(
    (["ollama", "lmstudio"] as const).map(async (backend) => {
      try {
        const data = await requestJson(
          `${endpoints[backend]}${backend === "ollama" ? "/api/tags" : "/v1/models"}`,
          {},
          1500,
          fetcher,
        );
        const entries = backend === "ollama" ? data.models : data.data;
        if (!Array.isArray(entries))
          throw new Error("Lista de modelos inválida");
        const models: LocalModel[] = [];
        for (const item of entries.slice(0, 100)) {
          if (!item || typeof item !== "object") continue;
          const name = backend === "ollama" ? item.name : item.id;
          if (
            typeof name !== "string" ||
            !name ||
            name.length > 200 ||
            !localOnly(item, name)
          )
            continue;
          if (
            (Array.isArray(item.capabilities) &&
              !item.capabilities.includes("completion")) ||
            /embedding|nomic-embed|bge-/i.test(name)
          )
            continue;
          models.push({ id: `${backend}:${name}`, backend, model: name });
        }
        models.sort(
          (a, b) =>
            Number(b.model === "ghosthunt-local:q4") -
              Number(a.model === "ghosthunt-local:q4") ||
            a.model.localeCompare(b.model),
        );
        return { backend, online: true, models };
      } catch {
        return { backend, online: false, models: [] };
      }
    }),
  );
}

export async function localCompletion(
  model: LocalModel,
  system: string,
  prompt: string,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
) {
  const started = Date.now();
  try {
    if (model.backend === "ollama") {
      const metadata = await requestJson(
        `${endpoints.ollama}/api/show`,
        {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: model.model }),
        },
        10000,
        fetcher,
      );
      if (!localOnly(metadata, model.model))
        throw new Error(
          "Modelo hospedado remotamente não é permitido no modo local.",
        );
    }
    const messages = [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ];
    const body =
      model.backend === "ollama"
        ? {
            model: model.model,
            messages,
            stream: false,
            think: false,
            keep_alive: 0,
            options: { num_ctx: 8192, num_predict: 900, temperature: 0.2 },
          }
        : {
            model: model.model,
            messages,
            stream: false,
            max_tokens: 900,
            temperature: 0.2,
          };
    const data = await requestJson(
      `${endpoints[model.backend]}${model.backend === "ollama" ? "/api/chat" : "/v1/chat/completions"}`,
      {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      120000,
      fetcher,
    );
    const message = data.message as { content?: unknown } | undefined;
    const choice = (
      data.choices as
        | { message?: { content?: unknown }; finish_reason?: string }[]
        | undefined
    )?.[0];
    const raw =
      model.backend === "ollama" ? message?.content : choice?.message?.content;
    const answer =
      typeof raw === "string"
        ? raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
        : "";
    if (!answer)
      throw new Error("O modelo não retornou uma resposta utilizável.");
    const usage = data.usage as
      | { prompt_tokens?: number; completion_tokens?: number }
      | undefined;
    return {
      answer,
      provider: "local" as const,
      model: model.model,
      localBackend: model.backend,
      costUsd: 0,
      durationMs: Date.now() - started,
      inputTokens:
        typeof data.prompt_eval_count === "number"
          ? data.prompt_eval_count
          : usage?.prompt_tokens,
      outputTokens:
        typeof data.eval_count === "number"
          ? data.eval_count
          : usage?.completion_tokens,
      outputTruncated:
        data.done_reason === "length" || choice?.finish_reason === "length",
    };
  } catch (error) {
    throw new BountyError(
      503,
      `O modelo local não concluiu a consulta: ${(error as Error).message}. Nenhuma chamada ao Claude foi feita. Você pode tentar novamente ou escolher Claude explicitamente.`,
    );
  }
}
