import { mkdir, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { BountyError, type Program, type Run } from "./model.js";
import { binaryPath, runProcess } from "./process.js";
import { isolationStatus } from "./isolation.js";

export const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const commands: Record<string, string[]> = {
  "ghosthunt-status": ["status"],
  "ghosthunt-doctor": ["doctor"],
  "ghosthunt-engines": ["engine", "list"],
  "ghosthunt-playbooks": ["play", "list"],
  "ghosthunt-report": ["report"],
};
export const nativeTools = [
  { id: "ghosthunt-status", name: "Ghosthunt: sessão", description: "Mostra a sessão nativa e o escopo deste programa." },
  { id: "ghosthunt-doctor", name: "Ghosthunt: diagnóstico", description: "Executa doctor para conferir Python, ferramentas, engines e Ollama local." },
  { id: "ghosthunt-engines", name: "Ghosthunt: engines", description: "Consulta os engines nativos e sua disponibilidade real." },
  { id: "ghosthunt-playbooks", name: "Ghosthunt: playbooks", description: "Lista as metodologias nativas e as bibliotecas Claude-BugHunter e OSINT." },
  { id: "ghosthunt-report", name: "Ghosthunt: relatório da sessão", description: "Gera report.md com notas e evidências na sessão nativa. O relatório HackerOne por achado continua em Achados." },
].map((tool) => ({ ...tool, mode: "offline" as const }));

export const nativeSessionRoot = (directory: string) => resolve(directory) === join(nativeRoot, ".bounty", "web") ? join(nativeRoot, ".bounty") : join(directory, "native");

export function nativeEnvironment(directory: string, slug?: string): NodeJS.ProcessEnv {
  return {
    GHOSTHUNT_SESSION_ROOT: nativeSessionRoot(directory),
    ...(slug ? { GHOSTHUNT_ENGAGEMENT: slug } : { GHOSTHUNT_ENGAGEMENT: undefined }),
    GHOSTHUNT_KNOWLEDGE_DIR: join(directory, "integrations"),
    BOUNTY_ENGINES_DIR: join(nativeRoot, "engines"),
    PYTHONUNBUFFERED: "1", BOUNTY_LLM: "local",
    BOUNTY_OLLAMA_URL: "http://127.0.0.1:11434/v1",
    BOUNTY_OLLAMA_MODEL: "ghosthunt-local:q4",
    PATH: [join(directory, "bin"), process.env.PATH || ""].join(delimiter),
  };
}

export async function prepareNativeSession(directory: string, program: Program) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(program.id)) throw new BountyError(422, "Identificador de programa inválido.");
  const slug = `web-${program.id.toLowerCase()}`;
  const folder = join(nativeSessionRoot(directory), "engagements", slug);
  await mkdir(join(folder, "evidence"), { recursive: true, mode: 0o700 });
  await mkdir(join(folder, "work"), { recursive: true, mode: 0o700 });
  const state = {
    program: program.name, scope: program.inScope,
    out_of_scope: program.outOfScope, policy: program.policy,
    created_at: program.createdAt, mode: "operator-approved",
    web_program_id: program.id, scope_version: program.scopeVersion,
    web_managed: true,
  };
  const temporary = join(folder, `.engagement-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, join(folder, "engagement.json"));
  return { folder, env: nativeEnvironment(directory, slug) };
}

export async function nativeManifest(directory: string) {
  const binary = await binaryPath("python3", directory);
  if (!binary) return { available: false, python: "", tools: [], engines: [] };
  const result = await runProcess(binary, [join(nativeRoot, "ghosthunt.py"), "web-manifest"], {
    cwd: nativeRoot, env: nativeEnvironment(directory), timeout: 10000, onStdout:()=>{},onStderr:()=>{},
  });
  if (result.code !== 0) return { available: false, python: "", tools: [], engines: [] };
  const manifest = JSON.parse(result.output);
  return { available: true, python: String(manifest.python), tools: manifest.tools, engines: manifest.engines };
}

export async function runNativeTool(directory: string, tool: string, program: Program, signal?: AbortSignal) {
  const args = commands[tool];
  if (!args) return null;
  const binary = await binaryPath("python3", directory);
  if (!binary) throw new BountyError(503, "Python 3 não encontrado.");
  const session = await prepareNativeSession(directory, program);
  const result = await runProcess(binary, [join(nativeRoot, "ghosthunt.py"), ...args], {
    cwd: nativeRoot, env: session.env, signal, timeout: 20000,
  });
  if (tool === "ghosthunt-doctor") {
    const protectedStatus = await isolationStatus(directory);
    return { ...result, output: `Diagnóstico abaixo: ferramentas e engines no Mac. Análises de alvo usam o executor Docker, não este PATH.\n${result.output}\nExecutor Docker/Conda: ${Object.values(protectedStatus.installedTools).filter(Boolean).length}/${protectedStatus.expectedTools.length} executáveis presentes.\n${Object.entries(protectedStatus.installedTools).map(([id, installed]) => `${installed ? "OK" : "AUSENTE"} Docker: ${id}`).join("\n")}\n${protectedStatus.reason}` };
  }
  return { ...result, output: result.output + (result.stderr?.trim() ? `\n${result.stderr}` : "") };
}

export async function archiveNativeRun(directory: string, program: Program, run: Run) {
  const session = await prepareNativeSession(directory, program);
  const body = `Ghosthunt web run ${run.id}\nTool: ${run.tool}\nTarget: ${run.target}\nScope version: ${run.scopeVersion}\nStatus: ${run.status}\nFinished: ${run.finishedAt || ""}\n\n${run.output}\n${run.error || ""}\n`;
  await writeFile(join(session.folder, "evidence", `${run.id}.txt`), body, { mode: 0o600 });
}
