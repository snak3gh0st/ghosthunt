import type { FastifyInstance } from "fastify";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { BountyStore } from "./store.js";
import { Catalog } from "./catalog.js";
import {
  BountyError,
  evidenceInput,
  findingInput,
  findingStatuses,
  programInput,
  type Program,
  type Workspace,
} from "./model.js";
import { requireScope, validScopeRule } from "./scope.js";
import { buildReport, reportGaps, reportRevision, reportApproved } from "./report.js";
import { assessProgram, assessmentState, requireAssessment } from "./assessment.js";
import {
  makeToolRunner,
  validateToolRequest,
  supportedSkills,
  toolStatus,
  type ToolRunner,
} from "./tools.js";
import { makeAdvisor, type Advisor } from "./advisor.js";
import { inspectBurp } from "./burp.js";
import { MetasploitCatalog } from "./metasploit.js";
import { archiveNativeRun } from "./native.js";
import { readPentest } from "./pentest.js";
import { saveWireGuard, startVpn } from "./vpn.js";
import { isolationStatus } from "./isolation.js";
import { RunTerminals } from "./terminal.js";
import { withExecution } from "./execution.js";
import { investigationPlan } from "./investigation-model.js";
import { scopeReview } from "./scope-review.js";

export interface BountyOptions {
  store: BountyStore;
  apiKey: string;
  runner?: ToolRunner;
  advisor?: Advisor;
  catalog?: Catalog;
}
const now = () => new Date().toISOString();
function programById(data: Workspace, id: string): Program {
  const program = data.programs.find((p) => p.id === id);
  if (!program) throw new BountyError(404, "Programa não encontrado.");
  return program;
}
function findingById(data: Workspace, id: string) {
  const finding = data.findings.find((f) => f.id === id);
  if (!finding) throw new BountyError(404, "Achado não encontrado.");
  return finding;
}
function validateRules(input: { inScope: string[]; outOfScope: string[] }) {
  if (
    [...input.inScope, ...input.outOfScope].some(
      (rule) => !validScopeRule(rule),
    )
  )
    throw new BountyError(
      422,
      "Use domínios exatos, *.dominio.com ou URLs HTTP(S). Expressões regulares não são aceitas.",
    );
}

