import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Target } from "lucide-react";
import { Badge, ErrorNote, Loading } from "./shared";
import { currency, date, useWorkspace } from "./data";

export default function Overview() {
  const { data, error, isPending } = useWorkspace();
  if (isPending) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const active = data.findings.filter(
    (f) => !["paid", "duplicate", "rejected"].includes(f.status),
  );
  const rewards = Object.entries(data.summary.rewards).filter(
    ([, value]) => value > 0,
  );
  return (
    <>
      <div className="b-page-head">
        <div>
          <p className="b-kicker">Seu espaço de trabalho</p>
          <h1>Visão geral</h1>
          <p>
            Escolha um programa, investigue uma hipótese e documente o que
            conseguir provar.
          </p>
        </div>
        <Link className="b-button" to="/programs">
          Encontrar programas <ArrowRight size={16} />
        </Link>
      </div>
      <div className="b-metrics" aria-label="Resultados da pesquisa">
        <div>
          <span>Programas com recompensa</span>
          <strong>
            {data.summary.paidPrograms}
            <small> / {data.summary.programs} acompanhados</small>
          </strong>
        </div>
        <div>
          <span>Relatórios enviados</span>
          <strong>
            {data.summary.submitted}
            <small> com link registrado</small>
          </strong>
        </div>
        <div>
          <span>Recebido</span>
          <strong className="b-money">
            {rewards.length
              ? rewards.map(([code, value]) => (
                  <span key={code}>{currency(value, code)} </span>
                ))
              : currency(0)}
            <small>pagamentos confirmados por você</small>
          </strong>
        </div>
        <div>
          <span>Tempo registrado</span>
          <strong>
            {(data.summary.minutesSpent / 60).toLocaleString("pt-BR", {
              maximumFractionDigits: 1,
            })}
            <small> horas</small>
          </strong>
        </div>
      </div>
      <section className="b-section">
        <div className="b-section-head">
          <h2>
            Em investigação <span>{active.length}</span>
          </h2>
          <Link to="/findings">
            Ver todos <ArrowUpRight size={15} />
          </Link>
        </div>
        {active.length ? (
          <div className="b-list">
            {active.slice(0, 6).map((finding) => (
              <Link
                className="b-list-row"
                key={finding.id}
                to={`/findings/${finding.id}`}
              >
                <div>
                  <strong>{finding.title}</strong>
                  <p>
                    {
                      data.programs.find((p) => p.id === finding.programId)
                        ?.name
                    }{" "}
                    · {finding.category}
                  </p>
                </div>
                <Badge value={finding.status} />
                <ArrowRight size={16} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="b-empty">
            <Target size={27} strokeWidth={1.4} />
            <h3>Comece pelo programa certo</h3>
            <p>
              O catálogo mostra programas do HackerOne. O filtro de recompensas
              já vem ativado. Adicione um programa e confira as regras antes de
              começar.
            </p>
            <Link className="b-button" to="/programs">
              Explorar catálogo <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </section>
      <div className="b-two-columns">
        <section className="b-section">
          <div className="b-section-head">
            <h2>Programas acompanhados</h2>
          </div>
          {data.programs.length ? (
            data.programs.slice(0, 5).map((program) => (
              <Link
                className="b-list-row"
                to={`/programs/${program.id}`}
                key={program.id}
              >
                <div>
                  <strong>{program.name}</strong>
                  <p>
                    {program.scopeConfirmed
                      ? `${program.inScope.length} regras de escopo`
                      : "Confira e confirme o escopo oficial"}
                  </p>
                </div>
                <span className="b-muted">
                  {program.offersBounties ? "Bounty" : "VDP"}
                </span>
              </Link>
            ))
          ) : (
            <p className="b-muted b-padded">Seus programas aparecerão aqui.</p>
          )}
        </section>
        <section className="b-section">
          <div className="b-section-head">
            <h2>Últimas execuções</h2>
          </div>
          {data.runs.length ? (
            data.runs.slice(0, 5).map((run) => (
              <Link
                className="b-list-row"
                to={`/programs/${run.programId}`}
                key={run.id}
              >
                <div>
                  <strong>{run.tool}</strong>
                  <p>{date(run.createdAt)}</p>
                </div>
                <Badge value={run.status} />
              </Link>
            ))
          ) : (
            <p className="b-muted b-padded">
              Ao iniciar uma coleta ou classificação, você acompanha o resultado
              aqui.
            </p>
          )}
        </section>
      </div>
      <p className="b-footnote">
        Consultas locais: {data.summary.localAdviceCount}. Consultas Claude:{" "}
        {data.summary.claudeAdviceCount}. Consultas OpenAI:{" "}
        {data.summary.openaiAdviceCount || 0}. Custos informados pelos
        provedores: {currency(Math.round(data.summary.aiCostUsd * 100))}.{" "}
        {data.summary.unpricedAdviceCount || 0} consultas sem custo informado,
        não incluídas nesse valor. Recompensas e valores de programas não são
        previsões de receita.
      </p>
    </>
  );
}
