import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Badge, ErrorNote, Loading } from "./shared";
import { currency, useWorkspace } from "./data";

export default function Findings() {
  const { data, error, isPending } = useWorkspace();
  const [status, setStatus] = useState("all");
  if (isPending) return <Loading />;
  if (!data) return <ErrorNote error={error} />;
  const findings = data.findings.filter(
    (f) =>
      status === "all" ||
      (status === "active"
        ? !["paid", "duplicate", "rejected"].includes(f.status)
        : f.status === status),
  );
  return (
    <>
      <div className="b-page-head">
        <div>
          <p className="b-kicker">Evidência antes do relatório</p>
          <h1>Achados e relatórios</h1>
          <p>
            Acompanhe da primeira hipótese ao retorno do programa e ao pagamento
            recebido.
          </p>
        </div>
        <Link to="/programs" className="b-button">
          Abrir programas <ArrowRight size={16} />
        </Link>
      </div>
      <section className="b-section">
        <div className="b-toolbar">
          <label>
            Filtrar por etapa
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">Todas as etapas</option>
              <option value="active">Em andamento</option>
              <option value="hypothesis">Hipóteses</option>
              <option value="validated">Validados</option>
              <option value="ready">Prontos para enviar</option>
              <option value="submitted">Enviados</option>
              <option value="triaged">Em triagem</option>
              <option value="paid">Pagos</option>
              <option value="duplicate">Duplicados</option>
              <option value="rejected">Não aceitos</option>
            </select>
          </label>
        </div>
        {findings.map((f) => (
          <Link className="b-list-row" key={f.id} to={`/findings/${f.id}`}>
            <div>
              <strong>{f.title}</strong>
              <p>
                {data.programs.find((p) => p.id === f.programId)?.name} ·{" "}
                {f.category} · {f.severity}
              </p>
            </div>
            {f.status === "paid" && (
              <span>{currency(f.rewardCents, f.currency)}</span>
            )}
            <Badge value={f.status} />
            <ArrowRight size={16} />
          </Link>
        ))}
        {!findings.length && (
          <div className="b-empty">
            <h3>Nenhum achado nesta etapa</h3>
            <p>
              Abra um programa e registre uma hipótese para começar. Cada achado
              terá suas próprias evidências e seu relatório.
            </p>
            <Link to="/programs" className="b-button b-secondary">
              Escolher programa
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