export async function bountyRoutes(
  app: FastifyInstance,
  options: BountyOptions,
) {
  const { store, apiKey } = options;
  const catalog = options.catalog ?? new Catalog();
  async function reviewProgramScope(program: Program) {
    if (program.scopeReferences !== undefined || !/^https:\/\/hackerone\.com\/[^/]+\/?$/.test(program.url)) return scopeReview(program);
    try { const source=(await catalog.list()).programs.find(item=>item.url===program.url);return scopeReview(program,source?.scopeReferences || []); }
    catch { return scopeReview(program); }
  }
  const runner = options.runner ?? makeToolRunner(store.directory);
  const advisor = options.advisor ?? makeAdvisor(store.directory);
  const metasploit = new MetasploitCatalog(store.directory);
  const terminals = new RunTerminals(store.directory);
  const active = new Map<string, AbortController>();
  const activePrograms = new Map<string, string>();
  const tasks = new Set<Promise<void>>();
  let advicePending = false;
  app.addHook("onClose", async () => {
    for (const controller of active.values()) controller.abort();
    await Promise.allSettled(tasks);
  });
  app.addHook("onRequest", async (req, reply) => {
    const supplied = req.headers["x-api-key"];
    if (
      !apiKey ||
      typeof supplied !== "string" ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(apiKey) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(apiKey))
    )
      return reply.code(401).send({ error: "Chave de acesso inválida." });
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (error instanceof BountyError)
      return reply.code(error.statusCode).send({ error: error.message });
    request.log.error(error);
    const status =
      error && typeof error === "object" && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    return reply
      .code(status >= 400 && status < 500 ? status : 500)
      .send({ error: "Não foi possível concluir a operação." });
  });
  app.get("/session", async () => ({ mode: "bounty" }));
  app.get("/bounty/workspace", async () => {
    const data = await store.read();
    return {
      ...data,
      evidence: data.evidence.map(({ content: _content, ...item }) => item),
      summary: {
        programs: data.programs.length,
        paidPrograms: data.programs.filter((p) => p.offersBounties).length,
        findings: data.findings.length,
        submitted: data.findings.filter((f) =>
          ["submitted", "triaged", "paid"].includes(f.status),
        ).length,
        rewards: Object.fromEntries(
          [...new Set(data.findings.map((f) => f.currency))].map((currency) => [
            currency,
            data.findings
              .filter((f) => f.status === "paid" && f.currency === currency)
              .reduce((sum, f) => sum + f.rewardCents, 0),
          ]),
        ),
        minutesSpent: data.findings.reduce((sum, f) => sum + f.minutesSpent, 0),
        aiCostUsd: data.advice.reduce((sum, a) => sum + (a.costUsd ?? 0), 0),
        localAdviceCount: data.advice.filter((a) => a.provider === "local")
          .length,
        openaiAdviceCount: data.advice.filter((a) => a.provider === "openai")
          .length,
        unpricedAdviceCount: data.advice.filter((a) => a.costUsd === null)
          .length,
        claudeAdviceCount: data.advice.filter(
          (a) => !a.provider || a.provider === "claude",
        ).length,
      },
    };
  });
  app.get("/bounty/integrations", async () => ({
    ...(await toolStatus(store.directory)),
    skills: supportedSkills,
  }));
  app.get<{ Params: { id: string } }>("/bounty/programs/:id/pentest", async (req) => readPentest(store.directory, programById(await store.read(), req.params.id)));
  app.get<{ Params: { id: string } }>("/bounty/programs/:id/assessment", async (req) => assessmentState(programById(await store.read(), req.params.id)));
  app.get<{ Params: { id: string } }>("/bounty/programs/:id/scope-review", async req=>reviewProgramScope(programById(await store.read(),req.params.id)));
  app.post<{ Params: { id: string } }>("/bounty/programs/:id/scope/confirm", async req=>{
    const input=z.object({reviewToken:z.string().regex(/^[a-f0-9]{64}$/),policyReviewed:z.literal(true),preserveUnsupported:z.boolean().default(false)}).parse(req.body);
    const sourceReview=await reviewProgramScope(programById(await store.read(),req.params.id));
    return store.mutate(data=>{
      const program=programById(data,req.params.id),review=scopeReview(program,sourceReview.unsupported);
      if(review.reviewToken!==input.reviewToken)throw new BountyError(409,"O escopo mudou. Atualize e confira a versão atual antes de confirmar.");
      if([...activePrograms.values()].includes(program.id))throw new BountyError(409,"Aguarde ou cancele a execução antes de confirmar outro escopo.");
      if(!review.inScope.length)throw new BountyError(422,"Este cadastro não contém ativos web suportados. Revise os tipos de ativo antes de confirmar.");
      if(!program.policy.trim())throw new BountyError(422,"Registre as regras da política oficial em Editar escopo e permissões.");
      if(review.unsupported.length&&!input.preserveUnsupported)throw new BountyError(422,"Confirme a preservação dos ativos não web como referência, fora do executor.");
      if(review.unsupported.length){program.inScope=review.inScope;program.outOfScope=review.outOfScope;program.scopeReferences=[...(program.scopeReferences||[]),...review.unsupported];}
      if(!program.scopeConfirmed||review.unsupported.length){program.scopeVersion++;program.updatedAt=now();}
      program.scopeConfirmed=true;
      return {program,review:scopeReview(program)};
    });
  });
  app.post<{ Params: { id: string } }>("/bounty/programs/:id/assessment", async (req) => store.mutate(data => {
    const program = programById(data, req.params.id);
    if ([...activePrograms.values()].includes(program.id)) throw new BountyError(409, "Aguarde a execução antes de substituir o plano.");
    program.assessment = assessProgram(program, req.body);
    return assessmentState(program);
  }));
  app.post<{ Params: { id: string } }>("/bounty/programs/:id/assessment/approve", async (req) => {
    const input = z.object({ assessmentId: z.uuid() }).parse(req.body);
    return store.mutate(data => {
      const program = programById(data, req.params.id), state = assessmentState(program);
      if (!state.current || state.assessment?.id !== input.assessmentId) throw new BountyError(409, "A avaliação mudou. Gere e revise o plano atual.");
      if (state.assessment.blockers.length) throw new BountyError(422, state.assessment.blockers.join("\n"));
      state.assessment.approvedAt = now();
      return assessmentState(program);
    });
  });
  app.get("/bounty/isolation", async () => isolationStatus(store.directory, true));
  app.post("/bounty/isolation/wireguard", async (req) => {
    if (active.size) throw new BountyError(409, "Aguarde ou cancele as execuções antes de alterar a VPN.");
    const input = z.object({ content: z.string().min(30).max(20000) }).parse(req.body);
    return saveWireGuard(store.directory, input.content);
  });
  app.post("/bounty/isolation/start", async () => {
    if (active.size) throw new BountyError(409, "Aguarde ou cancele as execuções antes de conectar a VPN.");
    return startVpn(store.directory);
  });
  app.post("/bounty/integrations/burp/check", async () => inspectBurp());
  app.get("/bounty/integrations/metasploit", async (req) => {
    const input = z
      .object({
        q: z.string().trim().min(2).max(120),
        offset: z.coerce.number().int().min(0).max(10000).default(0),
      })
      .parse(req.query);
    return metasploit.search(input.q, input.offset);
  });
  app.get<{ Querystring: { refresh?: string } }>(
    "/bounty/catalog",
    async (req) => catalog.list(req.query.refresh === "true"),
  );
  app.post("/bounty/programs", async (req, reply) => {
    const input = programInput.parse(req.body);
    validateRules(input);
    const program = await store.mutate((data) => {
      if (data.programs.some((p) => p.url === input.url))
        throw new BountyError(409, "Este programa já foi adicionado.");
      const value = {
        ...input,
        id: randomUUID(),
        createdAt: now(),
        updatedAt: now(),
        scopeVersion: 1,
      };
      data.programs.unshift(value);
      return value;
    });
    return reply.code(201).send(program);
  });
  app.put<{ Params: { id: string } }>("/bounty/programs/:id", async (req) => {
    const input = programInput.parse(req.body);
    validateRules(input);
    return store.mutate((data) => {
      const program = programById(data, req.params.id);
      if (data.programs.some((p) => p.id !== program.id && p.url === input.url))
        throw new BountyError(409, "Este programa já foi adicionado.");
      const changed = [
        "url",
        "inScope",
        "outOfScope",
        "policy",
        "automationAllowed",
        "activeTestingAllowed",
        "portScanAllowed",
        "scopeConfirmed",
      ].some(
        (key) =>
          JSON.stringify(program[key as keyof Program]) !==
          JSON.stringify(input[key as keyof typeof input]),
      );
      if (changed && [...activePrograms.values()].includes(program.id))
        throw new BountyError(
          409,
          "Cancele a coleta antes de alterar o escopo.",
        );
      Object.assign(program, input, {
        updatedAt: now(),
        scopeVersion: program.scopeVersion + Number(changed),
      });
      return program;
    });
  });
  app.post<{ Params: { id: string } }>(
    "/bounty/programs/:id/findings",
    async (req, reply) => {
      const input = findingInput.parse(req.body);
      const finding = await store.mutate((data) => {
        const program = programById(data, req.params.id);
        requireScope(program, input.target);
        const value = {
          ...input,
          id: randomUUID(),
          programId: program.id,
          status: "hypothesis" as const,
          scopeVersion: program.scopeVersion,
          createdAt: now(),
          updatedAt: now(),
          reportUrl: "",
          rewardCents: 0,
          currency: "USD",
          minutesSpent: 0,
        };
        data.findings.unshift(value);
        return value;
      });
      return reply.code(201).send(finding);
    },
  );
  app.put<{ Params: { id: string } }>("/bounty/findings/:id", async (req) => {
    const input = findingInput.parse(req.body);
    return store.mutate((data) => {
      const finding = findingById(data, req.params.id);
      if (["submitted", "triaged", "paid"].includes(finding.status))
        throw new BountyError(
          409,
          "Achado enviado: preserve a evidência original e registre o acompanhamento.",
        );
      const program = programById(data, finding.programId);
      requireScope(program, input.target);
      Object.assign(finding, input, {
        reportApproval: undefined,
        status: "hypothesis",
        scopeVersion: program.scopeVersion,
        updatedAt: now(),
      });
      return finding;
    });
  });
  app.post<{ Params: { id: string } }>(
    "/bounty/findings/:id/evidence",
    async (req, reply) => {
      const input = evidenceInput.parse(req.body);
      const evidence = await store.mutate((data) => {
        const finding = findingById(data, req.params.id);
        if (["submitted", "triaged", "paid"].includes(finding.status))
          throw new BountyError(
            409,
            "Preserve as evidências do relatório enviado.",
          );
        const value = {
          ...input,
          id: randomUUID(),
          findingId: finding.id,
          createdAt: now(),
          sha256: createHash("sha256").update(input.content).digest("hex"),
        };
        data.evidence.push(value);
        finding.status = "hypothesis";
        finding.reportApproval = undefined;
        finding.reproductionConfirmed = false;
        finding.updatedAt = now();
        return value;
      });
      return reply.code(201).send(evidence);
    },
  );
  app.get<{ Params: { id: string } }>(
    "/bounty/findings/:id/evidence",
    async (req) => {
      const data = await store.read();
      findingById(data, req.params.id);
      return data.evidence.filter((e) => e.findingId === req.params.id);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/bounty/findings/:id/status",
    async (req) => {
      const input = z
        .object({
          status: z.enum(findingStatuses),
          reportUrl: z.string().max(2000).optional(),
          rewardCents: z.number().int().min(0).max(100000000).optional(),
          currency: z.enum(["USD", "EUR", "GBP", "BRL"]).optional(),
          minutesSpent: z.number().int().min(0).max(1000000).optional(),
        })
        .parse(req.body);
      return store.mutate((data) => {
        const finding = findingById(data, req.params.id);
        const program = programById(data, finding.programId);
        const transitions: Record<string, readonly string[]> = {
          hypothesis: ["hypothesis", "validated"],
          validated: ["hypothesis", "validated", "ready"],
          ready: ["hypothesis", "ready", "submitted"],
          submitted: ["submitted", "triaged", "duplicate", "rejected", "paid"],
          triaged: ["triaged", "duplicate", "rejected", "paid"],
          duplicate: ["duplicate"],
          rejected: ["rejected"],
          paid: ["paid"],
        };
        if (!transitions[finding.status].includes(input.status))
          throw new BountyError(
            409,
            "Transição inválida. Valide o achado e prepare o relatório antes de registrar o envio.",
          );
        if (["validated", "ready", "submitted"].includes(input.status)) {
          const gaps = reportGaps(
            finding,
            program,
            data.evidence.filter((e) => e.findingId === finding.id),
          );
          if (gaps.length) throw new BountyError(422, gaps.join("\n"));
        }
        if (["ready", "submitted"].includes(input.status) && !reportApproved(finding, program, data.evidence.filter(e => e.findingId === finding.id))) throw new BountyError(409, "Abra a prévia e aprove esta versão do relatório antes de avançar.");
        if (input.status === "hypothesis") finding.reportApproval = undefined;
        const reportUrl = input.reportUrl ?? finding.reportUrl;
        if (["submitted", "triaged", "paid"].includes(input.status)) {
          try {
            const url = new URL(reportUrl);
            if (
              url.protocol !== "https:" ||
              url.hostname !== "hackerone.com" ||
              !/^\/reports\/\d+\/?$/.test(url.pathname) ||
              url.username ||
              url.password ||
              url.search ||
              url.hash
            )
              throw new Error();
          } catch {
            throw new BountyError(
              422,
              "Informe o link do relatório enviado: https://hackerone.com/reports/ID",
            );
          }
        }
        if (
          input.status === "paid" &&
          (input.rewardCents ?? finding.rewardCents) <= 0
        )
          throw new BountyError(422, "Informe o valor efetivamente recebido.");
        if (input.rewardCents && input.status !== "paid")
          throw new BountyError(
            422,
            "Registre recompensa apenas quando o pagamento tiver sido recebido.",
          );
        Object.assign(finding, input, { reportUrl, updatedAt: now() });
        return finding;
      });
    },
  );
  app.get<{ Params: { id: string }; Querystring: { final?: string } }>(
    "/bounty/findings/:id/report",
    async (req, reply) => {
      const data = await store.read();
      const finding = findingById(data, req.params.id);
      const program = programById(data, finding.programId);
      return reply
        .type("text/markdown; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="hackerone-${finding.id}.md"`,
        )
        .send(
          buildReport(
            finding,
            program,
            data.evidence.filter((e) => e.findingId === finding.id),
            req.query.final === "true",
          ),
        );
    },
  );
  app.get<{ Params: { id: string } }>("/bounty/findings/:id/report/preview", async (req) => {
    const data = await store.read(), finding = findingById(data, req.params.id), program = programById(data, finding.programId);
    const evidence = data.evidence.filter(e => e.findingId === finding.id), approved = reportApproved(finding, program, evidence);
    return { markdown: buildReport(finding, program, evidence, approved), revision: reportRevision(finding, program, evidence), gaps: reportGaps(finding, program, evidence), approved, approvedAt: approved ? finding.reportApproval!.approvedAt : null };
  });
  app.post<{ Params: { id: string } }>("/bounty/findings/:id/report/approve", async (req) => {
    const input = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.body);
    return store.mutate(data => {
      const finding = findingById(data, req.params.id), program = programById(data, finding.programId), evidence = data.evidence.filter(e => e.findingId === finding.id);
      if (input.revision !== reportRevision(finding, program, evidence)) throw new BountyError(409, "O relatório mudou. Atualize a prévia e revise a versão atual.");
      const gaps = reportGaps(finding, program, evidence);
      if (gaps.length) throw new BountyError(422, gaps.join("\n"));
      if (!["validated", "ready"].includes(finding.status)) throw new BountyError(409, "Valide o achado antes de aprovar o relatório.");
      finding.reportApproval = { revision: input.revision, approvedAt: now() };
      finding.status = "ready"; finding.updatedAt = now();
      return finding;
    });
  });
  app.post<{ Params: { id: string } }>("/bounty/runs/:id/finding", async (req, reply) => {
    const input = z.object({ stageId: z.string().max(80).optional() }).parse(req.body || {});
    const finding = await store.mutate(data => {
      const run = data.runs.find(r => r.id === req.params.id);
      if (!run) throw new BountyError(404, "Execução não encontrada.");
      const program = programById(data, run.programId);
      const stage = input.stageId ? run.stages?.find(stage => stage.id === input.stageId) : undefined;
      if (input.stageId && !stage) throw new BountyError(404, "Etapa não encontrada.");
      const output = stage ? stage.output : run.output;
      if ((stage ? stage.status : run.status) !== "completed" || !output?.trim()) throw new BountyError(409, "Aguarde uma execução concluída com saída para documentar uma hipótese.");
      if (run.scopeVersion !== program.scopeVersion) throw new BountyError(409, "O escopo mudou desde esta execução. Confira o alvo antes de reutilizar os resultados.");
      requireScope(program, run.target);
      const existing = data.findings.find(f => f.sourceRunId === run.id && f.sourceStageId === input.stageId);
      if (existing) return existing;
      const value = { ...findingInput.parse({ title: `Hipótese após ${stage?.tool || run.tool}`, target: run.target, category: "Other" }), sourceRunId: run.id, sourceStageId: input.stageId, id: randomUUID(), programId: program.id, status: "hypothesis" as const, scopeVersion: program.scopeVersion, createdAt: now(), updatedAt: now(), reportUrl: "", rewardCents: 0, currency: "USD", minutesSpent: 0 };
      data.findings.unshift(value);
      const content = output.slice(0, 250000);
      data.evidence.push({ id: randomUUID(), findingId: value.id, title: `Saída ${run.tool} · ${run.id.slice(0, 8)}`, kind: "tool-output", content, createdAt: now(), sha256: createHash("sha256").update(content).digest("hex") });
      return value;
    });
    return reply.code(201).send(finding);
  });
  app.post<{ Params: { id: string } }>(
    "/bounty/programs/:id/runs",
    async (req, reply) => {
      const input = z
        .object({
          tool: z.string().min(1).max(50),
          target: z.url().max(2000),
        })
        .parse(req.body);
      if (active.size >= 2)
        throw new BountyError(
          429,
          "Duas coletas já estão em execução. Aguarde ou cancele uma delas.",
        );
      const data = await store.read();
      const program = programById(data, req.params.id);
      validateToolRequest(input.tool, input.target, program);
      if (!input.tool.startsWith("ghosthunt-") && scopeReview(program).unsupported.length) throw new BountyError(409,"Confirme o escopo web atualizado e preserve os identificadores não web como referência antes de executar.");
      if (!input.tool.startsWith("ghosthunt-")) requireAssessment(program);
      if (input.tool === "investigation" && [...activePrograms.values()].includes(program.id)) throw new BountyError(409, "Já existe uma execução neste programa. Aguarde ou cancele antes de iniciar a investigação completa.");
      if (active.size >= 2)
        throw new BountyError(429, "Duas coletas já estão em execução.");
      const run = {
        ...input,
        id: randomUUID(),
        programId: program.id,
        scopeVersion: program.scopeVersion,
        status: "running" as const,
        createdAt: now(),
        output: "",
        ...(input.tool === "investigation" ? { stages: investigationPlan(input.target, program) } : {}),
      };
      const controller = new AbortController();
      active.set(run.id, controller);
      activePrograms.set(run.id, program.id);
      try {
        await store.mutate((state) => {
          if (
            programById(state, program.id).scopeVersion !== program.scopeVersion
          )
            throw new BountyError(
              409,
              "O escopo mudou. Confira e tente novamente.",
            );
          if (!input.tool.startsWith("ghosthunt-")) requireAssessment(programById(state, program.id));
          state.runs.unshift(run);
        });
      } catch (error) {
        active.delete(run.id);
        activePrograms.delete(run.id);
        throw error;
      }
      const terminal = terminals.start(run);
      const task = withExecution(event => {
        terminal.emit(event);
        if (run.tool === "investigation" && event.stage) {
          const stage = structuredClone(event.stage);
          void store.mutate(state => { const record = state.runs.find(item => item.id === run.id); if (record?.stages) record.stages = record.stages.map(item => item.id === stage.id ? stage : item); }).catch(error => app.log.error(error));
        }
      }, () =>
        runner(input.tool, input.target, program, controller.signal),
      )
        .then(async (result) => {
          terminal.emit({
            kind: "stdout",
            text: `\nResultado filtrado da ferramenta:\n${result.output}\n`,
          });
          await store.mutate((state) => {
            const record = state.runs.find((r) => r.id === run.id)!;
            Object.assign(record, {
              output: result.output,
              status: controller.signal.aborted
                ? "interrupted"
                : result.code === 0
                  ? "completed"
                  : "failed",
              finishedAt: now(),
              ...(result.code
                ? { error: `Ferramenta terminou com código ${result.code}.` }
                : {}),
            });
          });
        })
        .catch(async (error) => {
          await store.mutate((state) => {
            const record = state.runs.find((r) => r.id === run.id)!;
            Object.assign(record, {
              status: controller.signal.aborted ? "interrupted" : "failed",
              error: (error as Error).message,
              finishedAt: now(),
            });
          });
        })
        .catch((error) => app.log.error(error))
        .finally(async () => {
          try {
            const completed = (await store.read()).runs.find(
              (r) => r.id === run.id,
            );
            if (completed && !options.runner)
              await archiveNativeRun(store.directory, program, completed).catch((error) => app.log.error(error));
            if (completed)
              await terminals
                .finish(completed)
                .catch((error) => app.log.error(error));
          } catch (error) {
            app.log.error(error);
          } finally {
            active.delete(run.id);
            activePrograms.delete(run.id);
            tasks.delete(task);
          }
        });
      tasks.add(task);
      return reply.code(202).send(run);
    },
  );
  app.get<{ Params: { id: string }; Querystring: { after?: string; transport?: string } }>(
    "/bounty/runs/:id/terminal",
    async (req, reply) => {
      z.uuid().parse(req.params.id);
      const after = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .default(0)
        .parse(req.query.after);
      const run = (await store.read()).runs.find((r) => r.id === req.params.id);
      if (!run) throw new BountyError(404, "Execução não encontrada.");
      const terminal = await terminals.get(run);
      if (req.query.transport === "poll")
        return { events: terminal.events.filter((event) => event.seq > after), ended: terminal.ended };
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      });
      reply.raw.flushHeaders();
      for (const event of terminal.events)
        if (event.seq > after)
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (terminal.ended) {
        reply.raw.end();
        return;
      }
      const unsubscribe = terminal.subscribe((event) => {
        if (event.seq > after)
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.kind === "status") reply.raw.end();
      });
      const heartbeat = setInterval(
        () => reply.raw.write(": heartbeat\n\n"),
        10000,
      );
      reply.raw.once("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/bounty/runs/:id/cancel",
    async (req) => {
      const controller = active.get(req.params.id);
      if (!controller) throw new BountyError(409, "Esta execução já terminou.");
      controller.abort();
      return { status: "cancelling" };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/bounty/programs/:id/advice",
    async (req) => {
      const input = z
        .object({
          question: z.string().trim().min(5).max(4000),
          skill: z.enum(supportedSkills),
          findingId: z.uuid().optional(),
          provider: z.enum(["local", "claude", "openai"]).optional(),
          localModel: z.string().max(250).optional(),
        })
        .parse(req.body);
      if (advicePending)
        throw new BountyError(429, "Uma consulta de IA já está em andamento.");
      advicePending = true;
      try {
        const data = await store.read();
        const program = programById(data, req.params.id);
        const finding = input.findingId
          ? findingById(data, input.findingId)
          : undefined;
        if (finding && finding.programId !== program.id)
          throw new BountyError(422, "O achado pertence a outro programa.");
        const result = await advisor({
          program,
          finding,
          question: input.question,
          skill: input.skill,
          provider: input.provider,
          localModel: input.localModel,
          evidence: data.evidence
            .filter((e) => e.findingId === finding?.id)
            .slice(-5),
          observations: data.runs
            .filter(
              (r) =>
                r.programId === program.id &&
                r.status === "completed" &&
                r.scopeVersion === program.scopeVersion,
            )
            .slice(0, 3)
            .reverse()
            .map((r) => r.output),
        });
        const value = {
          ...result,
          id: randomUUID(),
          programId: program.id,
          question: input.question,
          createdAt: now(),
        };
        await store.mutate((state) => state.advice.push(value));
        return value;
      } finally {
        advicePending = false;
      }
    },
  );
}
