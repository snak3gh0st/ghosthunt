import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isIP } from "node:net";
import { binaryPath, runProcess, type ProcessResult } from "./process.js";
import { BountyError, type Program } from "./model.js";
import { inScope, requireScope } from "./scope.js";
import { localRuntimes } from "./local-ai.js";
import { toolIncompatibility } from "./targets.js";
import { reviewRepository } from "./repository-review.js";
import { openAIStatus } from "./openai-advisor.js";
import { burpStatus, inspectBurp } from "./burp.js";
import { runExpandedTool } from "./expanded-tools.js";

import { preparePentest, requirePentestPrepared } from "./pentest.js";
import { requireAssessment } from "./assessment.js";
import { runIsolatedTool, isolationStatus, isolationConfig, docker } from "./isolation.js";
import { protectedBinaries, legacyTools } from "./tool-inventory.js";
import { nativeTools, nativeManifest, runNativeTool } from "./native.js";
import { runInvestigation } from "./investigation.js";
import { makeAdvisor } from "./advisor.js";
import { MetasploitCatalog } from "./metasploit.js";

export const repositories = [
  {
    id: "claude-bughunter",
    name: "Claude-BugHunter",
    repository: "elementalsouls/Claude-BugHunter",
    commit: "2f9a226d38d35d28d06f1ed63753799d498a2b3d",
  },
  {
    id: "claude-osint",
    name: "Claude-OSINT",
    repository: "elementalsouls/Claude-OSINT",
    commit: "c359ec1b44d01d324ba98698277e96ccbcd3e890",
  },
];
export const toolDefinitions = [
  ...nativeTools,
  { id: "investigation", name: "Investigar por etapas", mode: "workflow", description: "Executa a sequência de ferramentas compatíveis e autorizadas, com terminal e resultados por etapa." },
  { id: "nmap", name: "Nmap TCP no ativo", mode: "active", description: "Testa conexão TCP somente na porta da URL selecionada, sem scripts de exploração ou detecção agressiva." },
  { id: "repo-semgrep", name: "Semgrep em código público", mode: "source", description: "Aplica regras estáticas locais à amostra fixada; não executa código do alvo." },
  { id: "repo-trufflehog", name: "TruffleHog sem verificação online", mode: "source", description: "Analisa possíveis segredos na amostra; não usa ou valida credenciais encontradas." },
  { id: "pentest-prepare", name: "Preparar pentest", mode: "offline", description: "Instala e confere o ambiente completo para o escopo selecionado, incluindo Burp MCP." },
  {
    id: "repo-secrets",
    name: "Gitleaks em código público",
    mode: "source",
    description:
      "Procura possíveis segredos em uma amostra fixada do repositório, sem usar credenciais encontradas.",
  },
  {
    id: "gau",
    name: "gau",
    mode: "passive",
    description:
      "Coleta URLs conhecidas em fontes públicas e filtra pelo escopo.",
  },
  {
    id: "dnsx",
    name: "DNSx",
    mode: "active",
    description: "Consulta registros A/AAAA de um único host permitido.",
  },
  {
    id: "httpx",
    name: "HTTPx",
    mode: "active",
    description:
      "Consulta uma URL exata, sem seguir redirecionamentos, para observar a resposta HTTP.",
  },
  {
    id: "burp-history",
    name: "Burp MCP: histórico",
    mode: "import",
    description:
      "Lê uma página do histórico HTTP do Burp e filtra registros pelo escopo.",
  },
  {
    id: "burp-issues",
    name: "Burp MCP: scanner",
    mode: "import",
    description:
      "Lê uma página de issues já existentes no Burp Professional, sem iniciar varreduras.",
  },
  {
    id: "repo-review",
    name: "Revisar repositório público",
    mode: "source",
    description:
      "Lê uma amostra do código em um commit fixado e aponta trechos para investigação, sem executá-los.",
  },
  {
    id: "cbh-classify",
    name: "Claude-BugHunter",
    mode: "offline",
    description: "Classifica uma URL e indica as skills para investigar.",
  },
  {
    id: "subfinder",
    name: "Subfinder",
    mode: "passive",
    description: "Consulta fontes públicas para descobrir subdomínios.",
  },
  {
    id: "urlfinder",
    name: "URLFinder",
    mode: "passive",
    description: "Consulta fontes públicas para descobrir URLs.",
  },
] as const;

