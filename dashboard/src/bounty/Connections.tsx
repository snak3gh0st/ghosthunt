import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { ErrorNote, External } from "./shared";
import type { Integrations } from "./types";

type Catalog = {
  commit: string;
  total: number;
  offset: number;
  results: {
    name: string;
    module: string;
    description: string;
    platform: string;
    hasCheck: boolean;
    sideEffects: string[];
    url: string;
  }[];
};
export default function Connections({ data }: { data: Integrations }) {
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState("");
  const [burp, setBurp] = useState<{
    connected: boolean;
    tools: { name: string }[];
  } | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [query, setQuery] = useState("");
  async function checkBurp() {
    setBusy("burp");
    setError(null);
    try {
      setBurp(await api.post("/bounty/integrations/burp/check"));
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }
  async function search(event?: FormEvent<HTMLFormElement>, offset = 0) {
    event?.preventDefault();
    setBusy("metasploit");
    setError(null);
    try {
      setCatalog(
        await api.get(
          `/bounty/integrations/metasploit?q=${encodeURIComponent(query)}&offset=${offset}`,
        ),
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="b-connections-grid">
      <section className="b-section">
        <div className="b-section-head">
          <h2>Burp MCP</h2>
          <span className="b-badge">
            {(burp?.connected || data.burp.verified)
              ? "Conexão MCP conferida"
              : data.burp.online
                ? "Porta local acessível"
                : "Aguardando Burp"}
          </span>
        </div>
        <div className="b-padded">
          <p>
            Conexão local: <code>{data.burp.url || "Endereço inválido"}</code>
          </p>
          <p className="b-help">
            No Burp, carregue a extensão oficial MCP e habilite o servidor. A
            conexão padrão usa /mcp na porta 9876. Ao iniciar uma leitura,
            confira pedidos de aprovação no Burp. O Ghosthunt lê histórico e issues
            existentes e filtra pelo escopo do programa.
          </p>
          <External href="https://github.com/PortSwigger/mcp-server">
            Extensão oficial e instalação
          </External>
          <p>
            <button
              className="b-button b-secondary"
              onClick={checkBurp}
              disabled={!!busy}
            >
              {busy === "burp"
                ? "Conectando ao Burp…"
                : "Testar conexão Burp MCP"}
            </button>
          </p>
          {burp && (
            <p className="b-help">
              Ferramentas de leitura disponíveis:{" "}
              {burp.tools.map((t) => t.name).join(", ") ||
                "nenhuma reconhecida nesta edição/extensão"}
              .
            </p>
          )}
        </div>
      </section>
      <section className="b-section">
        <div className="b-section-head">
          <h2>OpenAI API</h2>
          <span className="b-badge">
            {data.openai.configured
              ? data.cloudAdvisorReady ? "Credencial configurada" : "Chave pronta · VPN pendente"
              : "Criação da chave pendente"}
          </span>
        </div>
        <div className="b-padded">
          <p>
            Modelo configurado: <code>{data.openai.model}</code>
          </p>
          <p className="b-help">
            Selecione OpenAI API no assistente do programa depois de conectar a VPN protegida. O processamento local continua como
            opção inicial. A presença da credencial não confirma acesso ao
            modelo ou saldo. Tokens são registrados; consultas sem preço
            informado aparecem separadas no painel.
          </p>
        </div>
      </section>
      <section className="b-section">
        <div className="b-section-head">
          <h2>Metasploit</h2>
          <span className="b-badge">
            {data.metasploit.catalogInstalled
              ? "Catálogo instalado"
              : "Catálogo pendente"}
          </span>
        </div>
        <div className="b-padded">
          <p className="b-help">
            Pesquise nomes de produtos, tecnologias ou CVEs no catálogo oficial
            de módulos. Os resultados são referências para investigação, sem
            confirmação de vulnerabilidade no seu alvo. Esta integração consulta
            metadados; não inicia exploits ou sessões.
          </p>
          <form className="b-form" onSubmit={(event) => void search(event)}>
            <label>
              Pesquisar módulos Metasploit
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                required
                minLength={2}
                maxLength={120}
                placeholder="Ex.: nginx ou CVE-2021-41773"
              />
            </label>
            <button
              className="b-button b-secondary"
              disabled={!!busy || !data.metasploit.catalogInstalled}
            >
              {busy === "metasploit"
                ? "Pesquisando…"
                : "Pesquisar catálogo Metasploit"}
            </button>
          </form>
          {catalog && (
            <>
              <p className="b-help">
                {catalog.total} módulos encontrados · fonte fixada em{" "}
                {catalog.commit.slice(0, 12)} · resultados{" "}
                {catalog.total ? catalog.offset + 1 : 0} a{" "}
                {Math.min(catalog.offset + 20, catalog.total)}.
              </p>
              {catalog.results.map((item) => (
                <details className="b-run" key={item.module}>
                  <summary>
                    <strong>{item.name}</strong>
                  </summary>
                  <p>
                    <code>{item.module}</code>
                  </p>
                  <p>{item.description}</p>
                  <p className="b-help">
                    Plataforma: {item.platform || "não informada"} · rotina
                    check no upstream: {item.hasCheck ? "sim" : "não"} · efeitos
                    declarados:{" "}
                    {item.sideEffects.join(", ") || "não informados"}.
                  </p>
                  <External href={item.url}>
                    Ver módulo na fonte oficial
                  </External>
                </details>
              ))}
              <div className="b-form-grid">
                <button
                  className="b-button b-secondary"
                  disabled={!!busy || catalog.offset === 0}
                  onClick={() =>
                    void search(undefined, Math.max(0, catalog.offset - 20))
                  }
                >
                  Resultados anteriores
                </button>
                <button
                  className="b-button b-secondary"
                  disabled={!!busy || catalog.offset + 20 >= catalog.total}
                  onClick={() => void search(undefined, catalog.offset + 20)}
                >
                  Próximos resultados
                </button>
              </div>
            </>
          )}
        </div>
      </section>
      <ErrorNote error={error} />
    </div>
  );
}
