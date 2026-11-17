import { useState } from "react";
import type { Integrations } from "./types";

export default function AdviceProvider({
  integrations,
}: {
  integrations: Integrations;
}) {
  const [provider, setProvider] = useState(integrations.defaultProvider);
  return (
    <>
      <div className="b-form-grid">
        <label>
          Onde executar a IA
          <select
            name="provider"
            value={provider}
            onChange={(e) =>
              setProvider(e.target.value as "local" | "claude" | "openai")
            }
          >
            <option value="local">
              Local · sem consumo de API
              {!integrations.localModels.length ? " · indisponível" : ""}
            </option>
            <option value="claude" disabled>
              Claude Code · aguardando rede protegida
            </option>
            <option value="openai" disabled={!integrations.openai.configured || !integrations.cloudAdvisorReady}>
              OpenAI API ·{" "}
              {integrations.openai.configured
                ? integrations.cloudAdvisorReady ? integrations.openai.model : "chave pronta, VPN pendente"
                : "chave pendente"}
            </option>
          </select>
        </label>
        {provider === "local" && integrations.localModels.length > 0 && (
          <label>
            Modelo local
            <select
              name="localModel"
              defaultValue={integrations.localModels[0]?.id}
              required
            >
              {integrations.localModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.model} ·{" "}
                  {model.backend === "ollama" ? "Ollama" : "LM Studio"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {provider === "local" && !integrations.localModels.length && (
        <p className="b-notice">
          Nenhum modelo local está disponível. Inicie o Ollama ou LM Studio e
          atualize Ferramentas e fontes. O uso de assistentes cloud aguarda encaminhamento pela rede protegida.
        </p>
      )}
      <p className="b-help">
        {provider === "local"
          ? "Processa no seu computador com contexto resumido. No Ollama, o modelo é descarregado após a resposta. Se falhar, o Ghosthunt mostra o erro e mantém a escolha local."
          : provider === "openai"
            ? "Envia o contexto selecionado à OpenAI API por um container e pela VPN, com resposta limitada a 1500 tokens. Registra tokens utilizados; o custo deve ser conferido na conta OpenAI. Revise os dados antes de consultar."
            : "Envia o contexto e referências à sua sessão do Claude Code. Limite configurado: US$ 0,50 por consulta. Revise os dados antes de compartilhá-los com a IA."}
      </p>
    </>
  );
}
