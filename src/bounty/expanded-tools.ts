import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { binaryPath, runProcess, type ProcessResult } from "./process.js";
import { BountyError, type Program } from "./model.js";
import { inScope } from "./scope.js";
import { reviewRepository } from "./repository-review.js";
import { readBurp } from "./burp.js";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["100.64.0.0", 10],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
blocked.addSubnet("2001:db8::", 32, "ipv6");
export function publicAddress(ip: string) {
  const version = isIP(ip);
  return version === 4
    ? !blocked.check(ip, "ipv4")
    : version === 6 &&
        /^[23][0-9a-f]{0,3}:/i.test(ip) &&
        !blocked.check(ip, "ipv6");
}
async function checkPublicHost(host: string) {
  const values = await lookup(host, { all: true });
  if (!values.length || values.some((v) => !publicAddress(v.address)))
    throw new BountyError(
      422,
      "A consulta HTTP exige um host com endereços públicos. Alvos locais ou privados não são aceitos por este executor.",
    );
}

export async function scanSourceSecrets(
  directory: string,
  target: string,
  program: Program,
  signal?: AbortSignal,
  engine: "gitleaks" | "semgrep" | "trufflehog" = "gitleaks",
) {
  const binary = await binaryPath(engine, directory);
  if (!binary) throw new BountyError(503, `${engine} não encontrado.`);
  return reviewRepository(
    directory,
    target,
    program,
    signal,
    fetch,
    async (sources) => {
      const temporary = await mkdtemp(join(directory, "source-secrets-"));
      const root = join(temporary, "source");
      const report = join(temporary, "report.json");
      try {
        await mkdir(root, { recursive: true, mode: 0o700 });
        for (const source of sources) {
          const path = join(root, source.path);
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          await writeFile(path, source.content, { mode: 0o600, flag: "wx" });
        }
        if (engine === "semgrep") {
          const rules = join(temporary,"rules.json");
          await writeFile(rules,JSON.stringify({rules:[
            {id:"python-shell-review",languages:["python"],severity:"WARNING",message:"Verifique se entrada não confiável alcança execução de shell.",pattern:"subprocess.$FUNC(..., shell=True, ...)"},
            {id:"python-unsafe-yaml-review",languages:["python"],severity:"WARNING",message:"Verifique entrada e loader de desserialização YAML.",pattern:"yaml.load(...)"},
            {id:"javascript-dynamic-exec-review",languages:["javascript","typescript"],severity:"WARNING",message:"Verifique se entrada não confiável alcança execução de comando.",pattern:"$CHILD.exec(...)"},
          ]}),{mode:0o600});
          const scanned=await runProcess(binary,["scan","--config",rules,"--json","--quiet","--metrics","off","--no-git-ignore","--jobs","1","--timeout","5","--max-target-bytes","100000","--output",report,root],{cwd:temporary,timeout:60000,signal,env:{SEMGREP_ENABLE_VERSION_CHECK:"0",SEMGREP_SEND_METRICS:"off"},onStdout:()=>{},onStderr:()=>{}});
          if(scanned.code)throw new BountyError(502,"Semgrep não concluiu a análise estática local.");
          const parsed=JSON.parse(await readFile(report,"utf8"));
          return [`Semgrep: ${parsed.results?.length || 0} sinais estáticos na amostra. Regras locais; nenhum código do alvo foi executado.`,...(parsed.results || []).slice(0,30).map((item:{check_id:string;path:string;start:{line:number};extra:{message:string}})=>JSON.stringify({rule:item.check_id,path:item.path.replace(root+"/",""),line:item.start.line,message:item.extra.message}))].join("\n");
        }
        if (engine === "trufflehog") {
          const scanned=await runProcess(binary,["filesystem",root,"--json","--no-verification","--no-update","--concurrency","1"],{cwd:temporary,timeout:60000,maxBytes:1000000,signal,onStdout:()=>{},onStderr:()=>{}});
          if(scanned.code)throw new BountyError(502,"TruffleHog não concluiu a análise local.");
          const records=scanned.output.split("\n").filter(line=>line.trim()).map(line=>JSON.parse(line));
          return [`TruffleHog: ${records.length} possíveis segredos na amostra. Valores omitidos; verificação online desativada.`,...records.slice(0,30).map(item=>JSON.stringify({detector:item.DetectorName,path:String(item.SourceMetadata?.Data?.Filesystem?.file || "").replace(root+"/",""),line:item.SourceMetadata?.Data?.Filesystem?.line}))].join("\n");
        }
        const result = await runProcess(
          binary,
          [
            "dir",
            root,
            "--redact=100",
            "--no-banner",
            "--no-color",
            "--report-format",
            "json",
            "--report-path",
            report,
            "--exit-code",
            "0",
            "--timeout",
            "45",
            "--max-decode-depth",
            "0",
          ],
          { cwd: temporary, timeout: 60000, signal },
        );
        if (result.code)
          throw new BountyError(
            502,
            "O Gitleaks não concluiu a análise local da amostra.",
          );
        let content;
        try {
          content = await readFile(report, "utf8");
        } catch {
          throw new BountyError(
            502,
            "Gitleaks não produziu um relatório estruturado.",
          );
        }
        if (Buffer.byteLength(content) > 1_000_000)
          throw new BountyError(413, "Relatório Gitleaks excedeu o limite.");
        const findings = JSON.parse(content);
        if (!Array.isArray(findings))
          throw new BountyError(502, "Relatório Gitleaks inválido.");
        return [
          `Gitleaks: ${findings.length} possíveis segredos na amostra. Valores ocultados; nenhuma credencial foi usada ou validada online.`,
          ...findings.slice(0, 30).map((f) =>
            JSON.stringify({
              rule: f.RuleID,
              path: String(f.File || "")
                .replace(root + "/", "")
                .slice(0, 500),
              line: f.StartLine,
              description: f.Description,
            }),
          ),
        ].join("\n");
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
  );
}

export async function runExpandedTool(
  directory: string,
  tool: string,
  target: string,
  program: Program,
  signal?: AbortSignal,
): Promise<ProcessResult | undefined> {
  if (tool === "burp-history" || tool === "burp-issues")
    return readBurp(tool, target, program, signal);
  if (tool === "repo-secrets")
    return scanSourceSecrets(directory, target, program, signal);
  if (tool === "repo-semgrep" || tool === "repo-trufflehog") return scanSourceSecrets(directory,target,program,signal,tool === "repo-semgrep"?"semgrep":"trufflehog");
  if (tool === "nmap") {
    if (!program.activeTestingAllowed || !program.portScanAllowed || !program.automationAllowed) throw new BountyError(409, "Permissão de conexão TCP automatizada pendente.");
    const url = new URL(target), addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(value => !publicAddress(value.address))) throw new BountyError(422, "Nmap requer endereços públicos verificados.");
    const address = addresses.find(value => value.family === 4)?.address;
    if (!address) throw new BountyError(422, "O executor VPN requer um endereço IPv4 público.");
    const binary = await binaryPath("nmap", directory); if (!binary) throw new BountyError(503, "Nmap ausente na imagem.");
    return runProcess(binary, ["-sT", "-Pn", "-n", "-p", url.port || (url.protocol === "https:" ? "443" : "80"), "--open", "--max-retries", "1", "--host-timeout", "30s", "--max-rate", "2", address], { cwd: directory, signal, timeout: 40000, maxBytes: 100000 });
  }
  if (!["gau", "httpx", "dnsx"].includes(tool)) return undefined;
  const binary = await binaryPath(tool, directory);
  if (!binary)
    throw new BountyError(
      503,
      `${tool} não encontrado. Execute a instalação local de ferramentas.`,
    );
  const url = new URL(target);
  let args: string[];
  let input: string | undefined;
  if (tool === "gau")
    args = [
      url.hostname,
      "--threads",
      "1",
      "--timeout",
      "15",
      "--retries",
      "1",
    ];
  else if (tool === "dnsx") {
    args = [
      "-silent",
      "-json",
      "-a",
      "-aaaa",
      "-rl",
      "2",
      "-retry",
      "1",
      "-duc",
    ];
    input = url.hostname + "\n";
  } else {
    await checkPublicHost(url.hostname);
    args = [
      "-u",
      target,
      "-silent",
      "-json",
      "-nfs",
      "-threads",
      "1",
      "-rl",
      "2",
      "-timeout",
      "10",
      "-retries",
      "0",
      "-duc",
      "-no-color",
      "-response-size-to-read",
      "65536",
    ];
  }
  const result = await runProcess(binary, args, {
    cwd: directory,
    timeout: 90000,
    signal,
    input,
  });
  if (result.code)
    return {
      code: result.code,
      output: `${tool} não concluiu a coleta. Confira a instalação e a conectividade.`,
    };
  const lines = result.output
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (tool === "gau")
    return {
      code: 0,
      output:
        [...new Set(lines.filter((line) => inScope(line, program)))].join(
          "\n",
        ) || "Nenhuma URL no escopo retornada por gau.",
    };
  const observations = lines.flatMap((line) => {
    try {
      const data = JSON.parse(line);
      if (tool === "dnsx")
        return String(data.host).toLowerCase() === url.hostname.toLowerCase()
          ? [
              JSON.stringify({
                host: data.host,
                a: data.a,
                aaaa: data.aaaa,
                status: data.status_code,
              }),
            ]
          : [];
      if (
        typeof data.url !== "string" ||
        !inScope(data.url, program) ||
        new URL(data.url).origin !== url.origin
      )
        return [];
      return [
        JSON.stringify({
          url: data.url,
          status: data.status_code,
          title: data.title,
          server: data.webserver,
          technologies: data.tech,
          contentLength: data.content_length,
        }),
      ];
    } catch {
      return [];
    }
  });
  return {
    code: 0,
    output: [
      `${tool}: consulta pontual. Redirecionamentos e crawling não foram habilitados.`,
      ...observations,
      ...(!observations.length
        ? ["Nenhuma observação estruturada no escopo retornada."]
        : []),
    ].join("\n"),
  };
}
