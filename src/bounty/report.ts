import {
  BountyError,
  type Evidence,
  type Finding,
  type Program,
} from "./model.js";
import { inScope } from "./scope.js";
import { createHash } from "node:crypto";
import { findingInput } from "./model.js";

export function reportRevision(finding: Finding, program: Program, evidence: Evidence[]) {
  return createHash("sha256").update(JSON.stringify({ finding: findingInput.parse(finding), program: { id: program.id, name: program.name, url: program.url, scopeVersion: program.scopeVersion, scopeConfirmed: program.scopeConfirmed, inScope: program.inScope, outOfScope: program.outOfScope, policy: program.policy }, evidence: evidence.map(({ id, title, kind, createdAt, sha256, content }) => ({ id, title, kind, createdAt, sha256, contentHash: createHash("sha256").update(content).digest("hex") })) })).digest("hex");
}
export function reportApproved(finding: Finding, program: Program, evidence: Evidence[]) {
  return !!finding.reportApproval && finding.reportApproval.revision === reportRevision(finding, program, evidence);
}

export function reportGaps(
  finding: Finding,
  program: Program,
  evidence: Evidence[],
): string[] {
  const gaps: string[] = [];
  if (!program.scopeConfirmed || !inScope(finding.target, program))
    gaps.push("Confirme que o alvo pertence ao escopo atual.");
  if (finding.scopeVersion !== program.scopeVersion)
    gaps.push("Revalide o achado após a mudança de escopo.");
  if (!finding.reproductionConfirmed)
    gaps.push("Confirme uma reprodução independente com contas de teste.");
  for (const [key, label] of [
    ["summary", "resumo"],
    ["steps", "passos de reprodução"],
    ["expected", "comportamento esperado"],
    ["actual", "comportamento observado"],
    ["impact", "impacto demonstrado"],
  ] as const) {
    if (!finding[key].trim()) gaps.push(`Preencha ${label}.`);
  }
  if (
    !evidence.some(
      (item) =>
        item.kind === "request-response" || item.kind === "reproduction",
    )
  )
    gaps.push("Anexe evidência de requisição/resposta ou de reprodução.");
  return gaps;
}

// Four-backtick fences cannot be closed by the common three-backtick payloads in evidence.
function fenced(value: string): string {
  const longest = Math.max(
    3,
    ...[...value.matchAll(/`+/g)].map((m) => m[0].length),
  );
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${value}\n${fence}`;
}
export function buildReport(
  finding: Finding,
  program: Program,
  evidence: Evidence[],
  final: boolean,
): string {
  const gaps = reportGaps(finding, program, evidence);
  if (final && gaps.length) throw new BountyError(422, gaps.join("\n"));
  if (
    final &&
    (!reportApproved(finding, program, evidence) || !["ready", "submitted", "triaged", "paid", "duplicate", "rejected"].includes(
      finding.status,
    ))
  ) {
    throw new BountyError(
      409,
      "Revise e aprove esta versão do relatório antes de baixar o relatório revisado.",
    );
  }
  return (
    [
      `# ${finding.title.replace(/[\r\n]/g, " ")}`,
      final
        ? "> Reviewed report. Submission remains with the researcher."
        : "> DRAFT: complete and verify all evidence before submission.",
      `Program: ${program.name}\nAsset: ${finding.target}\nCategory: ${finding.category}\nResearcher-assessed severity: ${finding.severity}`,
      `## Summary\n${finding.summary || "[Complete summary]"}`,
      `## Preconditions\n${finding.preconditions || "Describe required accounts, roles and permissions."}`,
      `## Steps to reproduce\n${finding.steps || "[Add numbered, reproducible steps]"}`,
      `## Expected behavior\n${finding.expected || "[Complete expected behavior]"}`,
      `## Observed behavior\n${finding.actual || "[Complete observed behavior]"}`,
      `## Impact\n${finding.impact || "[Describe demonstrated impact, without assuming untested consequences]"}`,
      `## Supporting material\n${evidence.map((item, i) => `### ${i + 1}. ${item.title}\nCaptured: ${item.createdAt}\nSHA-256: ${item.sha256}\n\n${fenced(item.content)}`).join("\n\n") || "[Attach evidence]"}`,
      ...(gaps.length
        ? [
            `## Researcher checklist\n${gaps.map((g) => `- [ ] ${g}`).join("\n")}`,
          ]
        : []),
    ].join("\n\n") + "\n"
  );
}