export async function toolStatus(directory: string) {
  const [isolation, burp, native, runtimes] = await Promise.all([isolationStatus(directory), burpStatus(), nativeManifest(directory), localRuntimes()]);
  let burpCapabilities: string[] = [];
  if (burp.online) {
    try { burpCapabilities = (await inspectBurp(AbortSignal.timeout(3000))).tools.map((tool) => tool.name); } catch {}
  }
  const tools = await Promise.all(
    toolDefinitions.map(async (item) => {
      if (item.id === "investigation") return { ...item, installed: true };
      if (item.id === "pentest-prepare") return { ...item, installed: isolation.dockerReady };
      if (item.id.startsWith("ghosthunt-")) return { ...item, installed: native.available };
      if (item.id.startsWith("burp-"))
        return { ...item, installed: burpCapabilities.includes(item.id === "burp-history" ? "get_proxy_http_history_regex" : "get_scanner_issues"), blockedReason: burp.online && !burpCapabilities.includes(item.id === "burp-history" ? "get_proxy_http_history_regex" : "get_scanner_issues") ? item.id === "burp-issues" && burpCapabilities.length ? "Indisponível nesta edição do Burp. Scanner requer Professional." : "Conexão MCP ainda não confirmada; confira o Burp e suas aprovações de acesso." : null };
      if (item.id === "repo-review") return { ...item, installed: isolation.imageReady, blockedReason: isolation.networkReady ? null : isolation.reason };
      const binaryName = item.id === "cbh-classify" ? "python3" : item.id === "repo-secrets" ? "gitleaks" : item.id === "repo-semgrep" ? "semgrep" : item.id === "repo-trufflehog" ? "trufflehog" : item.id;
      return { ...item, installed: isolation.imageReady && !!isolation.installedTools[binaryName], blockedReason: item.mode === "offline" ? (isolation.imageReady ? null : isolation.reason) : (isolation.networkReady ? null : isolation.reason) };
    }),
  );
  const integrations = await Promise.all(
    repositories.map(async (item) => {
      const folder = join(directory, "integrations", item.id);
      try {
        const head = await runProcess(
          "git",
          ["-C", folder, "rev-parse", "HEAD"],
          { cwd: directory, timeout: 5000 },
        );
        return {
          ...item,
          installed: head.code === 0 && head.output.trim() === item.commit,
        };
      } catch {
        return { ...item, installed: false };
      }
    }),
  );
  const localModels = runtimes.flatMap((runtime) => runtime.models);
  const claudeAvailable = !!(await binaryPath("claude", directory));
  const openai = openAIStatus();
  let metasploitCatalog = false;
  const configuration = await isolationConfig(directory);
  let zapInstalled = false;
  if (/^sha256:[a-f0-9]{64}$/.test(configuration?.zapImageId || "")) {
    const inspected = await docker(["image", "inspect", configuration!.zapImageId!, "--format", "{{.Id}}"], { onStdout:()=>{},onStderr:()=>{},timeout:5000 });
    zapInstalled = inspected.code === 0;
  }
  try {
    await access(join(directory, "catalogs", "metasploit.json"));
    metasploitCatalog = true;
  } catch {}
  return {
    tools,
    isolation,
    native,
    toolkit: { expected: [...protectedBinaries], installed: protectedBinaries.filter(id=>isolation.installedTools[id]), missing: protectedBinaries.filter(id=>!isolation.installedTools[id]), legacy: legacyTools },
    zap: { installed: zapInstalled, mode: "image-only", running: false },
    integrations,
    advisorAvailable:
      claudeAvailable || localModels.length > 0 || openai.configured,
    openai,
    burp: { ...burp, tools: burpCapabilities, verified: burpCapabilities.length > 0 },
    metasploit: {
      catalogInstalled: metasploitCatalog,
      mode: "catalog-only",
      consoleInstalled: !!isolation.installedTools.msfconsole,
    },
    claudeAvailable,
    cloudAdvisorReady: isolation.networkReady,
    localModels,
    localRuntimes: runtimes,
    defaultProvider: "local" as const,
    advisorBudgetUsd: 0.5,
  };
}

