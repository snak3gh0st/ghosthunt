import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { Play, TerminalSquare, LockKeyhole, ArrowUpRight, Search } from "lucide-react";
import { toolIncompatibility } from "../../../src/bounty/targets";
import { useWorkspace, usePentest, useAssessment } from "./data";
import { useConsole } from "./console-context";
import { ErrorNote } from "./shared";
import type { Integrations } from "./types";
import InvestigationPanel from "./InvestigationPanel";

const category = (id: string) => id.startsWith("repo-") ? "Código" : id.startsWith("burp-") ? "Burp" : id === "cbh-classify" ? "Orientação" : "Recon";
const nativeLabels: Record<string, string> = { "ghosthunt-status": "Sessão", "ghosthunt-doctor": "Diagnóstico", "ghosthunt-engines": "Engines", "ghosthunt-playbooks": "Playbooks", "ghosthunt-report": "Gerar resumo" };
const modes: Record<string, string> = { source: "CÓDIGO", active: "ATIVO", passive: "PASSIVO", import: "MCP", offline: "OFFLINE" };
export default function ToolLauncher({ data }: { data: Integrations }) {
  const workspace = useWorkspace(), console = useConsole();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const programId = params.get("program") || "";
  const [target, setTarget] = useState<string | null>(null), [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState("Prontas"), [query, setQuery] = useState("");
  const programs = workspace.data?.programs || [];
  const program = programs.find((p) => p.id === programId) || programs[0];
  const session = usePentest(program?.id);
  const assessment = useAssessment(program?.id);
  const first = program?.inScope.find((rule) => !rule.includes("*")) || "";
  const currentTarget = target ?? (first ? (first.startsWith("http") ? first : `https://${first}`) : "");
  const entries = data.tools.map((tool) => {
    const reason = !program ? "Selecione um programa" : !tool.installed ? tool.blockedReason || (tool.mode === "import" ? "Inicie o Burp com a extensão MCP" : "Ausente na imagem Docker") : tool.blockedReason ? tool.blockedReason : !program.scopeConfirmed ? "Confirme o escopo do programa" : toolIncompatibility(tool.id, currentTarget, program.inScope) || (tool.mode === "active" && !program.activeTestingAllowed ? "Permissão de consulta ativa pendente" : tool.mode !== "offline" && tool.mode !== "import" && !program.automationAllowed ? "Permissão de automação pendente" : null);
    return { ...tool, reason: (!tool.id.startsWith("ghosthunt-") && !assessment.data?.approved ? "Avalie o programa e aprove o plano antes de executar." : null) || reason || (tool.id === "nmap" && !program?.portScanAllowed ? "Permissão de conexão TCP na porta do ativo pendente." : null) || (!tool.id.startsWith("ghosthunt-") && !tool.id.startsWith("burp-") && tool.id !== "pentest-prepare" && !session.data?.installed ? "Inicie o pentest para preparar as ferramentas deste escopo." : null) };
  }).sort((a, b) => Number(!!a.reason) - Number(!!b.reason));
  const native = entries.filter((tool) => tool.id.startsWith("ghosthunt-"));
  const tools = entries.filter((tool) => !tool.id.startsWith("ghosthunt-") && !["pentest-prepare","investigation"].includes(tool.id));
  const ready = tools.filter((tool) => !tool.reason).length;
  const visible = tools.filter((tool) => (filter === "Todas" || (filter === "Prontas" ? !tool.reason : category(tool.id) === filter)) && `${tool.name} ${tool.description}`.toLowerCase().includes(query.toLowerCase()));
  async function launch(tool: string) {
    if (!program) return;
    setError(null);
    try { await console.launch(program.id, tool, tool === "pentest-prepare" ? (currentTarget || program.url) : currentTarget); } catch (e) { setError(e); }
  }
  return <section className="b-section b-tool-launcher" aria-label="Executar ferramentas">
    <div className="b-section-head"><h2><TerminalSquare size={17} /> Área de operação</h2><span className="b-wire-label">{ready} {ready === 1 ? "FERRAMENTA PRONTA" : "FERRAMENTAS PRONTAS"}</span></div>
    <div className="b-target-bar">
      <label>Programa<select aria-label="Programa da execução" value={program?.id || ""} onChange={(e) => { setTarget(null); navigate(`/programs/${e.target.value}#assessment`); }}><option value="" disabled>Selecione um programa</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Alvo no escopo<input aria-label="Alvo da execução" type="url" value={currentTarget} onChange={(e) => setTarget(e.target.value)} placeholder="https://alvo-permitido.example" /></label>
      {program && <Link className="b-scope-link" to={`/programs/${program.id}`}>Escopo v{program.scopeVersion}<ArrowUpRight size={14} /></Link>}
    </div>
    {program && <div className="b-pentest-start"><div><strong>{!assessment.data?.approved ? "Avaliação necessária antes do pentest" : session.data?.installed ? "Ambiente instalado para este escopo" : "Prepare o ambiente deste programa"}</strong><span>{!assessment.data?.approved ? "Confira viabilidade, política, escopo e plano de investigação." : session.data?.status === "preparing" ? "Instalação em andamento. Acompanhe o terminal." : session.data?.blockers?.join(" ") || "Plano aprovado. Instala ferramentas e Burp MCP; confere Conda e VPN."}</span></div>{!assessment.data?.approved ? <Link className="b-button" to={`/programs/${program.id}#assessment`}>Avaliar programa</Link> : <button className="b-button" disabled={console.busy || !program.scopeConfirmed || session.data?.status === "preparing"} onClick={() => void launch("pentest-prepare")}>{session.data?.installed ? "Verificar preparo" : "Iniciar pentest"}</button>}</div>}
    {!program && <p className="b-notice">Adicione um programa e confira o escopo. <Link to="/programs">Escolher programa</Link></p>}
    <div className="b-native-toolbar" aria-label="Controles da sessão Ghosthunt">
      <span>Sessão nativa · controles locais</span>
      <div>{native.map((tool) => <button key={tool.id} className="b-native-action" onClick={() => void launch(tool.id)} disabled={!!tool.reason || console.busy} aria-label={`Rodar ${tool.name}`} title={tool.reason || tool.description}><TerminalSquare size={13} />{nativeLabels[tool.id]}</button>)}</div>
    </div>
    <ErrorNote error={error} />
    {program && <InvestigationPanel key={`${program.id}-${currentTarget}`} program={program} target={currentTarget} />}
    <div className="b-tool-filters">
      <div role="group" aria-label="Categorias de ferramentas">{["Prontas", "Todas", "Código", "Recon", "Burp"].map((name) => <button key={name} aria-label={`Filtrar ferramentas: ${name}`} aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}<span>{name === "Prontas" ? ready : name === "Todas" ? tools.length : tools.filter((tool) => category(tool.id) === name).length}</span></button>)}</div>
      <label className="b-tool-search"><Search size={14} /><input aria-label="Buscar ferramentas" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar ferramenta" /></label>
    </div>
    <div className="b-tool-table">
      <div className="b-tool-table-head"><span>FERRAMENTA</span><span>MODO</span><span>EXECUTAR</span></div>
      {visible.map((tool) => <div className={`b-tool-entry ${tool.reason ? "is-blocked" : ""} ${params.get("tool") === tool.id ? "is-selected" : ""}`} key={tool.id}>
        <div className="b-tool-identity"><div><strong>{tool.name}</strong><span className="b-tool-installation">{tool.mode === "import" ? "MCP externo" : tool.installed ? "Docker · instalada" : "Docker · ausente"}</span><p className="b-tool-description">{tool.description}</p>{tool.reason && <p className="b-tool-reason"><LockKeyhole size={11} />{tool.reason}</p>}</div></div>
        <span className={`b-tool-mode mode-${tool.mode}`}>{modes[tool.mode] || tool.mode}</span>
        <button className="b-run-trigger" onClick={() => void launch(tool.id)} disabled={!!tool.reason || console.busy} aria-label={`Rodar ${tool.name}`} title={tool.reason || "Executar e abrir terminal ao vivo"}><Play size={13} fill="currentColor" />{console.busy ? "INICIANDO" : "RODAR"}</button>
      </div>)}
      {!visible.length && <div className="b-tools-empty"><TerminalSquare size={24} /><strong>{query ? "Nenhuma ferramenta encontrada" : "Nenhuma ferramenta pronta nesta categoria"}</strong><p>{query ? "Tente outro nome ou limpe a busca." : "Veja todas as ferramentas para conferir o que falta configurar."}</p><button className="b-button b-secondary" onClick={() => { setFilter("Todas"); setQuery(""); }}>Ver todas as ferramentas</button></div>}
    </div>
    <div className="b-launcher-footer"><span><i />Processos reais no seu Mac</span><Link to="/integrations">Gerenciar conexões<ArrowUpRight size={13} /></Link></div>
  </section>;
}
