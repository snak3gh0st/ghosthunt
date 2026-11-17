import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Play, TerminalSquare, Square } from "lucide-react";
import { investigationPlan } from "../../../src/bounty/investigation-model";
import { api } from "../lib/api";
import { useAssessment, useWorkspace, useRefresh } from "./data";
import { useConsole } from "./console-context";
import { ErrorNote } from "./shared";
import type { Program, Finding } from "./types";
const labels: Record<string,string> = { waiting: "Na fila", running: "Executando", completed: "Concluída", failed: "Falhou", blocked: "Bloqueada", skipped: "Não executada", interrupted: "Interrompida" };
export default function InvestigationPanel({ program, target }: { program: Program; target: string }) {
  const workspace = useWorkspace(), assessment = useAssessment(program.id), console = useConsole(), refresh = useRefresh(), navigate = useNavigate();
  const [error,setError] = useState<unknown>(null), [busy,setBusy] = useState("");
  const run = workspace.data?.runs.find(run => run.programId === program.id && run.tool === "investigation" && run.target === target);
  const stages = run?.stages || investigationPlan(target, program);
  const completed = stages.filter(stage => stage.status === "completed").length;
  const active = stages.find(stage => stage.status === "running");
  const signals = stages.reduce((n,stage) => n+(stage.signals?.length || 0),0);
  async function start() { setError(null); try { await console.launch(program.id,"investigation",target); } catch(e){setError(e);} }
  async function cancel() { if(!run)return;setBusy("cancel");try{await api.post(`/bounty/runs/${run.id}/cancel`,{});await refresh();}catch(e){setError(e);}finally{setBusy("");} }
  async function document(stageId: string) { if(!run)return;setBusy(stageId);try{const finding=await api.post<Finding>(`/bounty/runs/${run.id}/finding`,{stageId});await refresh();navigate(`/findings/${finding.id}?tab=edit`);}catch(e){setError(e);}finally{setBusy("");} }
  return <section className="b-investigation-panel" aria-label="Investigação por etapas">
    <div className="b-investigation-heading"><div><p className="b-kicker">OPERAÇÃO POR ETAPAS</p><h2>Investigar o alvo completo</h2><p>Executa as ferramentas compatíveis, mantém o terminal ao vivo e organiza sinais para validação.</p></div><button className="b-button" disabled={!assessment.data?.approved || !target || console.busy || run?.status === "running"} onClick={() => void start()}><Play size={15}/>{run?.status === "running" ? "Investigação em andamento" : "Iniciar investigação por etapas"}</button></div>
    {!assessment.data?.approved && <p className="b-notice">Primeiro avalie o programa e aprove o plano. <Link to={`/programs/${program.id}#assessment`}>Abrir avaliação</Link></p>}
    <ErrorNote error={error}/>
    <div className="b-investigation-metrics"><span><strong>{completed}/{stages.length}</strong> etapas concluídas</span><span><strong>{signals}</strong> sinais para revisar</span><span><strong>{stages.filter(stage=>stage.status==="blocked"||stage.status==="failed").length}</strong> pendências</span></div>
    {run && <div className="b-investigation-live"><span role="status">{active ? `Agora: ${active.phase} · ${active.label}` : run.status === "running" ? "Iniciando próxima etapa…" : "Operação encerrada. Revise a cobertura e os resultados."}</span><button className="b-button b-secondary" onClick={()=>console.open(run)}><TerminalSquare size={14}/>Abrir terminal da investigação</button>{run.status==="running"&&<button className="b-button b-secondary" disabled={!!busy} onClick={()=>void cancel()}><Square size={12}/>Interromper investigação</button>}</div>}
    <div className="b-investigation-stages" aria-label="Etapas e resultados da investigação">
      {stages.map((stage,index)=><details className={`b-investigation-stage stage-${stage.status}`} key={stage.id} open={stage.status==="running"||!!stage.signals?.length||(stage.tool==="local-advisor"&&stage.status==="completed")||undefined}><summary><span className="b-stage-number">{String(index+1).padStart(2,"0")}</span><div><small>{stage.phase}</small><strong>{stage.label}</strong>{!!stage.signals?.length&&<small>{stage.signals.length} sinais para revisar</small>}</div><span className="b-badge">{labels[stage.status]}</span></summary><div className="b-stage-body">
        {stage.reason&&<p className="b-help">{stage.reason}</p>}
        {!!stage.signals?.length&&<div className="b-stage-signals"><h3>Possibilidades para investigar</h3><ul>{stage.signals.map((signal,i)=><li key={i}>{signal}</li>)}</ul><p>Observações automáticas, sem confirmação de vulnerabilidade.</p></div>}
        {stage.nextStep&&<p className="b-help">{stage.nextStep}</p>}
        {stage.output&&<pre>{stage.output}</pre>}
        {stage.status==="completed"&&stage.output&&!stage.tool.startsWith("ghosthunt-")&&!['pentest-prepare','metasploit-reference'].includes(stage.tool)&&<button className="b-button b-secondary" disabled={!!busy} onClick={()=>void document(stage.id)}>Documentar hipótese desta etapa</button>}
        {!stage.output&&!stage.reason&&<p className="b-help">Aguardando execução real. O resultado aparecerá aqui.</p>}
      </div></details>)}
    </div>
    <p className="b-help">A operação não amplia o escopo nem testa automaticamente ativos descobertos. IA local sugere hipóteses; Metasploit consulta referências. Nenhum relatório é enviado automaticamente.</p>
  </section>;
}
