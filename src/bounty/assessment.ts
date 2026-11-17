import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { BountyError, programInput, type Program } from "./model.js";
import { inScope } from "./scope.js";
import { githubRepository } from "./targets.js";

export const assessmentInput = z.object({
  target: z.url().max(2000),
  objective: z.string().trim().min(10).max(2000),
  timeBudgetMinutes: z.number().int().min(30).max(4800),
  access: z.enum(["public", "test-accounts", "pending"]),
  policyReviewed: z.boolean(),
  limits: z.string().trim().max(2000),
});
export interface ProgramAssessment {
  id: string; fingerprint: string; createdAt: string; approvedAt?: string;
  input: z.infer<typeof assessmentInput>;
  recommendation: "prioritize" | "review" | "hold";
  blockers: string[]; warnings: string[];
  dimensions: { label: string; status: "ready" | "review" | "blocked"; detail: string }[];
  plan: string[];
}
export const programFingerprint = (program: Program) => createHash("sha256").update(JSON.stringify({ scopeVersion: program.scopeVersion, ...programInput.parse(program) })).digest("hex");
export function assessmentState(program: Program) {
  const assessment = program.assessment;
  const current = !!assessment && assessment.fingerprint === programFingerprint(program);
  return { assessment: assessment || null, current, approved: current && !!assessment.approvedAt && !assessment.blockers.length };
}
export function requireAssessment(program: Program) {
  if (!assessmentState(program).approved) throw new BountyError(409, "Avalie o programa e aprove o plano atual antes de iniciar o pentest ou executar ferramentas.");
}
export function assessProgram(program: Program, raw: unknown): ProgramAssessment {
  const input = assessmentInput.parse(raw);
  const blockers: string[] = [], warnings: string[] = [];
  const scoped = inScope(input.target, program);
  if (!scoped) blockers.push("O alvo inicial está fora do escopo permitido ou está excluído.");
  if (!program.scopeConfirmed) blockers.push("Confirme os ativos e as exclusões no bloco Escopo do programa.");
  if (!input.policyReviewed) blockers.push("Confirme a revisão da política oficial na avaliação.");
  if (!program.policy.trim()) blockers.push("Registre as regras e restrições da política oficial.");
  if (input.access === "pending") blockers.push("Defina o acesso público ou prepare suas contas de teste.");
  if (!input.limits) blockers.push("Registre os limites de execução e os critérios de parada do programa.");
  if (!program.offersBounties) warnings.push("Recompensa financeira não confirmada. Pode servir para prática, mas não deve entrar como receita prevista.");
  else if (!program.bountyNote.trim()) warnings.push("Faixas de recompensa e elegibilidade deste ativo ainda precisam de comprovação na política oficial.");
  if (!program.automationAllowed) warnings.push("Automação não autorizada no cadastro: as ferramentas de coleta continuam bloqueadas.");
  if (!program.activeTestingAllowed) warnings.push("Consultas ativas continuam bloqueadas; o plano deve respeitar essa restrição.");
  warnings.push("Concorrência, duplicatas, chance de aceitação e valor a receber não foram medidos. Não há estimativa de ganho garantido.");
  const source = !!githubRepository(input.target);
  const plan = [
    `Objetivo: ${input.objective}`,
    `Primeiro ativo: ${input.target}. Respeitar ${program.outOfScope.length} exclusões cadastradas.`,
    source ? "Ler código público em uma versão fixada, sem executar o repositório. Priorizar fluxos de confiança e impacto demonstrável." : "Mapear um fluxo funcional no ativo selecionado, usando apenas técnicas e contas permitidas pela política.",
    `Limites e parada: ${input.limits || "pendentes"}. Revisar o custo-benefício após ${input.timeBudgetMinutes} minutos.`,
    "Registrar hipóteses separadas de achados; validar reprodução, impacto e evidências antes de aprovar qualquer relatório.",
  ];
  return { id: randomUUID(), fingerprint: programFingerprint(program), createdAt: new Date().toISOString(), input,
    recommendation: blockers.length ? "hold" : program.offersBounties && program.automationAllowed ? "prioritize" : "review", blockers, warnings, plan,
    dimensions: [
      { label: "Potencial financeiro", status: program.offersBounties && !!program.bountyNote.trim() ? "ready" : "review", detail: program.offersBounties ? program.bountyNote || "Programa declara bounty; termos financeiros ainda não documentados." : "Sem recompensa financeira confirmada." },
      { label: "Escopo e política", status: scoped && program.scopeConfirmed && input.policyReviewed && !!program.policy.trim() ? "ready" : "blocked", detail: `${program.inScope.length} regras permitidas, ${program.outOfScope.length} exclusões. Fonte: ${program.url}` },
      { label: "Viabilidade de acesso", status: input.access === "pending" ? "blocked" : "ready", detail: input.access === "public" ? "Pesquisa com material público." : input.access === "test-accounts" ? "Contas de teste declaradas pelo pesquisador." : "Acesso ainda pendente." },
      { label: "Método e esforço", status: input.limits ? "ready" : "blocked", detail: `${source ? "Revisão de código" : "Investigação web"}; janela inicial de ${input.timeBudgetMinutes} minutos. Permissões de automação e testes ativos são aplicadas separadamente.` },
    ] };
}
