import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import { CheckCircle2, Copy, Download } from "lucide-react";
import { api } from "../lib/api";
import { date, downloadReport, useRefresh } from "./data";
import { ErrorNote, Loading } from "./shared";
import type { Finding, ReportPreview } from "./types";

export default function ReportReview({ finding }: { finding: Finding }) {
  const refresh = useRefresh();
  const query = useQuery({ queryKey: ["bounty-report", finding.id, finding.updatedAt], queryFn: () => api.get<ReportPreview>(`/bounty/findings/${finding.id}/report/preview`) });
  const [busy, setBusy] = useState(""), [error, setError] = useState<unknown>(null), [mode, setMode] = useState("preview"), [reviewed, setReviewed] = useState("");
  const preview = query.data;
  async function action(kind: "validate" | "approve" | "copy" | "draft" | "final") {
    if (!preview) return;
    setBusy(kind); setError(null);
    try {
      if (kind === "validate") await api.post(`/bounty/findings/${finding.id}/status`, { status: "validated" });
      else if (kind === "approve") await api.post(`/bounty/findings/${finding.id}/report/approve`, { revision: preview.revision });
      else if (kind === "copy") await navigator.clipboard.writeText(preview.markdown);
      else await downloadReport(finding.id, kind === "final");
      if (kind === "approve" || kind === "validate") await refresh();
    } catch (e) { setError(e); } finally { setBusy(""); }
  }
  return <section className="b-section b-report-review" aria-label="Revisão do relatório">
    <div className="b-section-head"><h2>Relatório para revisão</h2><span className="b-badge">{preview?.approved ? "Versão aprovada" : "Rascunho"}</span></div>
    <div className="b-report-controls"><div role="group" aria-label="Formato do relatório"><button className="b-button b-secondary" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>Prévia renderizada</button><button className="b-button b-secondary" aria-pressed={mode === "source"} onClick={() => setMode("source")}>Markdown</button></div><button className="b-button b-secondary" disabled={!preview || !!busy} onClick={() => void action("copy")}><Copy size={14} />Copiar Markdown</button></div>
    <ErrorNote error={error || query.error} />
    {query.isPending && <Loading />}
    {preview && <>
      <div className="b-padded"><p className="b-help">Conteúdo salvo e evidências do achado. Revise em inglês, valide a reprodução e aprove a versão antes de exportar para envio manual ao HackerOne.</p><code className="b-report-revision">Versão {preview.revision.slice(0, 12)}</code></div>
      {!!preview.gaps.length && <div className="b-review-pendencies" role="status"><h3>Pendências para aprovação · {preview.gaps.length}</h3><ul>{preview.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
      {mode === "preview" ? <article className="b-report-document" aria-label="Conteúdo renderizado do relatório"><Markdown skipHtml disallowedElements={["img"]} components={{ a: ({ href, children }) => <a href={href && /^https?:\/\//i.test(href) ? href : undefined} target="_blank" rel="noopener noreferrer">{children}</a> }}>{preview.markdown}</Markdown></article> : <pre className="b-report-source">{preview.markdown}</pre>}
      <div className="b-form b-report-approval">
        {preview.approved ? <p className="b-success"><CheckCircle2 size={16} />Versão aprovada em {date(preview.approvedAt!)}. Alterações exigem uma nova revisão.</p> : <>
          {finding.status === "hypothesis" && <button className="b-button" disabled={!!busy || !!preview.gaps.length} onClick={() => void action("validate")}>Validar achado documentado</button>}
          {finding.status === "validated" && <><label className="b-check"><input type="checkbox" checked={reviewed === preview.revision} onChange={e => setReviewed(e.target.checked ? preview.revision : "")} />Revisei esta versão, o impacto e as evidências para envio</label><button className="b-button" disabled={!!busy || !!preview.gaps.length || reviewed !== preview.revision} onClick={() => void action("approve")}>{busy === "approve" ? "Aprovando…" : "Aprovar relatório para envio"}</button></>}
        </>}
        <div className="b-report-controls"><button className="b-button b-secondary" disabled={!!busy} onClick={() => void action("draft")}><Download size={14} />Baixar rascunho</button><button className="b-button" disabled={!!busy || !preview.approved || !!preview.gaps.length} onClick={() => void action("final")}><Download size={14} />Baixar relatório aprovado</button></div>
      </div>
    </>}
  </section>;
}