export type ToolRunner = (
  tool: string,
  target: string,
  program: Program,
  signal?: AbortSignal,
) => Promise<ProcessResult>;
export function validateToolRequest(
  tool: string,
  target: string,
  program: Program,
): void {
  if (!toolDefinitions.some((item) => item.id === tool))
    throw new BountyError(400, "Ferramenta não suportada.");
  if (tool === "pentest-prepare") { if (!program.scopeConfirmed) throw new BountyError(409, "Confirme o escopo do programa."); return; }
  requireScope(program, target);
  if (tool === "investigation") return;
  const reason = toolIncompatibility(tool, target, program.inScope);
  if (reason) throw new BountyError(422, reason);
  if (["httpx", "dnsx", "nmap"].includes(tool) && !program.activeTestingAllowed)
    throw new BountyError(
      409,
      "Confirme a permissão para consultas ativas nas regras do programa.",
    );
  if (tool === "nmap" && !program.portScanAllowed) throw new BountyError(409, "Confirme a permissão para conexão TCP na porta do ativo nas regras do programa.");
  if (
    !nativeTools.some((item) => item.id === tool) &&
    tool !== "cbh-classify" &&
    !tool.startsWith("burp-") &&
    !program.automationAllowed
  )
    throw new BountyError(
      409,
      "Confirme que o programa permite a coleta automatizada que será utilizada.",
    );
}
export function makeToolRunner(directory: string): ToolRunner {
  return async (tool, target, program, signal) => {
    validateToolRequest(tool, target, program);
    if (!tool.startsWith("ghosthunt-")) requireAssessment(program);
    if (tool === "investigation") {
      let available: Awaited<ReturnType<typeof toolStatus>> | undefined;
      const stepRunner = makeToolRunner(directory);
      return runInvestigation(target, program, {
      run: async (id, currentTarget, currentProgram, currentSignal) => { const result = await stepRunner(id, currentTarget, currentProgram, currentSignal); if (id === "pentest-prepare") available = undefined; return result; },
      available: async id => { const status = available ||= await toolStatus(directory); const tool = status.tools.find(item => item.id === id); return !tool?.installed ? `Ferramenta indisponível: ${id}. Confira o preparo ou a edição do Burp.` : "blockedReason" in tool ? tool.blockedReason || null : null; },
      advise: async (stages, currentSignal) => {
        const answer = await makeAdvisor(directory)({ program, provider: "local", skill: "triage-validation", signal: currentSignal, evidence: [], question: "Analise apenas as observações fornecidas desta investigação. Separe sinais concretos, hipóteses, possíveis falsos positivos e evidência que falta para um relatório HackerOne. Não afirme vulnerabilidade nem recompensa. Sugira os próximos passos permitidos pela política, sem executar nada. Responda em português, em até 400 palavras.", observations: stages.filter(stage => stage.status === "completed" && stage.output).map(stage => `${stage.label}: ${stage.output!.slice(0, 800)}`).slice(-8) });
        return { code: 0, output: `IA local · ${answer.model || "modelo local"} · custo de API $0\n${answer.answer}` };
      },
      references: async stages => { const ids = [...new Set(stages.flatMap(stage => (stage.output || "").match(/CVE-\d{4}-\d{4,}/gi) || []))].slice(0, 3); const catalog = new MetasploitCatalog(directory); const results = []; for (const id of ids) results.push(await catalog.search(id, 0)); return { code: 0, output: "Referências de catálogo; nenhum exploit foi executado.\n" + JSON.stringify(results, null, 2).slice(0, 12000) }; },
    }, signal);
    }
    if (tool === "pentest-prepare") return preparePentest(directory, program, signal);
    if (tool.startsWith("ghosthunt-") || tool.startsWith("burp-"))
      return makeInProcessToolRunner(directory)(tool, target, program, signal);
    await requirePentestPrepared(directory, program);
    return runIsolatedTool(directory, tool, target, program, signal);
  };
}
export function makeInProcessToolRunner(directory: string): ToolRunner {
  return async (tool, target, program, signal) => {
    validateToolRequest(tool, target, program);
    const native = await runNativeTool(directory, tool, program, signal);
    if (native) return native;
    const expanded = await runExpandedTool(
      directory,
      tool,
      target,
      program,
      signal,
    );
    if (expanded) return expanded;
    if (tool === "repo-review")
      return reviewRepository(directory, target, program, signal);
    const url = new URL(target);
    const host = url.hostname.replace(/\.$/, "");
    if (
      tool !== "cbh-classify" &&
      (isIP(host) || !host.includes(".") || host.endsWith(".localhost"))
    )
      throw new BountyError(422, "Use um domínio público do escopo.");
    const binary = await binaryPath(
      tool === "cbh-classify" ? "python3" : tool,
      directory,
    );
    if (!binary)
      throw new BountyError(
        503,
        "Ferramenta não instalada. Execute npm run web:setup -- --tools.",
      );
    let args: string[];
    if (tool === "cbh-classify")
      args = [
        join(
          directory,
          "integrations",
          "claude-bughunter",
          "scripts",
          "cbh.py",
        ),
        "classify",
        target,
      ];
    else if (tool === "subfinder")
      args = ["-d", host, "-silent", "-timeout", "10", "-max-time", "1"];
    else args = ["-d", host, "-silent"];
    const result = await runProcess(binary, args, {
      cwd: directory,
      timeout: 90000,
      signal,
    });
    if (tool === "cbh-classify") {
      if (
        result.code === 1 &&
        !result.stderr?.trim() &&
        result.output.includes("No high-confidence matches.")
      )
        return {
          ...result,
          code: 0,
          output:
            result.output +
            "\nClassificação concluída: nenhum padrão de URL de alta confiança. Isso não é uma falha de execução nem prova ausência de vulnerabilidades.",
        };
      return {
        ...result,
        output:
          result.output +
          (result.stderr?.trim()
            ? `\nDiagnóstico: ${result.stderr.trim()}`
            : ""),
      };
    }
    // Keep only current-scope observations. A discovery is never automatically a finding.
    const lines = result.output
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          inScope(line.includes("://") ? line : `https://${line}`, program),
      );
    return {
      code: result.code,
      output:
        (result.code && result.stderr?.trim()
          ? `Diagnóstico: ${result.stderr.trim()}\n`
          : "") +
        ([...new Set(lines)].join("\n") ||
          "Nenhuma observação no escopo retornada."),
    };
  };
}

