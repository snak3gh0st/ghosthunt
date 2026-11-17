import { toolIncompatibility } from "./targets.js";
export interface InvestigationStage {
  id: string; phase: string; tool: string; label: string;
  status: "waiting" | "running" | "completed" | "failed" | "blocked" | "skipped" | "interrupted";
  reason?: string; startedAt?: string; finishedAt?: string; output?: string;
  signals?: string[]; nextStep?: string;
}
export function investigationPlan(target: string, program: { inScope: string[]; automationAllowed: boolean; activeTestingAllowed?: boolean; portScanAllowed?: boolean }): InvestigationStage[] {
  const definitions = [
    ["Ambiente", "ghosthunt-status", "Sessão e escopo atual"],
    ["Ambiente", "ghosthunt-doctor", "Diagnóstico Ghosthunt"],
    ["Ambiente", "ghosthunt-engines", "Inventário das engines"],
    ["Ambiente", "ghosthunt-playbooks", "Playbooks disponíveis"],
    ["Ambiente", "pentest-prepare", "Instalar e verificar Docker, Conda e Burp MCP"],
    ["Classificação", "cbh-classify", "Claude-BugHunter · classificação do alvo"],
    ["Reconhecimento", "subfinder", "Subfinder · subdomínios permitidos"],
    ["Reconhecimento", "urlfinder", "URLFinder · URLs públicas"],
    ["Reconhecimento", "gau", "gau · URLs históricas"],
    ["Código", "repo-review", "Revisão estática do repositório"],
    ["Código", "repo-secrets", "Gitleaks · possíveis segredos"],
    ["Código", "repo-semgrep", "Semgrep · sinais estáticos de vulnerabilidade"],
    ["Código", "repo-trufflehog", "TruffleHog · segredos sem validação online"],
    ["Consultas ativas", "dnsx", "DNSx · resolução do host selecionado"],
    ["Consultas ativas", "httpx", "HTTPx · resposta do ativo selecionado"],
    ["Consultas ativas", "nmap", "Nmap · conexão TCP na porta do ativo"],
    ["Evidências", "burp-history", "Burp MCP · histórico no escopo"],
    ["Evidências", "burp-issues", "Burp MCP · scanner já coletado"],
    ["Análise", "metasploit-reference", "Metasploit · referências para CVEs observadas"],
    ["Análise", "local-advisor", "IA local · hipóteses e lacunas de evidência"],
    ["Resumo", "ghosthunt-report", "Resumo nativo da sessão"],
  ];
  return definitions.map(([phase, tool, label]) => {
    let reason = ["local-advisor", "metasploit-reference"].includes(tool) ? null : toolIncompatibility(tool, target, program.inScope);
    if (!reason && ["httpx", "dnsx", "nmap"].includes(tool) && !program.activeTestingAllowed) reason = "Consultas ativas não autorizadas no cadastro.";
    if (!reason && tool === "nmap" && !program.portScanAllowed) reason = "Varredura de porta TCP não autorizada na política cadastrada.";
    if (!reason && ["subfinder", "urlfinder", "gau", "repo-review", "repo-secrets", "repo-semgrep", "repo-trufflehog", "dnsx", "httpx", "nmap"].includes(tool) && !program.automationAllowed) reason = "Coleta automatizada não autorizada no cadastro.";
    return { id: tool, phase, tool, label, status: reason ? "skipped" : "waiting", ...(reason ? { reason } : {}) };
  });
}
