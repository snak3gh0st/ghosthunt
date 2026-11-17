import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { ErrorNote, External } from "./shared";
import { useRefresh } from "./data";
import type { Program } from "./types";

export default function ProgramForm({ program }: { program?: Program }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const refresh = useRefresh();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    const lines = (key: string) =>
      String(form.get(key) || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    const body = {
      name: form.get("name"),
      url: form.get("url"),
      offersBounties: form.has("offersBounties"),
      bountyNote: form.get("bountyNote"),
      inScope: lines("inScope"),
      outOfScope: lines("outOfScope"),
      policy: form.get("policy"),
      focus: form.get("focus"),
      automationAllowed: form.has("automationAllowed"),
      activeTestingAllowed: form.has("activeTestingAllowed"),
      portScanAllowed: form.has("portScanAllowed"),
      scopeConfirmed: form.has("scopeConfirmed"),
      scopeReferences: program?.scopeReferences,
    };
    try {
      const saved = program
        ? await fetch(`/api/bounty/programs/${program.id}`, {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              "x-api-key": localStorage.getItem("ghosthunt_api_key") || "",
            },
            body: JSON.stringify(body),
          }).then(async (r) => {
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            return d as Program;
          })
        : await api.post<Program>("/bounty/programs", body);
      await refresh();
      navigate(`/programs/${saved.id}#assessment`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="b-form" onSubmit={submit}>
      <div className="b-form-grid">
        <label>
          Nome do programa
          <input
            name="name"
            defaultValue={program?.name}
            required
            maxLength={150}
          />
        </label>
        <label>
          Página oficial
          <input
            name="url"
            type="url"
            defaultValue={program?.url}
            placeholder="https://hackerone.com/programa"
            required
          />
        </label>
      </div>
      {program && (
        <External href={program.url}>Abrir a política oficial</External>
      )}
      <div className="b-form-grid">
        <label>
          Ativos permitidos, um por linha
          <textarea
            name="inScope"
            defaultValue={program?.inScope.join("\n")}
            placeholder={
              "api.example.com\n*.example.com\nhttps://example.com/app"
            }
            rows={4}
            required
          />
        </label>
        <label>
          Ativos excluídos, um por linha
          <textarea
            name="outOfScope"
            defaultValue={program?.outOfScope.join("\n")}
            rows={4}
            placeholder="admin.example.com"
          />
        </label>
      </div>
      <p className="b-help">
        Domínio exato não inclui subdomínios. Use *.example.com quando a
        política permitir. URLs também restringem protocolo, porta e caminho.
      </p>
      <label>
        Regras e restrições do programa
        <textarea
          name="policy"
          defaultValue={program?.policy}
          rows={5}
          maxLength={12000}
          placeholder="Tipos de teste permitidos, limites de requisições e requisitos do programa."
        />
      </label>
      <div className="b-form-grid">
        <label>
          Valores e condições de recompensa
          <input
            name="bountyNote"
            defaultValue={program?.bountyNote}
            maxLength={1000}
            placeholder="Registre somente informações publicadas pelo programa"
          />
        </label>
        <label>
          Foco da sua pesquisa
          <input
            name="focus"
            defaultValue={program?.focus}
            maxLength={2000}
            placeholder="Ex.: permissões entre duas contas de teste"
          />
        </label>
      </div>
      <label className="b-check">
        <input
          type="checkbox"
          name="offersBounties"
          defaultChecked={program?.offersBounties}
        />
        O programa oferece recompensas financeiras
      </label>
      <label className="b-check">
        <input
          type="checkbox"
          name="automationAllowed"
          defaultChecked={program?.automationAllowed}
        />
        A política permite a coleta automatizada que vou utilizar
      </label>
      <label className="b-check">
        <input
          type="checkbox"
          name="activeTestingAllowed"
          defaultChecked={program?.activeTestingAllowed}
        />
        A política permite consultas ativas pontuais de HTTP e DNS
      </label>
      <label className="b-check"><input type="checkbox" name="portScanAllowed" defaultChecked={program?.portScanAllowed} />A política permite teste automatizado de conexão TCP na porta do ativo (Nmap)</label>
      <label className="b-check">
        <input
          type="checkbox"
          name="scopeConfirmed"
          defaultChecked={program?.scopeConfirmed}
        />
        Conferi os ativos, exclusões e regras na página oficial do programa
      </label>
      <ErrorNote error={error} />
      <button className="b-button" disabled={busy}>
        {busy
          ? "Salvando…"
          : program
            ? "Salvar programa e escopo"
            : "Adicionar programa"}
      </button>
    </form>
  );
}
