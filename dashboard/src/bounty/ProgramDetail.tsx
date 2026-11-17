import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Plus,
  Square,
  TerminalSquare,
} from "lucide-react";
import { api } from "../lib/api";
import { Badge, ErrorNote, External, Loading } from "./shared";
import { date, useIntegrations, useRefresh, useWorkspace, usePentest, useAssessment } from "./data";
import ProgramAssessment from "./ProgramAssessment";
import InvestigationPanel from "./InvestigationPanel";
import type { Finding } from "./types";
import ScopeConfirmation from "./ScopeConfirmation";
import AdviceProvider from "./AdviceProvider";
import RunForm from "./RunForm";
import { useConsole } from "./console-context";
import type { Run } from "./types";

export default function ProgramDetail() {
  const { id } = useParams();
  const workspace = useWorkspace();
  const integrations = useIntegrations();
  const refresh = useRefresh();
  const navigate = useNavigate();
  const console = useConsole();
  const pentest = usePentest(id);
  const assessment = useAssessment(id);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState("");
  const program = workspace.data?.programs.find((p) => p.id === id);
  if (workspace.isPending) return <Loading />;
  if (!program)
    return (
      <ErrorNote
        error={workspace.error || new Error("Programa não encontrado.")}
      />
    );
  const findings = workspace.data!.findings.filter((f) => f.programId === id);
  const runs = workspace.data!.runs.filter((r) => r.programId === id);
  const advice = workspace.data!.advice.filter((a) => a.programId === id);
  async function documentRun(runId: string) {
    setBusy("finding"); setError(null);
    try { const finding = await api.post<Finding>(`/bounty/runs/${runId}/finding`, {}); await refresh(); navigate(`/findings/${finding.id}?tab=edit`); }
    catch (err) { setError(err); } finally { setBusy(""); }
  }
  async function createFinding(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy("finding");
    setError(null);
    try {
      const finding = await api.post<Finding>(
        `/bounty/programs/${id}/findings`,
        {
          title: form.get("title"),
          target: form.get("target"),
          category: form.get("category"),
        },
      );
      await refresh();
      navigate(`/findings/${finding.id}?tab=edit`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }
  async function run(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy("run");
    setError(null);
    try {
      const started = await api.post<Run>(`/bounty/programs/${id}/runs`, {
        tool: form.get("tool"),
        target: form.get("target"),
      });
      console.open(started);
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }
  async function ask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy("advice");
    setError(null);
    try {
      await api.post(`/bounty/programs/${id}/advice`, {
        question: form.get("question"),
        skill: form.get("skill"),
        provider: form.get("provider"),
        ...(form.get("localModel")
          ? { localModel: form.get("localModel") }
          : {}),
        ...(form.get("findingId") ? { findingId: form.get("findingId") } : {}),
      });
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }
  const defaultTarget = program.inScope[0]?.includes("*")
    ? ""
    : program.inScope[0]?.startsWith("http")
      ? program.inScope[0]
      : `https://${program.inScope[0] || ""}`;
  return (
    <>
      <Link to="/programs" className="b-back">
        <ArrowLeft size={15} /> Programas
      </Link>
      <div className="b-page-head">
        <div>
          <p className="b-kicker">
            {program.offersBounties
              ? "Programa com recompensa"
              : "Programa de divulgação"}
          </p>
          <h1>{program.name}</h1>
          <p>
            {program.focus ||
              "Defina uma hipótese e reúna as evidências da sua investigação."}
          </p>
        </div>
        <div className="b-program-actions"><button className="b-button" disabled={console.busy || !program.scopeConfirmed || !assessment.data?.approved || pentest.data?.status === "preparing"} onClick={() => void console.launch(program.id, "pentest-prepare", defaultTarget || program.url).catch(setError)}>{pentest.data?.installed ? "Verificar preparo" : "Iniciar pentest"}</button><External href={program.url}>Abrir programa</External></div>
      </div>
      <ErrorNote error={error} />
      <ErrorNote error={integrations.error} />
      <ScopeConfirmation key={program.id} program={program}/>
      <ProgramAssessment key={program.id} program={program} />
      <InvestigationPanel key={`${program.id}-${defaultTarget}`} program={program} target={defaultTarget} />
      <section className="b-section">
        <div className="b-section-head">
          <h2>
            Achados <span>{findings.length}</span>
          </h2>
        </div>
        {findings.map((f) => (
          <Link className="b-list-row" key={f.id} to={`/findings/${f.id}`}>
            <div>
              <strong>{f.title}</strong>
              <p>{f.target}</p>
            </div>
            <Badge value={f.status} />
            <ArrowRight size={16} />
          </Link>
        ))}
        <details className="b-inline-details">
          <summary>
            <Plus size={16} /> Registrar hipótese
          </summary>
          <form className="b-form" onSubmit={createFinding}>
            <label>
              Título da hipótese
              <input
                name="title"
                placeholder="Ex.: acesso entre duas contas de teste"
                required
                maxLength={200}
              />
            </label>
            <div className="b-form-grid">
              <label>
                URL do ativo
                <input
                  name="target"
                  type="url"
                  defaultValue={defaultTarget}
                  required
                  placeholder="https://api.example.com/recurso"
                />
              </label>
              <label>
                Área de investigação
                <select name="category">
                  <option>Access control</option>
                  <option>Authentication</option>
                  <option>Business logic</option>
                  <option>XSS</option>
                  <option>SSRF</option>
                  <option>GraphQL</option>
                  <option>Information disclosure</option>
                  <option>Other</option>
                </select>
              </label>
            </div>
            <button
              className="b-button"
              disabled={!!busy || !program.scopeConfirmed}
            >
              {busy === "finding" ? "Registrando…" : "Criar hipótese"}
            </button>
          </form>
        </details>
      </section>
      <section className="b-section">
        <div className="b-section-head">
          <h2>Reconhecimento e classificação</h2>
          <Link to="/integrations">
            Ver ferramentas <ArrowRight size={15} />
          </Link>
        </div>
        <RunForm
          key={program.id}
          program={program}
          tools={integrations.data?.tools || []}
          prepared={!!pentest.data?.installed}
          assessed={!!assessment.data?.approved}
          busy={busy}
          onSubmit={run}
        />
        {runs.map((item) => (
          <RunRow
            key={item.id}
            item={item}
            busy={busy}
            onDocument={documentRun}
            onOpenTerminal={(run) => console.open(run)}
            onCancel={async (runId) => {
              try {
                await api.post(`/bounty/runs/${runId}/cancel`);
                await refresh();
              } catch (e) {
                setError(e);
              }
            }}
          />
        ))}
      </section>
      <section className="b-section">
        <div className="b-section-head">
          <h2>
            <Bot size={20} /> Assistente de investigação
          </h2>
          <span className="b-muted">Claude-BugHunter + Claude-OSINT</span>
        </div>
        <form className="b-form" onSubmit={ask}>
          {integrations.data && (
            <AdviceProvider integrations={integrations.data} />
          )}
          <div className="b-form-grid">
            <label>
              Referência técnica
              <select name="skill">
                {(integrations.data?.skills || ["hunt-idor"]).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Contexto do achado
              <select name="findingId">
                <option value="">Programa e últimas observações</option>
                {findings.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            O que você quer investigar?
            <textarea
              name="question"
              rows={3}
              minLength={5}
              maxLength={4000}
              required
              placeholder="Ex.: Tenho duas contas de teste. Como verificar se a permissão sobre este recurso está correta e quais evidências devo guardar?"
            />
          </label>
          {integrations.data && !integrations.data.advisorAvailable && (
            <p className="b-notice">
              Inicie um modelo no Ollama ou LM Studio, ou autentique o Claude
              Code. Confira as opções em Ferramentas e fontes.
            </p>
          )}
          <button
            className="b-button"
            disabled={!!busy || !integrations.data?.advisorAvailable}
          >
            {busy === "advice" ? "Consultando a IA…" : "Consultar assistente"}
          </button>
        </form>
        {advice
          .slice()
          .reverse()
          .map((item) => (
            <article className="b-advice" key={item.id}>
              <h3>{item.question}</h3>
              <p className="b-help">
                {item.provider === "local"
                  ? `Local · ${item.model} · sem consumo de API`
                  : item.provider === "openai"
                    ? `OpenAI API · ${item.model} · ${item.inputTokens || 0} tokens de entrada / ${item.outputTokens || 0} de saída`
                    : "Claude Code"}
                {item.durationMs
                  ? ` · ${(item.durationMs / 1000).toFixed(1)} s`
                  : ""}
              </p>
              {item.contextTruncated && (
                <p className="b-help">
                  Contexto resumido para esta consulta. Confira os dados
                  completos antes de validar um achado.
                </p>
              )}
              {item.outputTruncated && (
                <p className="b-notice">
                  A resposta atingiu o limite de geração. Peça uma resposta mais
                  curta ou divida a pergunta.
                </p>
              )}
              <div className="b-prose">{item.answer}</div>
              <div className="b-source-links">
                {item.sources.map((source) => (
                  <External key={source} href={source}>
                    Referência técnica
                  </External>
                ))}
              </div>
            </article>
          ))}
      </section>
    </>
  );
}

function RunRow({
  item,
  busy,
  onDocument,
  onOpenTerminal,
  onCancel,
}: {
  item: Run;
  busy: string;
  onDocument: (runId: string) => void;
  onOpenTerminal: (run: Run) => void;
  onCancel: (runId: string) => void;
}) {
  const initialOpen = useRef(item.status === "running");
  return (
    <details
      className="b-run"
      id={`run-${item.id}`}
      open={initialOpen.current || undefined}
    >
      <summary>
        <strong>{item.tool}</strong>
        <span className="b-muted">{date(item.createdAt)}</span>
        <Badge value={item.status} />
      </summary>
      <p className="b-help">
        {item.target} · escopo v{item.scopeVersion}
      </p>
      {item.output && <pre>{item.output}</pre>}
      <button
        className="b-button b-secondary"
        onClick={() => onOpenTerminal(item)}
      >
        <TerminalSquare size={15} />
        Abrir terminal
      </button>
      {item.status === "completed" && !!item.output && (
        <button
          className="b-button b-secondary"
          disabled={!!busy}
          onClick={() => onDocument(item.id)}
        >
          Documentar hipótese desta execução
        </button>
      )}
      {item.error && <ErrorNote error={item.error} />}{" "}
      {item.status === "running" && (
        <button
          className="b-button b-secondary"
          onClick={() => void onCancel(item.id)}
        >
          <Square size={13} />
          Cancelar execução
        </button>
      )}
    </details>
  );
}
