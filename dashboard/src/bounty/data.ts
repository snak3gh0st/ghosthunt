import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Integrations, Workspace, AssessmentState, ScopeReview } from "./types";

export const statusLabels: Record<string, string> = {
  hypothesis: "Hipótese",
  validated: "Validado",
  ready: "Pronto para enviar",
  submitted: "Enviado",
  triaged: "Em triagem",
  duplicate: "Duplicado",
  rejected: "Não aceito",
  paid: "Pago",
  running: "Em execução",
  completed: "Concluído",
  failed: "Falhou",
  interrupted: "Interrompido",
};
export const currency = (cents: number, code = "USD") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(
    cents / 100,
  );
export const date = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export function useWorkspace() {
  return useQuery({
    queryKey: ["bounty-workspace"],
    queryFn: () => api.get<Workspace>("/bounty/workspace"),
    refetchInterval: (query) =>
      query.state.data?.runs.some((r) => r.status === "running") ? 2000 : false,
  });
}
export function useIntegrations() {
  return useQuery({
    queryKey: ["bounty-integrations"],
    queryFn: () => api.get<Integrations>("/bounty/integrations"),
    staleTime: 30000,
  });
}
export function usePentest(programId?: string) {
  return useQuery({ queryKey: ["bounty-pentest", programId], enabled: !!programId, queryFn: () => api.get<{ installed: boolean; status: string; scopeVersion: number; blockers: string[] } | null>(`/bounty/programs/${programId}/pentest`), refetchInterval: 3000 });
}
export function useAssessment(programId?: string) {
  return useQuery({ queryKey: ["bounty-assessment", programId], enabled: !!programId, queryFn: () => api.get<AssessmentState>(`/bounty/programs/${programId}/assessment`) });
}
export function useScopeReview(programId: string) { return useQuery({queryKey:["bounty-scope-review",programId],queryFn:()=>api.get<ScopeReview>(`/bounty/programs/${programId}/scope-review`)}); }
export function useRefresh() {
  const query = useQueryClient();
  return () => query.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("bounty-") });
}

export async function downloadReport(id: string, final = false) {
  const response = await fetch(
    `/api/bounty/findings/${id}/report${final ? "?final=true" : ""}`,
    { headers: { "x-api-key": localStorage.getItem("ghosthunt_api_key") || "" } },
  );
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Falha ao exportar relatório.");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `hackerone-${id}${final ? "" : "-draft"}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
