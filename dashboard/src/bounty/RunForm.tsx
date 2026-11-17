import { useState, type FormEvent } from "react";
import { Play } from "lucide-react";
import {
  githubRepository,
  recommendedTool,
  toolIncompatibility,
} from "../../../src/bounty/targets";
import type { Integrations, Program } from "./types";

export default function RunForm({
  program,
  tools,
  busy,
  prepared = false,
  assessed = false,
  onSubmit,
}: {
  program: Program;
  tools: Integrations["tools"];
  busy: string;
  prepared?: boolean;
  assessed?: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const initial = program.inScope.find((rule) => !rule.includes("*")) || "";
  const [target, setTarget] = useState(
    initial
      ? initial.startsWith("http")
        ? initial
        : `https://${initial}`
      : "",
  );
  const [selection, setSelection] = useState("");
  const options = tools.filter((tool) => !["pentest-prepare","investigation"].includes(tool.id)).map((tool) => ({
    ...tool,
    reason:
      (!assessed && !tool.id.startsWith("ghosthunt-") ? "É necessário avaliar o programa e aprovar o plano." : null) ||
      (!prepared && !tool.id.startsWith("ghosthunt-") && !tool.id.startsWith("burp-") ? "Inicie o pentest deste programa primeiro." : null) || tool.blockedReason || toolIncompatibility(tool.id, target, program.inScope) ||
      (tool.mode === "active" && !program.activeTestingAllowed
        ? "Confirme a permissão para consultas ativas nas regras do programa."
        : null) ||
      (tool.id === "nmap" && !program.portScanAllowed ? "Permissão de conexão TCP na porta do ativo pendente." : null) ||
      (tool.mode !== "offline" &&
      tool.mode !== "import" &&
      !program.automationAllowed
        ? "Confirme a permissão de coleta nas regras do programa."
        : null),
  }));
  const available = options.filter((tool) => tool.installed && !tool.reason);
  const selected =
    available.find((tool) => tool.id === selection)?.id ||
    available.find((tool) => tool.id === recommendedTool(target))?.id ||
    available[0]?.id ||
    "";
  const repository = githubRepository(target);
  return (
    <form className="b-form" onSubmit={onSubmit}>
      <div className="b-form-grid">
        <label>
          Ferramenta
          <select
            name="tool"
            aria-label="Ferramenta"
            value={selected}
            onChange={(event) => setSelection(event.target.value)}
            required
          >
            {!selected && <option value="">Informe um alvo compatível</option>}
            {options.map((tool) => (
              <option
                key={tool.id}
                value={tool.id}
                disabled={!tool.installed || !!tool.reason}
                title={tool.reason || undefined}
              >
                {tool.name} ·{" "}
                {tool.mode === "source"
                  ? "revisão de código"
                  : tool.mode === "import"
                    ? "leitura do Burp"
                    : tool.mode === "active"
                      ? "consulta ativa"
                      : tool.mode === "offline"
                        ? "classificação offline"
                        : "coleta passiva"}
                {!tool.installed
                  ? " · indisponível"
                  : tool.reason
                    ? " · incompatível"
                    : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          URL dentro do escopo
          <input
            name="target"
            type="url"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            required
            placeholder="https://api.example.com"
          />
        </label>
      </div>
      <p className="b-help">
        {repository
          ? "Alvo de código: a revisão lê uma amostra de arquivos públicos em uma versão fixada, sem executar o código. Subfinder e URLFinder não se aplicam a este repositório."
          : "Coletas passivas consultam fontes públicas. HTTPx consulta somente a URL informada, sem seguir redirecionamentos; DNSx consulta somente o host. Burp MCP lê dados já coletados no Burp. Confira as permissões nas regras do programa."}{" "}
        Os resultados são observações para investigar, sem confirmação
        automática de vulnerabilidade.
      </p>
      <button
        className="b-button b-secondary"
        disabled={!!busy || !program.scopeConfirmed || !selected}
      >
        <Play size={15} />
        {busy === "run" ? "Iniciando…" : "Iniciar execução"}
      </button>
    </form>
  );
}
