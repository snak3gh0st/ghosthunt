import { executionEvent } from "./execution.js";
import { investigationPlan, type InvestigationStage } from "./investigation-model.js";
import { requireAssessment } from "./assessment.js";
import { requireScope } from "./scope.js";
import { terminalRedact } from "./terminal.js";
import type { Program } from "./model.js";
import type { ProcessResult } from "./process.js";
export interface InvestigationDependencies {
  run: (tool: string, target: string, program: Program, signal?: AbortSignal) => Promise<ProcessResult>;
  available: (tool: string) => Promise<string | null>;
  advise: (stages: InvestigationStage[], signal?: AbortSignal) => Promise<ProcessResult>;
  references: (stages: InvestigationStage[]) => Promise<ProcessResult>;
}
export function investigationSignals(tool: string, output: string): string[] {
  const lines = output.split("\n").map(line => line.trim()).filter(Boolean);
  if (tool === "repo-review") return lines.filter(line => /:\d+ \[[^\]]+\]/.test(line)).slice(0, 24);
  if (tool === "repo-secrets") return /Gitleaks: [1-9]\d* possíveis/.test(output) ? lines.slice(0, 16) : [];
  if (tool === "repo-semgrep" || tool === "repo-trufflehog") return lines.filter(line=>line.startsWith("{")).slice(0,24);
  if (tool === "nmap") return lines.filter(line => /^\d+\/tcp\s+open\b/.test(line)).map(line => `Serviço exposto, ainda sem falha demonstrada: ${line}`);
  if (["httpx", "dnsx"].includes(tool)) return lines.filter(line => line.startsWith("{")).slice(0, 12);
  if (["subfinder", "urlfinder", "gau"].includes(tool)) return lines.filter(line => /^(https?:\/\/|[a-z0-9_-]+\.[a-z0-9.-]+)/i.test(line)).slice(0, 20).map(line => `Superfície para investigar: ${line}`);
  if (tool.startsWith("burp-")) return lines.filter(line => !/nenhum|nenhuma|no .*found/i.test(line)).slice(0, 10);
  return [];
}
export async function runInvestigation(target: string, program: Program, dependencies: InvestigationDependencies, signal?: AbortSignal): Promise<ProcessResult> {
  requireAssessment(program); requireScope(program, target);
  const stages = investigationPlan(target, program);
  const emit = (stage: InvestigationStage) => executionEvent({ kind: "system", text: `\n[${stage.phase}] ${stage.label}: ${stage.status}${stage.reason ? " · " + stage.reason : ""}\n`, stage: { ...stage } });
  stages.forEach(emit);
  let stopped = "";
  for (const stage of stages) {
    if (stage.status === "skipped") continue;
    if (signal?.aborted || stopped) {
      stage.status = signal?.aborted ? "interrupted" : "blocked"; stage.reason = stopped || "Operação cancelada."; emit(stage); continue;
    }
    try {
      if (!["pentest-prepare", "local-advisor", "metasploit-reference"].includes(stage.tool)) {
        const unavailable = await dependencies.available(stage.tool);
        if (unavailable) { stage.status = "blocked"; stage.reason = unavailable; emit(stage); continue; }
      }
      if (signal?.aborted) { stage.status = "interrupted"; stage.reason = "Operação cancelada."; emit(stage); continue; }
      if (stage.tool === "metasploit-reference" && !stages.some(item => /CVE-\d{4}-\d{4,}/i.test(item.output || ""))) {
        stage.status = "skipped"; stage.reason = "Nenhuma CVE observada para consultar no catálogo. Não executa exploits."; emit(stage); continue;
      }
      stage.status = "running"; stage.startedAt = new Date().toISOString(); emit(stage);
      const result = stage.tool === "local-advisor" ? await dependencies.advise(stages, signal) : stage.tool === "metasploit-reference" ? await dependencies.references(stages) : await dependencies.run(stage.tool, target, program, signal);
      stage.output = terminalRedact(result.output).slice(0, 16000);
      stage.status = signal?.aborted ? "interrupted" : result.code === 0 ? "completed" : "failed";
      stage.signals = stage.status === "completed" ? investigationSignals(stage.tool, stage.output) : [];
      stage.nextStep = stage.signals.length ? "Escolher um sinal, reproduzir em ambiente autorizado e demonstrar impacto. Ainda não é uma vulnerabilidade confirmada." : stage.tool === "local-advisor" ? "Sugestões da IA exigem validação com evidência real." : "Nenhum sinal extraído desta saída. A cobertura continua limitada ao método executado.";
      if (result.code) stage.reason = `Processo terminou com código ${result.code}.`;
      executionEvent({ kind: "stdout", text: `${stage.output}\n` });
      if (stage.tool === "pentest-prepare" && result.code) stopped = "Preparo falhou. Corrija o ambiente antes de continuar.";
    } catch (error) {
      stage.status = signal?.aborted ? "interrupted" : "failed";
      stage.reason = terminalRedact(error instanceof Error ? error.message : "Falha de execução.").slice(0, 1000);
      if (stage.tool === "pentest-prepare") stopped = "Preparo falhou. Nenhuma coleta será iniciada.";
    }
    stage.finishedAt = new Date().toISOString(); emit(stage);
  }
  const completed = stages.filter(stage => stage.status === "completed").length, signals = stages.reduce((n, stage) => n + (stage.signals?.length || 0), 0);
  return { code: signal?.aborted ? 130 : stopped ? 1 : 0, output: `Investigação por etapas concluída: ${completed}/${stages.length} etapas executadas com sucesso; ${signals} observações para revisão.\n${stages.map(stage => `${stage.phase} / ${stage.label}: ${stage.status}${stage.reason ? " — " + stage.reason : ""}`).join("\n")}\n\nObservações não são vulnerabilidades confirmadas. Abra os resultados de cada etapa, documente hipóteses e valide impacto antes de aprovar um relatório.` };
}
