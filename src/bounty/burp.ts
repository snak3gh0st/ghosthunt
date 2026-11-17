import {
  Client,
  StreamableHTTPClientTransport,
  SSEClientTransport,
} from "@modelcontextprotocol/client";
import { createConnection } from "node:net";
import { BountyError, type Program } from "./model.js";
import { inScope, requireScope } from "./scope.js";
import { executionEvent } from "./execution.js";

export const burpReadTools = [
  "get_proxy_http_history_regex",
  "get_scanner_issues",
] as const;
export function burpURL() {
  let url: URL;
  try {
    url = new URL(
      process.env.GHOSTHUNT_BURP_MCP_URL || "http://127.0.0.1:9876/mcp",
    );
  } catch {
    throw new BountyError(422, "Endereço local do Burp MCP inválido.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/mcp"].includes(url.pathname)
  )
    throw new BountyError(
      422,
      "Burp MCP deve usar HTTP local em 127.0.0.1 ou localhost, caminho /mcp ou /.",
    );
  // Canonicalize localhost so DNS cannot change a local service into an external destination.
  url.hostname = "127.0.0.1";
  return url;
}
export async function burpStatus() {
  try {
    const url = burpURL();
    const online = await new Promise<boolean>((resolve) => {
      const socket = createConnection({
        host: "127.0.0.1",
        port: Number(url.port || 80),
      });
      const finish = (value: boolean) => {
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(400, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    });
    return { url: url.href, online, mode: "read-only", tools: burpReadTools };
  } catch {
    return {
      url: null,
      online: false,
      mode: "read-only",
      tools: burpReadTools,
    };
  }
}
export async function withBurp<T>(
  operation: (client: Client) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const url = burpURL();
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
    : AbortSignal.timeout(45000);
  // Even discovery/OAuth/legacy endpoint messages must stay on this exact loopback origin.
  const localFetch: typeof fetch = (input, init) => {
    const requested = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (requested.origin !== url.origin)
      throw new BountyError(
        422,
        "O Burp MCP tentou sair da origem local configurada.",
      );
    return fetch(input, {
      ...init,
      redirect: "error",
      signal: init?.signal
        ? AbortSignal.any([deadline, init.signal])
        : deadline,
    });
  };
  const client = new Client(
    { name: "ghosthunt-burp-reader", version: "1.0.0" },
    { capabilities: {} },
  );
  const transport =
    url.pathname === "/mcp"
      ? new StreamableHTTPClientTransport(url, {
          fetch: localFetch,
          requestInit: { redirect: "error" },
        })
      : new SSEClientTransport(url, {
          fetch: localFetch,
          requestInit: { redirect: "error" },
        });
  const abort = () => {
    void client.close().catch(() => {});
  };
  deadline.addEventListener("abort", abort, { once: true });
  try {
    executionEvent({
      kind: "system",
      text: `Conectando ao Burp MCP: ${url.href}\n`,
    });
    await client.connect(transport);
    return await operation(client);
  } catch (error) {
    if (error instanceof BountyError) throw error;
    throw new BountyError(
      503,
      deadline.aborted
        ? "A leitura do Burp MCP foi cancelada ou excedeu o prazo. Confira também pedidos de aprovação no Burp."
        : "Não foi possível ler o Burp MCP. Inicie o Burp, habilite a extensão MCP e confira as aprovações de acesso.",
    );
  } finally {
    deadline.removeEventListener("abort", abort);
    await client.close().catch(() => {});
  }
}
export async function inspectBurp(signal?: AbortSignal) {
  return withBurp(async (client) => {
    const tools = await client.listTools();
    return {
      connected: true,
      tools: tools.tools
        .filter((t) =>
          burpReadTools.includes(t.name as (typeof burpReadTools)[number]),
        )
        .map((t) => ({ name: t.name, description: t.description })),
      mode: "read-only",
    };
  }, signal);
}

// Keep credentials out of stored/imported HTTP messages, including JSON bodies.
export function redactBurp(value: string) {
  return value
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
export function parseBurpItems(
  content: unknown,
  target: string,
  program: Program,
) {
  const blocks = Array.isArray(content) ? content : [];
  const records: Record<string, unknown>[] = [];
  for (const block of blocks) {
    if (!block || block.type !== "text" || typeof block.text !== "string")
      continue;
    if (/access denied|approval.*denied/i.test(block.text))
      throw new BountyError(
        409,
        "A leitura foi negada pelo Burp. Aprove o acesso na extensão para importar os dados.",
      );
    if (block.text.length > 1_000_000)
      throw new BountyError(413, "Página do Burp excedeu o limite de leitura.");
    const chunks = block.text.split(/\r?\n\r?\n/);
    for (const chunk of chunks.slice(0, 100)) {
      try {
        const parsed = JSON.parse(chunk);
        for (const item of Array.isArray(parsed) ? parsed : [parsed])
          if (item && typeof item === "object") records.push(item);
      } catch {
        /* Status messages are not evidence. */
      }
    }
  }
  const permitted: {
    target: string;
    request?: string;
    response?: string;
    name?: string;
    detail?: string;
    sourceSeverity?: string;
  }[] = [];
  let skipped = 0;
  for (const item of records.slice(0, 100)) {
    let urls: string[] = [];
    const request = typeof item.request === "string" ? item.request : "";
    const service = item.httpService as
      | { host?: string; port?: number; secure?: boolean }
      | undefined;
    if (typeof item.baseUrl === "string") urls = [item.baseUrl];
    else if (request) {
      const path = /^\S+\s+(\S+)\s+HTTP\/[\d.]+/.exec(request)?.[1];
      const host = /^host:\s*([^\s]+)\s*$/im.exec(request)?.[1];
      if (path?.startsWith("http://") || path?.startsWith("https://"))
        urls = [path];
      else if (
        path?.startsWith("/") &&
        service?.host &&
        typeof service.secure === "boolean"
      )
        urls = [
          `${service.secure ? "https" : "http"}://${service.host}${service.port ? `:${service.port}` : ""}${path}`,
        ];
      else if (path?.startsWith("/") && host)
        urls = [`http://${host}${path}`, `https://${host}${path}`];
    }
    // Old Burp history omits TLS metadata. Accept it only when both possible origins are in scope.
    const chosen = urls.find((raw) => {
      try {
        return new URL(raw).origin === new URL(target).origin;
      } catch {
        return false;
      }
    });
    if (
      !chosen ||
      !urls.every((url) => inScope(url, program)) ||
      new URL(chosen).username ||
      new URL(chosen).password
    ) {
      skipped++;
      continue;
    }
    permitted.push({
      target: redactBurp(chosen),
      ...(request
        ? {
            request: redactBurp(request).slice(0, 16000),
            response: redactBurp(
              typeof item.response === "string" ? item.response : "",
            ).slice(0, 16000),
          }
        : {}),
      ...(typeof item.name === "string"
        ? {
            name: item.name.slice(0, 300),
            detail: redactBurp(
              typeof item.detail === "string" ? item.detail : "",
            ).slice(0, 6000),
            sourceSeverity: String(item.severity || ""),
          }
        : {}),
    });
  }
  return { items: permitted, skipped, received: records.length };
}
export async function readBurp(
  tool: "burp-history" | "burp-issues",
  target: string,
  program: Program,
  signal?: AbortSignal,
) {
  requireScope(program, target);
  const name =
    tool === "burp-history"
      ? "get_proxy_http_history_regex"
      : "get_scanner_issues";
  return withBurp(async (client) => {
    const list = await client.listTools();
    if (!list.tools.some((t) => t.name === name))
      throw new BountyError(
        503,
        "Esta ferramenta de leitura não está disponível na edição/extensão do Burp conectada.",
      );
    const host = new URL(target).host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    executionEvent({
      kind: "system",
      text: `Burp MCP: ${name} · leitura de até 20 registros\n`,
    });
    const response = await client.callTool({
      name,
      arguments: {
        count: 20,
        offset: 0,
        ...(tool === "burp-history"
          ? { regex: `(?im)^Host:\\s*${host}\\s*$` }
          : {}),
      },
    });
    if (response.isError)
      throw new BountyError(
        502,
        "O Burp informou erro ao ler os dados. Confira a extensão e suas aprovações.",
      );
    const result = parseBurpItems(response.content, target, program);
    return {
      code: 0,
      output: [
        `Burp MCP · ${name} · página inicial de até 20 registros`,
        `${result.items.length} observações no escopo; ${result.skipped} registros ignorados por origem, caminho ou metadados insuficientes.`,
        "Histórico sem protocolo explícito exige escopo que permita HTTP e HTTPS. Nenhuma requisição ao alvo foi enviada pelo Ghosthunt. Resultados do scanner ainda exigem validação.",
        ...result.items.map((item) => JSON.stringify(item, null, 2)),
      ].join("\n\n"),
    };
  }, signal);
}
