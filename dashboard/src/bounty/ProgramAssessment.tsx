import { useState, type FormEvent } from "react";
import { CheckCircle2, ScanSearch } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAssessment, useRefresh, date } from "./data";
import { ErrorNote, External } from "./shared";
import type { Program } from "./types";

export default function ProgramAssessment({ program }: { program: Program }) {
  const query = useAssessment(program.id), refresh = useRefresh();
  const [busy, setBusy] = useState(""), [error, setError] = useState<unknown>(null);
  const state = query.data, assessment = state?.assessment;
  const initial = program.inScope.find(rule => !rule.includes("*")) || "";
  async function evaluate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("evaluate"); setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await api.post(`/bounty/programs/${program.id}/assessment`, {
        target: form.get("assessmentTarget"), objective: form.get("objective"),
        timeBudgetMinutes: Number(form.get("timeBudgetMinutes")), access: form.get("access"),
        policyReviewed: form.has("policyReviewed"), limits: form.get("limits"),
      });
      await refresh();
    } catch (e) { setError(e); } finally { setBusy(""); }
  }
  async function approve() {
    setBusy("approve"); setError(null);
    try { await api.post(`/bounty/programs/${program.id}/assessment/approve`, { assessmentId: assessment!.id }); await refresh(); }
    catch (e) { setError(e); } finally { setBusy(""); }
  }
  return <section className="b-section b-assessment" id="assessment" aria-label="Avaliação do programa">
    <div className="b-section-head"><h2><ScanSearch size={18} /> Avaliação antes do pentest</h2><span className="b-badge">{state?.approved ? "Plano aprovado" : state?.current ? "Aguardando revisão" : "Avaliação pendente"}</span></div>
    {!program.scopeConfirmed&&<p className="b-notice">Primeiro confirme o escopo no bloco acima. <a href="#scope-review">Ir para Confirmar escopo</a></p>}
    <div className="b-workflow-steps" aria-label="Fluxo da pesquisa"><strong>01 Avaliar programa</strong><span>02 Aprovar plano</span><span>03 Preparar e executar</span><span>04 Revisar relatório</span></div>
    <div className="b-padded"><p className="b-help">Avalie recompensa, escopo, acesso e esforço com os dados cadastrados. Esta etapa não testa o alvo. Informações não verificadas ficam explícitas; a avaliação não prevê lucro.</p><External href={program.url}>Conferir política oficial</External></div>
    <ErrorNote error={error || query.error} />
    {assessment && !state?.current && <p className="b-notice">O cadastro mudou. Gere uma nova avaliação antes de liberar o pentest.</p>}
    <details className="b-assessment-input" open={!assessment || !state?.current || !!assessment.blockers.length || undefined}>
      <summary>{assessment ? "Editar dados e reavaliar" : "Definir investigação inicial"}</summary>
      <form className="b-form" key={`${program.updatedAt}-${assessment?.id || "new"}`} onSubmit={evaluate}>
        <label>Ativo inicial da avaliação<input name="assessmentTarget" type="url" required defaultValue={assessment?.input.target || (initial.startsWith("http") ? initial : initial ? `https://${initial}` : "")} placeholder="https://ativo-no-escopo.example" /></label>
        <label>Objetivo da investigação<textarea name="objective" minLength={10} maxLength={2000} required rows={2} defaultValue={assessment?.input.objective || program.focus} placeholder="Qual fluxo investigar, qual hipótese e qual impacto pretende verificar?" /></label>
        <div className="b-form-grid"><label>Orçamento inicial de tempo (minutos)<input name="timeBudgetMinutes" type="number" min={30} max={4800} step={1} required defaultValue={assessment?.input.timeBudgetMinutes || 120} /></label><label>Acesso necessário<select name="access" aria-label="Acesso necessário" defaultValue={assessment?.input.access || "pending"}><option value="pending">Ainda não definido</option><option value="public">Material público, sem autenticação</option><option value="test-accounts">Minhas contas de teste estão prontas</option></select></label></div>
        <label>Limites e critérios de parada<textarea name="limits" aria-label="Limites e critérios de parada" required minLength={10} maxLength={2000} rows={3} defaultValue={assessment?.input.limits || "Usar somente os ativos e caminhos confirmados. Não seguir redirecionamentos nem testar automaticamente ativos descobertos. Parar se surgir dado de terceiros e revisar o esforço ao atingir o orçamento de tempo."} placeholder="Restrições da política, limites de requisições, testes proibidos e quando interromper." /></label>
        <p className="b-help">Os limites iniciais acima são uma base conservadora do Ghosthunt. Ajuste-os às regras e aos limites de requisições publicados pelo programa.</p>
        <label className="b-check"><input type="checkbox" name="policyReviewed" defaultChecked={program.scopeConfirmed && (assessment?.input.policyReviewed ?? true)} />Revisei a política oficial e a elegibilidade do ativo selecionado</label>
        <button className="b-button" disabled={!!busy||!program.scopeConfirmed}>{busy === "evaluate" ? "Avaliando…" : "Analisar viabilidade"}</button>
      </form>
    </details>
    {assessment && state?.current && <div className="b-assessment-result">
      <div className="b-assessment-verdict"><strong>{assessment.recommendation === "hold" ? "Resolver pendências antes de pesquisar" : assessment.recommendation === "prioritize" ? "Candidato para uma investigação focada" : "Avaliar custo-benefício antes de avançar"}</strong><span>Dados declarados · {date(assessment.createdAt)}</span></div>
      <div className="b-assessment-dimensions">{assessment.dimensions.map(item => <div key={item.label} data-status={item.status}><span>{item.status === "ready" ? "CONFERIDO" : item.status === "blocked" ? "PENDENTE" : "REVISAR"}</span><h3>{item.label}</h3><p>{item.detail}</p></div>)}</div>
      {!!assessment.blockers.length && <div className="b-review-pendencies"><h3>Impedimentos</h3><ul>{assessment.blockers.map(item => <li key={item}>{item}</li>)}</ul></div>}
      <div className="b-review-pendencies"><h3>Incertezas e restrições</h3><ul>{assessment.warnings.map(item => <li key={item}>{item}</li>)}</ul></div>
      <h3>Plano proposto</h3><ol className="b-assessment-plan">{assessment.plan.map(item => <li key={item}>{item}</li>)}</ol>
      {state.approved ? <><p className="b-success"><CheckCircle2 size={16} />Plano aprovado em {date(assessment.approvedAt!)}. Agora você pode preparar o ambiente.</p><Link className="b-button b-secondary" to={`/?program=${program.id}`}>Ir para execução</Link></> : <button className="b-button" disabled={!!busy || !!assessment.blockers.length} onClick={() => void approve()}>{busy === "approve" ? "Aprovando…" : "Aprovar plano e liberar pentest"}</button>}
    </div>}
  </section>;
}
