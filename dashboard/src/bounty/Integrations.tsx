import { RefreshCw } from "lucide-react";
import { ErrorNote, External, Loading } from "./shared";
import { useIntegrations } from "./data";
import IsolationPanel from "./IsolationPanel";
import Connections from "./Connections";
import { Link } from "react-router-dom";

const references = [
  [
    "Programas e escopo",
    "arkadiyt/bounty-targets-data",
    "Catálogo HackerOne conectado",
  ],
  [
    "Programas e escopo",
    "projectdiscovery/public-bugbounty-programs",
    "Fonte complementar",
  ],
  ["Programas e escopo", "disclose/diodb", "Fonte complementar"],
  ["Reconhecimento", "blacklanternsecurity/bbot", "Avaliação futura"],
  ["Reconhecimento", "projectdiscovery/katana", "Crawling sob demanda"],
  ["Reconhecimento", "projectdiscovery/httpx", "Identificação de serviços"],
  ["Reconhecimento", "xnl-h4ck3r/waymore", "Respostas históricas"],
  [
    "Reconhecimento",
    "xnl-h4ck3r/xnLinkFinder",
    "Endpoints e parâmetros; licença a conferir",
  ],
  [
    "Investigação",
    "PortSwigger/mcp-server",
    "Conexão local com Burp MCP; estado verificado no painel",
  ],
  ["Investigação", "gitleaks/gitleaks", "Análise local de segredos"],
  ["Investigação", "projectdiscovery/interactsh", "Interações fora de banda"],
  [
    "Investigação",
    "projectdiscovery/nuclei",
    "Templates selecionados conforme política",
  ],
  ["Conhecimento", "OWASP/wstg", "Metodologia e cobertura"],
  ["Conhecimento", "danielmiessler/SecLists", "Listas específicas por teste"],
  ["Conhecimento", "swisskyrepo/PayloadsAllTheThings", "Referência técnica"],
  ["Alternativas", "j3ssie/osmedeus", "Orquestração"],
  ["Alternativas", "six2dez/reconftw", "Orquestração"],
  ["Alternativas", "yogeshojha/rengine", "Referência de plataforma"],
  ["Alternativas", "GreyDGL/PentestGPT", "Comparação de assistentes"],
  ["Alternativas", "usestrix/strix", "Comparação de executores"],
];
export default function Integrations() {
  const query = useIntegrations();
  if (query.isPending) return <Loading />;
  if (!query.data) return <ErrorNote error={query.error} />;
  const data = query.data;
  return (
    <>
      <div className="b-page-head">
        <div>
          <p className="b-kicker">Conhecimento e execução</p>
          <h1>Ferramentas e fontes</h1>
          <p>
            Veja o que está conectado, o que é referência e o que ainda precisa
            de configuração.
          </p>
        </div>
        <button
          className="b-button b-secondary"
          disabled={query.isFetching}
          onClick={() => query.refetch()}
        >
          <RefreshCw size={15} />
          Verificar instalação
        </button>
      </div>
      <ErrorNote error={query.error} />
      <div className="b-integration-navigation"><p>Inicie um pentest para instalar as ferramentas e conferir os requisitos do escopo selecionado.</p><Link className="b-button b-secondary" to="/">Abrir command center</Link></div>
      <IsolationPanel data={data} refresh={() => query.refetch()} />
      <Connections data={data} />
      {data.toolkit && <section className="b-section" aria-label="Inventário real do container"><div className="b-section-head"><h2>Arsenal no executor Docker</h2><span className="b-badge">{data.toolkit.installed.length}/{data.toolkit.expected.length} instalados</span></div><p className="b-help b-padded">Inventário consultado dentro da imagem de análise, separado do Mac. Instalação e execução automática são verificações diferentes: a investigação executa os adaptadores compatíveis e autorizados; outros utilitários permanecem disponíveis no arsenal.</p>{data.toolkit.expected.map(id=><div className="b-list-row" key={id}><strong>{id}</strong><span className="b-badge">{data.toolkit!.installed.includes(id)?"Instalado no Docker":"Ausente na imagem"}</span></div>)}{data.toolkit.legacy.map(item=><div className="b-list-row" key={item.id}><div><strong>{item.id} → {item.replacement}</strong><p>{item.reason}</p></div><span className="b-badge">Nome legado</span></div>)}{data.zap&&<div className="b-list-row"><div><strong>ZAP oficial</strong><p>Imagem separada em Docker; o serviço e os scans não são iniciados pela instalação.</p></div><span className="b-badge">{data.zap.installed?"Imagem instalada":"Imagem pendente"}</span></div>}</section>}
      {data.native && <details className="b-section b-reference-library">
        <summary>Core nativo e engines externos <span>Python {data.native.python || "indisponível"} · {data.native.engines.length} opções</span></summary>
        <p className="b-help b-padded">Os controles de sessão executam a CLI deste projeto. As saídas ficam nas evidências do programa. A presença do código de um engine não confirma que suas dependências estão prontas.</p>
        {data.native.engines.map((engine) => <div className="b-list-row" key={engine.id}><div><strong>{engine.id}</strong><p>{engine.role}</p></div><span className="b-badge">{engine.available ? "Fonte / executável presente" : "Engine externo não habilitado"}</span></div>)}
      </details>}
      <section className="b-section">
        <div className="b-section-head">
          <h2>Integrações conectadas</h2>
        </div>
        {data.integrations.map((item) => (
          <div className="b-list-row" key={item.id}>
            <div>
              <External href={`https://github.com/${item.repository}`}>
                {item.name}
              </External>
              <p>Versão fixada: {item.commit.slice(0, 12)} · MIT / CC BY 4.0</p>
            </div>
            <span className={`b-badge ${item.installed ? "b-completed" : ""}`}>
              {item.installed ? "Instalado e conferido" : "Instalação pendente"}
            </span>
          </div>
        ))}
        <div className="b-list-row">
          <div>
            <strong>Claude Code</strong>
            <p>
              A autenticação é feita no CLI. A presença do executável não
              confirma saldo ou acesso à IA.
            </p>
          </div>
          <span className="b-badge">
            {data.claudeAvailable ? "CLI encontrado" : "CLI não encontrado"}
          </span>
        </div>
        {data.localRuntimes.map((runtime) => (
          <div className="b-list-row" key={runtime.backend}>
            <div>
              <strong>
                {runtime.backend === "ollama"
                  ? "Ollama local"
                  : "LM Studio local"}
              </strong>
              <p>
                {runtime.models.length
                  ? runtime.models.map((model) => model.model).join(", ")
                  : runtime.online
                    ? "Servidor disponível. Nenhum modelo de chat encontrado."
                    : "Servidor local indisponível."}
              </p>
            </div>
            <span className="b-badge">
              {runtime.models.length
                ? "Pronto para consultas locais"
                : runtime.online
                  ? "Sem modelo"
                  : "Offline"}
            </span>
          </div>
        ))}
      </section>
      <details className="b-section b-reference-library">
        <summary>Biblioteca de repositórios <span>Referências e integrações futuras</span></summary>
        <div className="b-section-head">
          <h2>Biblioteca de repositórios</h2>
          <span className="b-muted">Referências e integrações futuras</span>
        </div>
        <p className="b-help b-padded">
          Esta lista não significa que todas as ferramentas estão instaladas.
          Ative executores conforme a necessidade e as regras de cada programa.
        </p>
        {references.map(([group, repo, note]) => (
          <div className="b-list-row" key={repo}>
            <div>
              <External href={`https://github.com/${repo}`}>{repo}</External>
              <p>{note}</p>
            </div>
            <span className="b-muted">{group}</span>
          </div>
        ))}
      </details>
    </>
  );
}
