import { isIP } from "node:net";
import { BountyError, type Program } from "./model.js";

function parsed(raw: string): URL | null {
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const authority = (raw.includes("://") ? raw.split("://")[1] : raw).split(/[/?#]/, 1)[0];
    const rawHost = authority.replace(/:\d+$/, "");
    // URL canonicalization must not turn app-store IDs, hex or short numeric hosts into IP scope.
    if (isIP(url.hostname) === 4 && isIP(rawHost) !== 4) return null;
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export function validScopeRule(rule: string): boolean {
  if (/[\s\\?#]/.test(rule) || rule.startsWith("-")) return false;
  const value = rule
    .replace("://*.", "://wildcard.")
    .replace(/^\*\./, "wildcard.");
  if (value.includes("*")) return false;
  const url = parsed(value);
  return (
    !!url &&
    (!!isIP(url.hostname) ||
      /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+\.?$/i.test(
        url.hostname,
      ))
  );
}

export function matchesRule(target: string, rule: string): boolean {
  if (!validScopeRule(rule)) return false;
  const url = parsed(target);
  const explicitScheme = rule.includes("://");
  const wildcard = /^(?:https?:\/\/)?\*\./i.test(rule);
  const ruleUrl = parsed(rule.replace("://*.", "://").replace(/^\*\./, ""));
  if (!url || !ruleUrl) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const base = ruleUrl.hostname.toLowerCase().replace(/\.$/, "");
  if (wildcard ? !(host.endsWith(`.${base}`) && host !== base) : host !== base)
    return false;
  if (explicitScheme && url.protocol !== ruleUrl.protocol) return false;
  // A scheme pins the origin, including its effective port. Bare rules with an explicit port pin it too.
  if ((explicitScheme || ruleUrl.port) && url.port !== ruleUrl.port)
    return false;
  const path = ruleUrl.pathname.replace(/\/$/, "");
  let targetPath: string;
  try {
    targetPath = url.pathname;
    for (let count = 0; count < 4; count++) {
      const decoded = decodeURIComponent(targetPath);
      if (decoded === targetPath) break;
      targetPath = decoded;
    }
  } catch {
    return false;
  }
  if (targetPath.includes("\\") || /(?:^|\/)\.\.?(?:\/|$)/.test(targetPath))
    return false;
  return !path || targetPath === path || targetPath.startsWith(`${path}/`);
}

export function inScope(
  target: string,
  program: Pick<Program, "inScope" | "outOfScope">,
): boolean {
  return (
    !program.outOfScope.some((rule) => matchesRule(target, rule)) &&
    program.inScope.some((rule) => matchesRule(target, rule))
  );
}

export function requireScope(program: Program, target: string): void {
  if (!program.scopeConfirmed)
    throw new BountyError(
      409,
      "Confirme o escopo na página oficial do programa antes de continuar.",
    );
  if (!inScope(target, program))
    throw new BountyError(
      422,
      "O alvo não pertence ao escopo permitido, ou está em uma exclusão.",
    );
}
