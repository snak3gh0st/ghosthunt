import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Plus, Search } from "lucide-react";
import { api } from "../lib/api";
import { ErrorNote, External, Loading } from "./shared";
import { useRefresh, useWorkspace } from "./data";
import type { CatalogProgram, Program } from "./types";
import ProgramForm from "./ProgramForm";

export default function Programs() {
  const workspace = useWorkspace();
  const refresh = useRefresh();
  const navigate = useNavigate();
  const [showCatalog, setShowCatalog] = useState(false);
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search);
  const [paid, setPaid] = useState(true);
  const [openOnly, setOpenOnly] = useState(true);
  const [limit, setLimit] = useState(30);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const catalog = useQuery({
    queryKey: ["bounty-catalog"],
    queryFn: () =>
      api.get<{ fetchedAt: string; programs: CatalogProgram[] }>(
        "/bounty/catalog?refresh=true",
      ),
    enabled: showCatalog,
    staleTime: 1800000,
    retry: false,
  });
  const filtered =
    catalog.data?.programs.filter(
      (p) =>
        (!paid || p.offersBounties) &&
        (!openOnly || p.open) &&
        `${p.name} ${p.handle}`.toLowerCase().includes(deferred.toLowerCase()),
    ) || [];
  async function add(item: CatalogProgram) {
    setBusy(item.handle);
    setError(null);
    try {
      const saved = await api.post<Program>("/bounty/programs", {
        name: item.name,
        url: item.url,
        offersBounties: item.offersBounties,
        inScope: item.inScope,
        outOfScope: item.outOfScope,
        policy: item.notes,
        scopeReferences: item.scopeReferences,
        scopeConfirmed: false,
        automationAllowed: false,
      });
      await refresh();
      navigate(`/programs/${saved.id}#assessment`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="b-page-head">
        <div>
          <p className="b-kicker">Escolha onde pesquisar</p>
          <h1>Programas</h1>
          <p>
            Priorize programas com recompensa e uma aplicação que você consiga
            investigar com profundidade.
          </p>
        </div>
        <button
          className="b-button"
          onClick={() => setShowCatalog(!showCatalog)}
        >
          {showCatalog ? "Ver seus programas" : "Explorar HackerOne"}
          <ArrowRight size={16} />
        </button>
      </div>
      <ErrorNote error={workspace.error || error} />
      {!showCatalog ? (
        <>
          <section className="b-section">
            <div className="b-section-head">
              <h2>Seus programas</h2>
            </div>
            {workspace.isPending ? (
              <Loading />
            ) : workspace.data?.programs.length ? (
              workspace.data.programs.map((p) => (
                <Link
                  className="b-list-row"
                  to={`/programs/${p.id}#assessment`}
                  key={p.id}
                >
                  <div>
                    <strong>{p.name}</strong>
                    <p>
                      {p.inScope.length} regras permitidas ·{" "}
                      {p.scopeConfirmed
                        ? "Escopo conferido"
                        : "Escopo pendente"}
                    </p>
                  </div>
                  <span className="b-badge">
                    {p.offersBounties ? "Recompensa financeira" : "VDP"}
                  </span>
                  <ArrowRight size={16} />
                </Link>
              ))
            ) : (
              <div className="b-empty">
                <h3>Escolha seu primeiro programa</h3>
                <p>Explore o catálogo ou adicione um programa manualmente.</p>
                <button
                  className="b-button"
                  onClick={() => setShowCatalog(true)}
                >
                  Explorar HackerOne
                </button>
              </div>
            )}
          </section>
          <details className="b-section b-disclosure">
            <summary>
              <Plus size={17} /> Adicionar programa manualmente
            </summary>
            <ProgramForm />
          </details>
        </>
      ) : (
        <section className="b-section">
          <div className="b-section-head">
            <h2>
              Catálogo HackerOne <span>{filtered.length}</span>
            </h2>
            <button
              className="b-link-button"
              disabled={catalog.isFetching}
              onClick={() => catalog.refetch()}
            >
              Atualizar catálogo
            </button>
          </div>
          <div className="b-toolbar">
            <label className="b-search">
              <Search size={17} />
              <input
                aria-label="Pesquisar programas"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setLimit(30);
                }}
                placeholder="Buscar por nome do programa"
              />
            </label>
            <label className="b-check">
              <input
                type="checkbox"
                checked={paid}
                onChange={(e) => setPaid(e.target.checked)}
              />
              Com recompensa
            </label>
            <label className="b-check">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => setOpenOnly(e.target.checked)}
              />
              Aceitando relatórios
            </label>
          </div>
          <p className="b-help b-padded">
            O catálogo é uma referência importada. Confira a política oficial e
            os ativos elegíveis para bounty antes de pesquisar.{" "}
            {catalog.data &&
              `Consultado em ${new Date(catalog.data.fetchedAt).toLocaleString("pt-BR")}.`}
          </p>
          <ErrorNote error={catalog.error} />
          {catalog.isFetching ? (
            <Loading />
          ) : (
            filtered.slice(0, limit).map((item) => (
              <div className="b-list-row" key={item.handle}>
                <div>
                  <strong>{item.name}</strong>
                  <p>
                    {item.inScope.length} regras web elegíveis
                    {item.omittedAssets
                      ? ` · ${item.omittedAssets} ativos exigem revisão manual`
                      : ""}
                  </p>
                  <External href={item.url}>Política no HackerOne</External>
                </div>
                <span className="b-badge">
                  {item.offersBounties ? "Bounty" : "VDP"}
                </span>
                <button
                  className="b-button b-secondary"
                  disabled={
                    !!busy ||
                    !item.inScope.length ||
                    workspace.data?.programs.some((p) => p.url === item.url)
                  }
                  onClick={() => add(item)}
                >
                  {busy === item.handle
                    ? "Adicionando…"
                    : workspace.data?.programs.some((p) => p.url === item.url)
                      ? "Adicionado"
                      : "Selecionar e avaliar"}
                </button>
              </div>
            ))
          )}
          {!catalog.isFetching && !catalog.error && !filtered.length && (
            <p className="b-padded b-muted">
              Nenhum programa corresponde aos filtros.
            </p>
          )}
          {filtered.length > limit && (
            <div className="b-padded">
              <button
                className="b-button b-secondary"
                onClick={() => setLimit(limit + 30)}
              >
                Mostrar mais programas
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
