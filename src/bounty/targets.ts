/** Pure target classification shared by the server and dashboard. */
export interface GitHubRepository {
  owner: string;
  name: string;
  fullName: string;
}
export function githubRepository(target: string): GitHubRepository | null {
  try {
    const url = new URL(target);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    const match = /^\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/.exec(
      url.pathname,
    );
    if (
      !match ||
      match[1] === "." ||
      match[1] === ".." ||
      match[2] === "." ||
      match[2] === ".."
    )
      return null;
    const name = match[2].replace(/\.git$/, "");
    if (!name) return null;
    return { owner: match[1], name, fullName: `${match[1]}/${name}` };
  } catch {
    return null;
  }
}

function coversOrigin(rule: string, target: URL): boolean {
  try {
    const explicitScheme = rule.includes("://");
    const wildcard = /^(?:https?:\/\/)?\*\./i.test(rule);
    const normalized = rule.replace("://*.", "://").replace(/^\*\./, "");
    const url = new URL(explicitScheme ? normalized : `https://${normalized}`);
    const host = target.hostname.replace(/\.$/, "").toLowerCase();
    const base = url.hostname.replace(/\.$/, "").toLowerCase();
    return (
      (wildcard ? host.endsWith(`.${base}`) && host !== base : host === base) &&
      (!explicitScheme || target.protocol === url.protocol) &&
      (!(explicitScheme || url.port) || target.port === url.port) &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function toolIncompatibility(
  tool: string,
  target: string,
  inScope: string[],
): string | null {
  if (tool === "pentest-prepare") return null;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return "Informe uma URL HTTP(S) válida dentro do escopo.";
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    return "Informe uma URL HTTP(S) sem credenciais ou fragmentos.";
  if (["ghosthunt-status", "ghosthunt-doctor", "ghosthunt-engines", "ghosthunt-playbooks", "ghosthunt-report", "cbh-classify"].includes(tool)) return null;
  if (tool === "investigation") return null;
  if (tool === "burp-history" || tool === "burp-issues")
    return githubRepository(target)
      ? "Use um ativo web para filtrar as evidências do Burp."
      : null;
  if (["repo-review","repo-secrets","repo-semgrep","repo-trufflehog"].includes(tool))
    return githubRepository(target)
      ? null
      : "A revisão de código requer a URL raiz de um repositório público do GitHub.";
  if (!["subfinder", "urlfinder", "gau", "dnsx", "httpx", "nmap"].includes(tool))
    return "Ferramenta não suportada.";
  if (["github.com", "gitlab.com", "bitbucket.org"].includes(url.hostname))
    return "Este alvo é código hospedado em uma plataforma compartilhada. Use Revisar repositório público; a coleta de domínios não se aplica.";
  if (tool === "httpx") return null;
  if (!inScope.some((rule) => coversOrigin(rule, url)))
    return "O escopo deste alvo é restrito por caminho ou origem. Use classificação offline; a coleta por domínio exige uma regra que permita a origem inteira.";
  return null;
}

export function recommendedTool(target: string): string {
  return githubRepository(target) ? "repo-review" : "cbh-classify";
}
