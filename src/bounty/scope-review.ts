import {createHash} from "node:crypto";
import {validScopeRule} from "./scope.js";
import type {Program} from "./model.js";
export function scopeReview(program: Program, knownReferences: NonNullable<Program["scopeReferences"]> = []) {
  const nonWebReferences=[...(program.scopeReferences || []),...knownReferences].filter(item=>/APPLE_STORE_APP_ID|GOOGLE_PLAY_APP_ID/.test(item.reason));
  const supported=(rule:string,kind:"in"|"out")=>validScopeRule(rule)&&!nonWebReferences.some(item=>item.kind===kind&&item.identifier===rule);
  const unsupported = (["in", "out"] as const).flatMap(kind => (kind === "in" ? program.inScope : program.outOfScope).filter(rule=>!supported(rule,kind)).map(identifier=>({identifier,kind,reason:nonWebReferences.find(item=>item.kind===kind&&item.identifier===identifier)?.reason || "Formato não suportado pelo executor web; preservado como referência."})));
  return { scopeVersion:program.scopeVersion, confirmed:program.scopeConfirmed && unsupported.length===0,
    inScope:program.inScope.filter(rule=>supported(rule,"in")),outOfScope:program.outOfScope.filter(rule=>supported(rule,"out")),unsupported,references:program.scopeReferences || [],
    reviewToken:createHash("sha256").update(JSON.stringify({version:program.scopeVersion,url:program.url,policy:program.policy,inScope:program.inScope,outOfScope:program.outOfScope,unsupported})).digest("hex") };
}
