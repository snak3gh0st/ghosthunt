import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { BountyError, type Program } from "./model.js";
import { runProcess, type ProcessResult } from "./process.js";
import { executionEvent, type ExecutionEvent } from "./execution.js";
import { protectedBinaries } from "./tool-inventory.js";

export interface IsolationConfig { imageId: string; vpnImageId: string; zapImageId?: string; hostEgressHash?: string }
export const vpnName = "ghosthunt-vpn";
const digest = /^sha256:[a-f0-9]{64}$/;
export function dockerPrefix() {
  const context = process.env.GHOSTHUNT_DOCKER_CONTEXT || "desktop-linux";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(context)) throw new BountyError(503, "Contexto Docker inválido.");
  return ["--context", context];
}
export async function isolationConfig(directory: string): Promise<IsolationConfig | null> {
  try {
    const value = JSON.parse(await readFile(join(directory, "runtime", "config.json"), "utf8"));
    if (!digest.test(value.imageId) || !digest.test(value.vpnImageId)) return null;
    return value;
  } catch { return null; }
}
export async function docker(args: string[], options: Partial<Parameters<typeof runProcess>[2]> = {}) {
  return runProcess("docker", [...dockerPrefix(), ...args], { cwd: process.cwd(), timeout: 10000, ...options, env: { ...options.env, OPENAI_API_KEY: undefined, BOUNTY_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, HACKERONE_API_TOKEN: undefined, ADMIN_API_KEY: undefined } });
}
export function containerArgs(imageId: string, name: string, vpnId?: string, resolverPath?: string) {
  if (!digest.test(imageId) || !/^ghosthunt-job-[a-f0-9-]{36}$/.test(name)) throw new BountyError(503, "Imagem ou job inválido.");
  if (vpnId && !/^[a-f0-9]{64}$/.test(vpnId)) throw new BountyError(503, "Gateway inválido.");
  const args = ["run", "--rm", "--interactive", "--pull=never", "--name", name,
    "--label", "app=ghosthunt-analysis", "--read-only", "--user", "1000:1000", "--cap-drop=ALL",
    "--security-opt", "no-new-privileges:true", "--pids-limit", "128", "--memory", "1536m", "--cpus", "2",
    "--ulimit", "nofile=1024:1024", "--tmpfs", "/work:rw,nosuid,nodev,noexec,size=512m,uid=1000,gid=1000,mode=0700",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=64m,uid=1000,gid=1000,mode=0700",
    "--network", vpnId ? `container:${vpnId}` : "none"];
  if (vpnId) {
    if (!resolverPath || /[,\n\r]/.test(resolverPath)) throw new BountyError(503, "Resolver privado inválido.");
    args.push("--mount", `type=bind,source=${resolverPath},target=/etc/resolv.conf,readonly`);
  }
  return [...args, imageId];
}
async function gateway(config: IsolationConfig) {
  const result = await docker(["inspect", vpnName], { onStdout: () => {}, onStderr: () => {} });
  if (result.code) return null;
  const value = JSON.parse(result.output)[0];
  return value?.Config?.Labels?.app === "ghosthunt-vpn" && value.Image === config.vpnImageId && value.State?.Running && value.State?.Health?.Status === "healthy" && value.HostConfig?.NetworkMode !== "host" && value.Config?.Env?.includes("FIREWALL=on") ? { id: String(value.Id) } : null;
}
let cached: { directory: string; expires: number; value: Awaited<ReturnType<typeof readStatus>> } | undefined;
async function readStatus(directory: string) {
  const config = await isolationConfig(directory);
  const base = { engine: "docker", conda: false, imageReady: false, dockerReady: false, vpnReady: false, networkReady: false, installedTools: {} as Record<string, boolean>, expectedTools: [...protectedBinaries] as string[], wireguardConfigured: false, reason: "Prepare a imagem de análise: npm run isolation:prepare" };
  try {
    try { await access(join(directory, "runtime", "wg0.conf")); base.wireguardConfigured = true; } catch {}
    const info = await docker(["info", "--format", "{{.ServerVersion}}"], { timeout: 5000, onStdout: () => {}, onStderr: () => {} });
    if (info.code) return { ...base, reason: "Inicie o Docker Desktop." };
    base.dockerReady = true;
    if (!config) return base;
    const name = `ghosthunt-job-${randomUUID()}`;
    const inventory = await docker([...containerArgs(config.imageId, name), "--inventory"], { timeout: 20000, onStdout: () => {}, onStderr: () => {} });
    if (inventory.code) return { ...base, reason: "Imagem de análise indisponível. Prepare a imagem Docker." };
    const data = JSON.parse(inventory.output.trim());
    base.imageReady = true; base.conda = data.conda === "base" && data.prefix === "/opt/conda" && data.uid === 1000;
    base.installedTools = data.tools;
    const vpn = await gateway(config);
    base.vpnReady = !!vpn;
    base.networkReady = base.conda && !!vpn && /^[a-f0-9]{64}$/.test(config.hostEgressHash || "");
    base.reason = base.networkReady ? "Container e gateway VPN prontos; o IP é conferido antes de cada análise." : "VPN não conectada ou saída ainda não verificada. Análises de rede bloqueadas.";
    return base;
  } catch { return { ...base, reason: "Docker indisponível. Nenhuma análise usa execução direta no Mac." }; }
}
export async function isolationStatus(directory: string, fresh = false) {
  if (!fresh && cached?.directory === directory && cached.expires > Date.now()) return cached.value;
  const value = await readStatus(directory); cached = { directory, expires: Date.now() + 10000, value }; return value;
}
export async function runIsolatedTool(directory: string, tool: string, target: string, program: Program, signal?: AbortSignal, openai?: { apiKey: string; model: string; system: string; prompt: string }): Promise<ProcessResult> {
  const status = await isolationStatus(directory);
  const config = await isolationConfig(directory);
  if (!status.imageReady || !status.conda || !config) throw new BountyError(503, status.reason);
  const offline = tool === "cbh-classify";
  const vpn = offline ? null : await gateway(config);
  if (!offline && (!vpn || !/^[a-f0-9]{64}$/.test(config.hostEgressHash || ""))) throw new BountyError(409, "Análise bloqueada: configure o Proton WireGuard e verifique a saída VPN. Não há fallback pelo IP do Mac.");
  if (!offline && (await readFile(join(directory, "runtime", "resolv.conf"), "utf8")) !== "nameserver 127.0.0.1\noptions timeout:2 attempts:2\n") throw new BountyError(409, "Resolver VPN inválido. Reconfigure o gateway.");
  const name = `ghosthunt-job-${randomUUID()}`;
  const args = containerArgs(config.imageId, name, vpn?.id, join(directory, "runtime", "resolv.conf"));
  executionEvent({ kind: "system", text: `Container descartável ${name}\nConda base: Python 3.12 / Node 22; usuário 1000; sem privilégios; disco somente leitura.\nRede: ${offline ? "desativada" : "gateway VPN exclusivo"}\n` });
  let pending = ""; let result: ProcessResult | undefined; let failure = "";
  const artifacts: { name: string; content: string }[] = [];
  const consume = (text: string) => {
    pending += text;
    const lines = pending.split("\n"); pending = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record.type === "event" && ["command", "stdout", "stderr", "system", "exit"].includes(record.event?.kind) && typeof record.event.text === "string") executionEvent(record.event as ExecutionEvent);
        else if (record.type === "result" && typeof record.result?.output === "string" && Number.isInteger(record.result.code)) { result = record.result; if (Array.isArray(record.artifacts)) artifacts.push(...record.artifacts); }
        else if (record.type === "error") failure = String(record.message).slice(0, 2000);
      } catch { failure = "Resposta inválida do worker isolado."; }
    }
  };
  try {
    const completed = await docker(args, { input: JSON.stringify({ tool, target, program, openai, egressGuard: offline ? null : { hostEgressHash: config.hostEgressHash } }), timeout: 150000, maxBytes: 8_000_000, signal, onStdout: consume, onStderr: (text) => executionEvent({ kind: "stderr", text }) });
    if (pending.trim()) consume("\n");
    if (completed.code || failure || !result) throw new BountyError(502, failure || "O container não concluiu a análise.");
    const folder = join(directory, "repository-reviews");
    await mkdir(folder, { recursive: true, mode: 0o700 });
    for (const artifact of artifacts.slice(0, 2)) {
      if (!/^[0-9a-f-]{36}\.json$/.test(artifact.name) || typeof artifact.content !== "string" || Buffer.byteLength(artifact.content) > 3_000_000) throw new BountyError(502, "Artefato inválido do worker.");
      JSON.parse(artifact.content);
      await writeFile(join(folder, artifact.name), artifact.content, { mode: 0o600, flag: "wx" });
    }
    return result;
  } finally {
    await docker(["rm", "--force", name], { timeout: 10000, onStdout: () => {}, onStderr: () => {} }).catch(() => {});
  }
}

export async function protectedOpenAICompletion(directory: string, program: Program, system: string, prompt: string) {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new BountyError(503, "OpenAI ainda não configurada.");
  if (system.length + prompt.length > 70000) throw new BountyError(413, "Contexto extenso para a consulta protegida. Reduza as evidências selecionadas.");
  const result = await runIsolatedTool(directory, "openai-advice", program.url, program, undefined, {
    apiKey: process.env.OPENAI_API_KEY.trim(), model: process.env.GHOSTHUNT_OPENAI_MODEL?.trim() || "gpt-4.1-mini", system, prompt,
  });
  return z.object({ answer: z.string().min(1).max(50000), provider: z.literal("openai"), model: z.string().max(250), durationMs: z.number().nonnegative(), inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(), costUsd: z.null(), outputTruncated: z.boolean() }).parse(JSON.parse(result.output));
}
