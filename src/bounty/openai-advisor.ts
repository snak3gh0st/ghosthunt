import OpenAI from "openai";
import { BountyError } from "./model.js";

export function openAIStatus() {
  return {
    configured: !!process.env.OPENAI_API_KEY?.trim(),
    model: process.env.GHOSTHUNT_OPENAI_MODEL?.trim() || "gpt-4.1-mini",
  };
}

export async function openAICompletion(system: string, prompt: string) {
  const status = openAIStatus();
  if (!status.configured)
    throw new BountyError(
      503,
      "OpenAI ainda não configurada. A criação segura da chave está pendente. Nenhuma chamada foi feita.",
    );
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: "https://api.openai.com/v1",
    maxRetries: 0,
    timeout: 120000,
  });
  const started = Date.now();
  try {
    const response = await client.responses.create({
      model: status.model,
      instructions: system,
      input: prompt,
      store: false,
      tools: [],
      max_output_tokens: 1500,
    });
    if (
      !response.output_text?.trim() ||
      !["completed", "incomplete"].includes(response.status || "")
    )
      throw new BountyError(
        502,
        "A OpenAI não retornou uma resposta de texto utilizável.",
      );
    return {
      answer: response.output_text,
      provider: "openai" as const,
      model: response.model,
      durationMs: Date.now() - started,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      costUsd: null,
      outputTruncated: response.status === "incomplete",
    };
  } catch (error) {
    if (error instanceof BountyError) throw error;
    // Provider errors may contain credentials or echoed evidence; do not forward them.
    const status = error instanceof OpenAI.APIError ? error.status : undefined;
    throw new BountyError(
      status === 429 ? 429 : 502,
      status === 401
        ? "A OpenAI recusou a credencial configurada."
        : status === 429
          ? "A OpenAI informou limite de uso ou saldo. Confira sua conta."
          : "A consulta à OpenAI não foi concluída. Nenhum outro provedor foi acionado.",
    );
  }
}
