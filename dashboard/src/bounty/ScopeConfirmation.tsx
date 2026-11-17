import {useState,type FormEvent} from "react";
import {CheckCircle2} from "lucide-react";
import {api} from "../lib/api";
import {useRefresh,useScopeReview} from "./data";
import {ErrorNote,External,Loading} from "./shared";
import ProgramForm from "./ProgramForm";
import type {Program} from "./types";
export default function ScopeConfirmation({program}:{program:Program}) {
 const query=useScopeReview(program.id),refresh=useRefresh(),review=query.data;
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
 async function confirm(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!review)return;const form=new FormData(event.currentTarget);setBusy(true);setError(null);try{await api.post(`/bounty/programs/${program.id}/scope/confirm`,{reviewToken:review.reviewToken,policyReviewed:form.has("confirmOfficialScope"),preserveUnsupported:form.has("preserveUnsupported")});await refresh();}catch(e){setError(e);await query.refetch();}finally{setBusy(false);}}
 return <section className="b-section b-scope-confirmation" id="scope-review" aria-label="Confirmar escopo do programa">
  <div className="b-section-head"><h2>1. Escopo do programa</h2><span className="b-badge">{review?.confirmed?`Confirmado · v${program.scopeVersion}`:"Confirmação pendente"}</span></div>
  <div className="b-padded"><p className="b-help">Confira os ativos exatos, exclusões e política oficial. Confirmar este escopo permite avaliar o plano; a execução depende da aprovação do plano e das permissões cadastradas.</p><External href={program.url}>Abrir política oficial do programa</External></div>
  <ErrorNote error={error||query.error}/>{query.isPending&&<Loading/>}
  {review&&<><div className="b-scope-review-grid"><div><h3>Ativos permitidos · {review.inScope.length}</h3><ul>{review.inScope.map(rule=><li key={rule}><code>{rule}</code></li>)}</ul></div><div><h3>Exclusões · {review.outOfScope.length}</h3>{review.outOfScope.length?<ul>{review.outOfScope.map(rule=><li key={rule}><code>{rule}</code></li>)}</ul>:<p className="b-help">Nenhuma exclusão cadastrada. Confira a política completa.</p>}</div></div>
  {!!(review.unsupported.length||review.references.length)&&<div className="b-review-pendencies"><h3>Referências fora do executor web</h3><ul>{[...review.references,...review.unsupported].map((item,i)=><li key={`${item.kind}-${item.identifier}-${i}`}><code>{item.identifier}</code> · {item.reason}</li>)}</ul></div>}
  {review.confirmed?<p className="b-success b-padded" role="status"><CheckCircle2 size={16}/>Escopo confirmado. Continue na avaliação abaixo.</p>:<form className="b-form" key={review.reviewToken} onSubmit={confirm}><label className="b-check"><input type="checkbox" name="confirmOfficialScope" required/>Conferi estes ativos, exclusões e regras na página oficial e quero confirmar este escopo</label>{!!review.unsupported.length&&<label className="b-check"><input type="checkbox" name="preserveUnsupported" required/>Preservar os identificadores não web como referência, sem executá-los como domínios ou IPs</label>}<button className="b-button" disabled={busy||!review.inScope.length}>{busy?"Confirmando escopo…":"Confirmar escopo"}</button></form>}
  </>}
  <details className="b-scope-edit" open={!program.policy.trim()||undefined}><summary>Editar escopo e permissões</summary><ProgramForm key={program.updatedAt} program={program}/></details>
 </section>;
}