const skillNames = [
  "hunt-idor",
  "hunt-auth-bypass",
  "hunt-business-logic",
  "hunt-xss",
  "hunt-ssrf",
  "hunt-graphql",
  "hunt-oauth",
  "hunt-source-leak",
  "triage-validation",
  "report-writing",
  "osint-methodology",
] as const;
export async function knowledge(
  directory: string,
  skill: string,
  maxCharsPerSkill = 16000,
): Promise<{ content: string; sources: string[]; truncated: boolean }> {
  if (!skillNames.includes(skill as (typeof skillNames)[number]))
    throw new BountyError(400, "Skill não suportada.");
  const sources: string[] = [];
  const parts: string[] = [];
  let truncated = false;
  for (const name of [...new Set([skill, "triage-validation"])]) {
    const relative = `skills/${name}/SKILL.md`;
    const repo =
      name === "osint-methodology" ? repositories[1] : repositories[0];
    try {
      const content = await readFile(
        join(directory, "integrations", repo.id, relative),
        "utf8",
      );
      truncated ||= content.length > maxCharsPerSkill;
      parts.push(content.slice(0, maxCharsPerSkill));
      sources.push(
        `https://github.com/${repo.repository}/blob/${repo.commit}/${relative}`,
      );
    } catch {
      throw new BountyError(
        503,
        "Conhecimento não instalado. Execute npm run web:setup.",
      );
    }
  }
  return { content: parts.join("\n\n"), sources, truncated };
}

export const supportedSkills = skillNames;
