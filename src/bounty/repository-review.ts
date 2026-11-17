import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BountyError, type Program } from "./model.js";
import { githubRepository } from "./targets.js";
import { inScope, requireScope } from "./scope.js";
import { executionEvent } from "./execution.js";

type Fetcher = typeof fetch;
type TreeEntry = {
  path: string;
  type: string;
  mode: string;
  size?: number;
  sha: string;
};
type Observation = { line: number; category: string; excerpt: string };
export interface ReviewedFile {
  path: string;
  url: string;
  sha256: string;
  bytes: number;
  observations: Observation[];
}
const patterns: [string, RegExp][] = [
  ["Download de conteúdo", /\b(?:curl|wget)\b/],
  ["Operação privilegiada", /\b(?:sudo|pkexec|doas|systemctl)\b/],
  ["Comando dinâmico", /\beval\b|\b(?:bash|sh)\s+-c\b/],
  ["Permissões de arquivos", /\b(?:chmod|chown)\b/],
  [
    "Autenticação ou credenciais",
    /\b(?:password|passwd|authorized_keys|ssh-keygen|token|secret)\b/i,
  ],
  ["Serviço ou interface de rede", /\b(?:listen|bind|firewall|ufw|sshd)\b/i],
];

export function inspectSource(content: string): Observation[] {
  const results: Observation[] = [];
  const counts = new Map<string, number>();
  content.split("\n").forEach((raw, index) => {
    if (results.length >= 6 || raw.trim().startsWith("#") || raw.includes("\0"))
      return;
    for (const [category, pattern] of patterns) {
      if ((counts.get(category) || 0) >= 2 || !pattern.test(raw)) continue;
      counts.set(category, (counts.get(category) || 0) + 1);
      const sensitive =
        /(?:BEGIN .*PRIVATE KEY|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{15,}|\bsk-(?:proj-)?[a-zA-Z0-9_-]{12,})/.test(
          raw,
        );
      results.push({
        line: index + 1,
        category,
        excerpt: sensitive
          ? "[Trecho potencialmente sensível ocultado. Confira a fonte com cuidado.]"
          : raw.trim().slice(0, 240),
      });
      break;
    }
  });
  return results;
}

function sourcePriority(path: string): number {
  if (path === ".github/SECURITY.md" || path === "SECURITY.md") return 100;
  let score =
    /(?:^|\/)(?:[^/]*-)?(?:install|update|security|auth|ssh|network)/i.test(
      path,
    )
      ? 20
      : 0;
  if (/update|sudo|auth|ssh|firewall|credential|secret|download/.test(path))
    score += 15;
  if (path.startsWith("bin/")) score += 15;
  // Production code comes before fixtures and tests with matching keywords.
  if (/(?:^|\/)(?:tests?|fixtures|__tests__)(?:\/|\.)/i.test(path))
    score -= 100;
  return score;
}
export function sourceCandidates(tree: TreeEntry[]): TreeEntry[] {
  return tree
    .filter(
      (item) =>
        item &&
        typeof item.path === "string" &&
        item.type === "blob" &&
        ["100644", "100755"].includes(item.mode) &&
        typeof item.size === "number" &&
        item.size >= 0 &&
        item.size <= 100000 &&
        !item.path.startsWith("/") &&
        !item.path.includes("\\") &&
        !item.path.split("/").some((p) => !p || p === "." || p === "..") &&
        ([".github/SECURITY.md", "SECURITY.md", "README.md"].includes(
          item.path,
        ) ||
          /\.(?:sh|py|rb|js|ts|go|rs|service|conf|ya?ml)$/.test(item.path) ||
          /^(?:bin|install)\/[^.]+$/.test(item.path)),
    )
    .sort(
      (a, b) =>
        sourcePriority(b.path) - sourcePriority(a.path) ||
        a.path.localeCompare(b.path),
    );
}

