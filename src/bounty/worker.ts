/** Container entry point. Receives only the current program and fixed tool operation. */
import { mkdir, readFile, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { openAICompletion } from "./openai-advisor.js";
import { programInput, type Program } from "./model.js";
import { makeInProcessToolRunner } from "./tools.js";
import { withExecution } from "./execution.js";
import { runProcess } from "./process.js";
import { protectedBinaries } from "./tool-inventory.js";
const directory = "/work";
const send = (record: unknown) => process.stdout.write(JSON.stringify(record) + "\n");
async function main() {
  if (process.argv.includes("--inventory")) {
    const tools: Record<string, boolean> = {};
    for (const binary of protectedBinaries)
      tools[binary] = (await runProcess("/bin/sh", ["-c", 'command -v "$1" >/dev/null', "probe", binary], { cwd: directory })).code === 0;
    send({ conda: process.env.CONDA_DEFAULT_ENV, prefix: process.env.CONDA_PREFIX, uid: process.getuid?.(), tools });
    return;
  }
  let raw = "";
  for await (const chunk of process.stdin) { raw += chunk; if (Buffer.byteLength(raw) > 1_000_000) throw Error("Job input too large"); }
  const input = z.object({ openai: z.object({ apiKey: z.string().min(20).max(500), model: z.string().min(1).max(250), system: z.string().max(20000), prompt: z.string().max(70000) }).optional(), tool: z.string().max(50), target: z.url().max(2000), egressGuard: z.object({ hostEgressHash: z.string().regex(/^[a-f0-9]{64}$/) }).nullable(), program: programInput.extend({ id: z.string().max(80), scopeVersion: z.number().int(), createdAt: z.string(), updatedAt: z.string() }) }).parse(JSON.parse(raw));
  if (!["repo-review", "repo-secrets", "repo-semgrep", "repo-trufflehog", "cbh-classify", "subfinder", "urlfinder", "gau", "dnsx", "httpx", "nmap", "openai-advice"].includes(input.tool)) throw Error("Local control operation not allowed in analysis worker");
  if (input.tool !== "cbh-classify") {
    if (!input.egressGuard) throw Error("VPN egress guard required");
    const route = await runProcess("ip", ["-j", "route", "get", "1.1.1.1"], { cwd: directory });
    const routes = JSON.parse(route.output);
    if (route.code || !routes.some((item: { dev?: string }) => /^(tun|wg)[0-9]+$/.test(item.dev || ""))) throw Error("Blocked: route is not through the VPN interface");
    const response = await fetch("https://api.ipify.org", { redirect: "error", signal: AbortSignal.timeout(10000) });
    const ip = (await response.text()).trim();
    if (!response.ok || !isIP(ip) || createHash("sha256").update(ip).digest("hex") === input.egressGuard.hostEgressHash) throw Error("Blocked: VPN egress is not different from the Mac baseline");
    send({ type: "event", event: { kind: "system", text: `VPN verificada antes do alvo. IP de saída: ${ip}\n` } });
  }
  if (input.tool === "openai-advice") {
    if (!input.openai) throw Error("Protected OpenAI request missing");
    process.env.OPENAI_API_KEY = input.openai.apiKey;
    process.env.GHOSTHUNT_OPENAI_MODEL = input.openai.model;
    const result = await openAICompletion(input.openai.system, input.openai.prompt);
    delete process.env.OPENAI_API_KEY;
    send({ type: "result", result: { code: 0, output: JSON.stringify(result) }, artifacts: [] });
    return;
  }
  await mkdir(directory, { recursive: true });
  for (const name of ["bin", "integrations"]) await symlink(join("/opt/ghosthunt/data", name), join(directory, name));
  const result = await withExecution((event) => send({ type: "event", event }), () => makeInProcessToolRunner(directory)(input.tool, input.target, input.program as Program));
  const artifacts: { name: string; content: string }[] = [];
  try {
    for (const name of (await readdir(join(directory, "repository-reviews"))).slice(0, 2)) {
      if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
      const content = await readFile(join(directory, "repository-reviews", name), "utf8");
      if (Buffer.byteLength(content) <= 3_000_000) artifacts.push({ name, content });
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  send({ type: "result", result, artifacts });
}
main().catch((error) => { send({ type: "error", message: error instanceof z.ZodError || error instanceof SyntaxError ? "Entrada de análise inválida." : error instanceof Error ? error.message : "Analysis failed" }); process.exitCode = 1; });
