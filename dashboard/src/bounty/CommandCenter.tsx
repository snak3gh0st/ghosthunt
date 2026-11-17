import { Link, useSearchParams } from "react-router-dom";
import { Crosshair, TerminalSquare, ArrowUpRight, Radio } from "lucide-react";
import { useWorkspace, useIntegrations, date } from "./data";
import { useConsole } from "./console-context";
import { Badge, ErrorNote, Loading } from "./shared";
import IsolationPanel from "./IsolationPanel";
import ToolLauncher from "./ToolLauncher";
import InvestigationPanel from "./InvestigationPanel";

export default function CommandCenter() {
  const workspace = useWorkspace(),
    integrations = useIntegrations(),
    console = useConsole();
  const [params] = useSearchParams();
  if (workspace.isPending) return <Loading />;
  if (workspace.data && !integrations.data) {
    const program = workspace.data.programs.find(p=>p.id===params.get("program")) || workspace.data.programs[0];
    const rule = program?.inScope.find(rule=>!rule.includes("*")) || "";
    const target = rule.includes("://") ? rule : rule ? `https://${rule}` : "";
    return <><div className="b-page-head"><div><h1>Command center</h1><p>Conferindo o inventário do executor. Seus programas e operações continuam disponíveis.</p></div></div>{program && <InvestigationPanel program={program} target={target} />}<ErrorNote error={integrations.error}/><Loading/></>;
  }
  if (!workspace.data || !integrations.data)
    return <ErrorNote error={workspace.error || integrations.error} />;
  const { runs, programs, findings } = workspace.data;
  const active = runs.filter((r) => r.status === "running");
  return (
    <>
      <div className="b-command-intro">
        <div className="b-command-heading">
          <span className="b-signal-label">
            <Radio size={13} />
            GHOSTHUNT // OPERATOR WORKSPACE
          </span>
          <h1 className="b-glitch">
            Command center<span aria-hidden="true">_</span>
          </h1>
          <p>
            Avalie o programa. Aprove o plano. Execute e revise os resultados.
          </p>
        </div>
        <div className="b-command-symbol" aria-hidden="true">
          <Crosshair size={62} strokeWidth={1} />
          <span>
            RESEARCH
            <br />
            OPERATIONS
          </span>
        </div>
      </div>
      <div className="b-status-rail">
        <div>
          <span>PROGRAMAS</span>
          <strong>{programs.length}</strong>
        </div>
        <div>
          <span>EM EXECUÇÃO</span>
          <strong>{active.length.toString().padStart(2, "0")}</strong>
        </div>
        <div>
          <span>HIPÓTESES</span>
          <strong>
            {findings.filter((f) => f.status === "hypothesis").length}
          </strong>
        </div>
        <div>
          <span>IA PADRÃO</span>
          <strong>LOCAL</strong>
          <small>
            {integrations.data.localModels.length
              ? "Modelo disponível"
              : "Modelo indisponível"}
          </small>
        </div>
        <div>
          <span>BURP MCP</span>
          <strong>
            {integrations.data.burp.online ? "ACESSÍVEL" : "OFFLINE"}
          </strong>
          <small>
            {integrations.data.burp.online
              ? "Porta local acessível"
              : "Aguardando serviço"}
          </small>
        </div>
      </div>
      <IsolationPanel data={integrations.data} compact />
      <div className="b-operations-layout">
      <ToolLauncher data={integrations.data} />
      <section className="b-section b-session-panel">
        <div className="b-section-head">
          <h2>
            <TerminalSquare size={18} />
            Atividade recente
          </h2>
          <Link to="/programs">
            Ver programas
            <ArrowUpRight size={14} />
          </Link>
        </div>
        {runs.slice(0, 6).map((run) => (
          <button
            className="b-session-row"
            key={run.id}
            onClick={() => console.open(run)}
            aria-label={`Abrir terminal ${run.tool} ${run.id.slice(0, 8)}`}
          >
            <code>{run.id.slice(0, 8)}</code>
            <div>
              <strong>{run.tool}</strong>
              <span>{run.target}</span>
            </div>
            <span className="b-session-date">{date(run.createdAt)}</span>
            <Badge value={run.status} />
            <TerminalSquare size={16} />
          </button>
        ))}
        {!runs.length && (
          <div className="b-terminal-empty">
            <TerminalSquare size={32} />
            <strong>Nenhum processo iniciado</strong>
            <p>
              Clique em RODAR para abrir o terminal com comando, PID e saída ao
              vivo. As transcrições ficam disponíveis aqui após o encerramento.
            </p>
          </div>
        )}
      </section>
      </div>
    </>
  );
}
