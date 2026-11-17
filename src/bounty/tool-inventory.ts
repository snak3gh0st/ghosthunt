/** Executables expected in the protected analysis image; alternative AI agents are separate. */
export const protectedBinaries = [
  "python3", "node", "subfinder", "urlfinder", "gau", "dnsx", "httpx", "gitleaks", "nmap", "dig", "whois", "curl", "git", "jq", "openssl",
  "amass", "arjun", "assetfinder", "cdncheck", "commix", "crlfuzz", "dalfox", "dirsearch", "feroxbuster", "ffuf", "findomain", "getallurls", "gobuster", "gospider", "gowitness", "hakrawler", "hydra", "katana", "kiterunner", "medusa", "msfconsole", "msfvenom", "naabu", "netexec", "nuclei", "patator", "semgrep", "sqlmap", "theharvester", "tlsx", "trufflehog", "wafw00f", "waybackurls", "whatweb", "wpscan",
] as const;
export const legacyTools = [
  { id: "crackmapexec", replacement: "netexec", reason: "Nome legado; o arsenal usa o sucessor NetExec." },
  { id: "zap-cli", replacement: "ZAP oficial em Docker", reason: "Cliente legado separado do servidor ZAP; não é um executável necessário na imagem Conda." },
];
