import { useState, lazy, Suspense, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check } from "lucide-react";
import { api } from "../lib/api";
import { Badge, ErrorNote, External, Loading } from "./shared";
import {
  date,
  statusLabels,
  useRefresh,
  useWorkspace,
} from "./data";
import type { Evidence } from "./types";
const ReportReview = lazy(() => import("./ReportReview"));

export default function FindingDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") === "edit" ? "edit" : "report");
  const workspace = useWorkspace();
  const refresh = useRefresh();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState(false);
  const evidence = useQuery({
    queryKey: ["bounty-evidence", id],
    queryFn: () => api.get<Evidence[]>(`/bounty/findings/${id}/evidence`),
  });
  const finding = workspace.data?.findings.find((f) => f.id === id);
  const program = workspace.data?.programs.find(
    (p) => p.id === finding?.programId,
  );
  if (workspace.isPending) return <Loading />;
  if (!finding || !program)
    return (
      <ErrorNote
        error={workspace.error || new Error("Achado não encontrado.")}
      />
    );
  const frozen = ["submitted", "triaged", "paid"].includes(finding.status);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    setSaved(false);
    const form = new FormData(e.currentTarget);
    const body = {
      ...Object.fromEntries(form),
      reproductionConfirmed: form.has("reproductionConfirmed"),
    };
    try {
      const response = await fetch(`/api/bounty/findings/${id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-api-key": localStorage.getItem("ghosthunt_api_key") || "",
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }
  async function attach(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = new FormData(formElement);
    setBusy("evidence");
    setError(null);
    try {
      const file = form.get("file") as File;
      let content = String(form.get("content") || "");
      if (file?.size) {
        if (file.size > 250000)
          throw new Error("Use arquivo de texto com até 250 KB.");
        content = await file.text();
      }
      await api.post(`/bounty/findings/${id}/evidence`, {
        title: form.get("title"),
        kind: form.get("kind"),
        content,
      });
      await evidence.refetch();
      await refresh();
      formElement.reset();
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }
  async function track(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy("track");
    setError(null);
    const status = String(form.get("status"));
    try {
      await api.post(`/bounty/findings/${id}/status`, {
        status,
        reportUrl: form.get("reportUrl"),
        minutesSpent: Number(form.get("minutesSpent")),
        currency: form.get("currency"),
        rewardCents:
          status === "paid" ? Math.round(Number(form.get("amount")) * 100) : 0,
      });
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <Link className="b-back" to={`/programs/${program.id}`}>
        <ArrowLeft size={15} />
        {program.name}
      </Link>
      <div className="b-page-head">
        <div>
          <p className="b-kicker">Achado e relatório</p>
          <h1>{finding.title}</h1>
          <p className="b-break">{finding.target}</p>
        </div>
        <Badge value={finding.status} />
      </div>
      <ErrorNote error={error || evidence.error} />
      {finding.sourceRunId && <p className="b-notice">Hipótese criada a partir de uma execução. <Link to={`/programs/${program.id}#run-${finding.sourceRunId}`}>Ver saída original e terminal</Link>. Saída de ferramenta exige validação independente.</p>}
      <div className="b-review-tabs" role="group" aria-label="Visualização do achado"><button className="b-button" aria-pressed={tab === "report"} onClick={() => setTab("report")}>Revisar relatório</button><button className="b-button b-secondary" aria-pressed={tab === "edit"} onClick={() => setTab("edit")}>Editar e anexar evidências</button></div>
      {finding.scopeVersion !== program.scopeVersion && (
        <p className="b-notice">
          O escopo mudou. Confira o alvo, salve e revalide o achado antes de
          exportar o relatório revisado.
        </p>
      )}
      <div className="b-detail-layout">
        <div>
          {tab === "report" && <Suspense fallback={<Loading />}><ReportReview finding={finding} /></Suspense>}
          <div hidden={tab !== "edit"}>
          <section className="b-section">
            <div className="b-section-head">
              <h2>Documentação do achado</h2>
              <span className="b-muted">Preencha o relatório em inglês</span>
            </div>
            <form className="b-form" key={finding.updatedAt} onSubmit={save}>
              <fieldset disabled={frozen || !!busy}>
                <label>
                  Título
                  <input
                    name="title"
                    defaultValue={finding.title}
                    required
                    maxLength={200}
                  />
                </label>
                <label>
                  URL afetada
                  <input
                    name="target"
                    type="url"
                    defaultValue={finding.target}
                    required
                  />
                </label>
                <div className="b-form-grid">
                  <label>
                    Categoria
                    <input
                      name="category"
                      defaultValue={finding.category}
                      required
                    />
                  </label>
                  <label>
                    Severidade avaliada por você
                    <select name="severity" defaultValue={finding.severity}>
                      {[
                        "informational",
                        "low",
                        "medium",
                        "high",
                        "critical",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {(
                  [
                    ["summary", "Resumo"],
                    ["preconditions", "Pré-condições e contas de teste"],
                    ["steps", "Passos de reprodução numerados"],
                    ["expected", "Comportamento esperado"],
                    ["actual", "Comportamento observado"],
                    ["impact", "Impacto demonstrado"],
                  ] as const
                ).map(([name, label]) => (
                  <label key={name}>
                    {label}
                    <textarea
                      name={name}
                      rows={name === "steps" ? 5 : 3}
                      defaultValue={finding[name]}
                      maxLength={name === "steps" ? 16000 : 8000}
                    />
                  </label>
                ))}
                <label className="b-check">
                  <input
                    name="reproductionConfirmed"
                    type="checkbox"
                    defaultChecked={finding.reproductionConfirmed}
                  />
                  Reproduzi a falha com minhas contas de teste e conferi as
                  evidências
                </label>
                <p className="b-help">
                  Adicionar evidências ou editar o conteúdo devolve o achado à
                  etapa de hipótese. Salve antes de validar.
                </p>
                <button className="b-button" disabled={!!busy || frozen}>
                  {busy === "save" ? "Salvando…" : "Salvar documentação"}
                </button>
              </fieldset>
              {saved && (
                <p role="status" className="b-success">
                  <Check size={15} />
                  Documentação salva.
                </p>
              )}
            </form>
          </section>
          <section className="b-section">
            <div className="b-section-head">
              <h2>
                Evidências <span>{evidence.data?.length || 0}</span>
              </h2>
            </div>
            {evidence.data?.map((item) => (
              <details className="b-run" key={item.id}>
                <summary>
                  <strong>{item.title}</strong>
                  <span className="b-muted">{date(item.createdAt)}</span>
                </summary>
                <p className="b-help b-break">SHA-256: {item.sha256}</p>
                <pre>{item.content}</pre>
              </details>
            ))}
            {!frozen && (
              <form className="b-form" onSubmit={attach}>
                <label>
                  Nome da evidência
                  <input
                    name="title"
                    required
                    maxLength={150}
                    placeholder="Ex.: respostas para as contas A e B"
                  />
                </label>
                <label>
                  Tipo
                  <select name="kind">
                    <option value="request-response">
                      Requisição e resposta
                    </option>
                    <option value="reproduction">Registro de reprodução</option>
                    <option value="tool-output">Saída de ferramenta</option>
                    <option value="notes">Notas</option>
                  </select>
                </label>
                <label>
                  Conteúdo
                  <textarea
                    name="content"
                    rows={5}
                    maxLength={250000}
                    placeholder="Cole as requisições e respostas relevantes, sem tokens ou cookies."
                  />
                </label>
                <label>
                  Ou importar arquivo de texto, HAR ou JSON
                  <input
                    name="file"
                    type="file"
                    accept=".txt,.har,.json,.md,.log"
                  />
                </label>
                <p className="b-help">
                  Remova credenciais e dados pessoais antes de salvar.
                  Evidências do achado selecionado podem ser enviadas ao Claude
                  ao pedir uma análise.
                </p>
                <button className="b-button b-secondary" disabled={!!busy}>
                  {busy === "evidence" ? "Anexando…" : "Adicionar evidência"}
                </button>
              </form>
            )}
          </section>
          </div>
        </div>
        <aside className="b-detail-aside">
          <section className="b-section">
            <div className="b-section-head">
              <h2>Preparar relatório</h2>
            </div>
            <div className="b-form">
              <p className="b-help">
                O relatório usa o conteúdo salvo e suas evidências. O envio ao
                HackerOne é feito por você.
              </p>
              <button className="b-button b-secondary" onClick={() => setTab("report")}>Abrir revisão e aprovação</button>
              {finding.reportUrl && (
                <External href={finding.reportUrl}>
                  Abrir relatório no HackerOne
                </External>
              )}
            </div>
          </section>
          <section className="b-section">
            <div className="b-section-head">
              <h2>Acompanhamento</h2>
            </div>
            <form
              className="b-form"
              key={`track-${finding.updatedAt}`}
              onSubmit={track}
            >
              <label>
                Etapa
                <select name="status" aria-label="Etapa" defaultValue={finding.status}>
                  {Object.entries(statusLabels)
                    .filter(
                      ([key]) =>
                        ({ hypothesis: ["hypothesis"], validated: ["validated"], ready: ["ready", "submitted"], submitted: ["submitted", "triaged", "duplicate", "rejected", "paid"], triaged: ["triaged", "duplicate", "rejected", "paid"], duplicate: ["duplicate"], rejected: ["rejected"], paid: ["paid"] }[finding.status] || []).includes(key),
                    )
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Link do relatório
                <input
                  name="reportUrl"
                  type="url"
                  defaultValue={finding.reportUrl}
                  placeholder="https://hackerone.com/reports/123"
                />
              </label>
              <label>
                Tempo total dedicado (minutos)
                <input
                  name="minutesSpent"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={finding.minutesSpent}
                  required
                />
              </label>
              <div className="b-form-grid">
                <label>
                  Valor recebido
                  <input
                    name="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={finding.rewardCents / 100}
                  />
                </label>
                <label>
                  Moeda
                  <select name="currency" defaultValue={finding.currency}>
                    {["USD", "EUR", "GBP", "BRL"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="b-help">
                Use “Pago” somente após receber o valor. Os totais permanecem
                separados por moeda.
              </p>
              <button className="b-button b-secondary" disabled={!!busy}>
                {busy === "track" ? "Salvando…" : "Salvar acompanhamento"}
              </button>
            </form>
          </section>
        </aside>
      </div>
    </>
  );
}