async function readResponse(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.ok)
    throw new BountyError(
      response.status === 403 || response.status === 429 ? 503 : 502,
      `GitHub respondeu HTTP ${response.status}. ${response.status === 403 || response.status === 429 ? "Limite da fonte atingido; aguarde antes de repetir." : ""}`,
    );
  if (!response.body)
    throw new BountyError(502, "GitHub retornou uma resposta vazia.");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new BountyError(
        502,
        "A resposta da fonte excedeu o limite de coleta.",
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function reviewRepository(
  directory: string,
  target: string,
  program: Program,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
  consumeSources?: (
    files: { path: string; content: string }[],
  ) => Promise<string>,
) {
  requireScope(program, target);
  const repo = githubRepository(target);
  if (!repo)
    throw new BountyError(
      422,
      "Use a URL raiz de um repositório público do GitHub.",
    );
  const overall = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
    : AbortSignal.timeout(120000);
  const get = async (path: string, max = 4_000_000) => {
    executionEvent({
      kind: "system",
      text: `GitHub API: ${repo.fullName}${path ? "/" + path : ""}\n`,
    });
    const response = await fetcher(
      `https://api.github.com/repos/${repo.fullName}${path ? `/${path}` : ""}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Ghosthunt-public-source-review",
        },
        redirect: "error",
        signal: overall,
      },
    );
    return JSON.parse(await readResponse(response, max));
  };
  // Snapshot a stable release when one exists; otherwise pin the public default branch.
  const metadata = await get("");
  if (metadata.private !== false || typeof metadata.default_branch !== "string")
    throw new BountyError(
      422,
      "Esta revisão aceita somente repositórios públicos.",
    );
  let reference = metadata.default_branch as string;
  let release = false;
  const releaseResponse = await fetcher(
    `https://api.github.com/repos/${repo.fullName}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Ghosthunt-public-source-review",
      },
      redirect: "error",
      signal: overall,
    },
  );
  if (releaseResponse.status !== 404) {
    const latest = JSON.parse(await readResponse(releaseResponse, 500000));
    if (typeof latest.tag_name === "string") {
      reference = latest.tag_name;
      release = true;
    }
  }
  const commit = await get(`commits/${encodeURIComponent(reference)}`, 500000);
  const sha = commit.sha as string;
  const treeSha = commit.commit?.tree?.sha as string;
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[a-f0-9]{40}$/.test(treeSha))
    throw new BountyError(502, "Não foi possível fixar o commit da fonte.");
  const snapshot = await get(`git/trees/${treeSha}?recursive=1`);
  if (!Array.isArray(snapshot.tree))
    throw new BountyError(502, "Árvore de arquivos inválida.");
  const candidates = sourceCandidates(snapshot.tree.slice(0, 20000));
  const selected = candidates
    .filter((item) =>
      [
        `${target.replace(/\/$/, "")}/blob/${sha}/${item.path}`,
        `${target.replace(/\/$/, "")}/blob/${encodeURIComponent(reference)}/${item.path}`,
        `${target.replace(/\/$/, "")}/${item.path}`,
      ].every((url) => inScope(url, program)),
    )
    .slice(0, 20);
  if (!selected.length)
    throw new BountyError(
      422,
      "Nenhum arquivo de texto elegível no escopo atual.",
    );
  executionEvent({
    kind: "system",
    text: `Fonte fixada: ${reference} @ ${sha}\nColetando ${selected.length} arquivos de texto.\n`,
  });
  const files: ReviewedFile[] = [];
  const sources: { path: string; content: string }[] = [];
  const warnings: string[] = [];
  for (let index = 0; index < selected.length; index += 3) {
    const batch = await Promise.all(
      selected.slice(index, index + 3).map(async (item) => {
        const sourceURL = `https://raw.githubusercontent.com/${repo.fullName}/${sha}/${item.path.split("/").map(encodeURIComponent).join("/")}`;
        const body = await readResponse(
          await fetcher(sourceURL, {
            redirect: "error",
            signal: overall,
            headers: { "User-Agent": "Ghosthunt-public-source-review" },
          }),
          110000,
        );
        if (body.includes("\0")) return null;
        executionEvent({
          kind: "stdout",
          text: `[source] ${item.path} · ${Buffer.byteLength(body)} bytes\n`,
        });
        if (consumeSources) sources.push({ path: item.path, content: body });
        return {
          path: item.path,
          url: `https://github.com/${repo.fullName}/blob/${sha}/${item.path.split("/").map(encodeURIComponent).join("/")}`,
          sha256: createHash("sha256").update(body).digest("hex"),
          bytes: Buffer.byteLength(body),
          observations: inspectSource(body),
        };
      }),
    );
    files.push(...batch.filter((file): file is ReviewedFile => !!file));
  }
  if (snapshot.truncated) warnings.push("A API retornou uma árvore parcial.");
  if (candidates.length > selected.length)
    warnings.push(
      `Amostra de ${files.length} arquivos entre ${candidates.length} candidatos de texto. Não é uma auditoria completa.`,
    );
  const manifest = {
    type: "public-source-review",
    repository: repo.fullName,
    reference,
    release,
    commit: sha,
    collectedAt: new Date().toISOString(),
    treeEntries: snapshot.tree.length,
    eligibleFiles: candidates.length,
    files,
    warnings,
  };
  const folder = join(directory, "repository-reviews");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const manifestName = `${randomUUID()}.json`;
  await writeFile(
    join(folder, manifestName),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  const observations = files.flatMap((file) =>
    file.observations.map((item) => ({ file, ...item })),
  );
  const extra = consumeSources ? await consumeSources(sources) : "";
  const output = [
    `Revisão estática de código público: ${repo.fullName}`,
    `Versão: ${reference}${release ? " (release)" : " (branch)"} · commit ${sha}`,
    `${files.length} arquivos lidos, ${files.reduce((sum, file) => sum + file.bytes, 0)} bytes. Código do alvo não foi executado.`,
    "Resultado: observações para investigação. Nenhuma vulnerabilidade ou recompensa foi confirmada.",
    "",
    ...(extra ? ["Análise adicional da amostra:", extra, ""] : []),
    "Pontos para revisão manual (presença destes comandos não comprova falha):",
    ...observations
      .slice(0, 24)
      .map(
        (item) =>
          `${item.file.path}:${item.line} [${item.category}] ${item.excerpt}`,
      ),
    ...(observations.length
      ? []
      : ["Nenhum dos padrões de triagem apareceu na amostra."]),
    "",
    ...warnings,
    "",
    "Fontes fixadas e verificáveis:",
    ...files.map((file) => `${file.url}\n  SHA-256 ${file.sha256}`),
    "",
    `Manifesto local: repository-reviews/${manifestName}`,
    "Próximo passo: escolher um componente, entender a fronteira de confiança e reproduzir somente em ambiente próprio/autorizado. Não envie a saída bruta como relatório.",
  ].join("\n");
  return { code: 0, output };
}
