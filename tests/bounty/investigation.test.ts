import { expect, it, vi } from "vitest";
import { investigationPlan } from "../../src/bounty/investigation-model.js";
import { runInvestigation, investigationSignals } from "../../src/bounty/investigation.js";
import { withExecution, type ExecutionEvent } from "../../src/bounty/execution.js";
import { assessProgram } from "../../src/bounty/assessment.js";
import { programInput, type Program } from "../../src/bounty/model.js";
const program: Program = { ...programInput.parse({ name: "Pipeline lab", url: "https://hackerone.com/example", inScope: ["https://github.com/example/lab"], scopeConfirmed: true, automationAllowed: true, policy: "Public source review only." }), id: "pipeline-lab", scopeVersion: 1, createdAt: "", updatedAt: "" };
program.assessment = assessProgram(program, { target: program.inScope[0], objective: "Review public source trust boundaries", timeBudgetMinutes: 120, access: "public", policyReviewed: true, limits: "Do not execute fetched source; stop after sample review." }); program.assessment.approvedAt = new Date().toISOString();
function dependencies() { return { run: vi.fn().mockResolvedValue({ code: 0, output: "Completed diagnostic fixture" }), available: vi.fn().mockResolvedValue(null), advise: vi.fn().mockResolvedValue({ code: 0, output: "Local hypothesis requires proof." }), references: vi.fn().mockResolvedValue({ code: 0, output: "Metadata only" }) }; }
it("plans every tool but skips incompatible recon for source targets without broadening scope", () => {
 const plan = investigationPlan(program.inScope[0], program);
 expect(plan).toHaveLength(21);
 for (const tool of ["subfinder","gau","urlfinder","dnsx","httpx","nmap","burp-history"]) expect(plan.find(step=>step.tool===tool)?.status).toBe("skipped");
 for (const tool of ["repo-review","repo-secrets","cbh-classify"]) expect(plan.find(step=>step.tool===tool)?.status).toBe("waiting");
});
it("keeps active and TCP permissions separate and respects path-only scope", () => {
 const web = { ...program, inScope: ["https://app.example.test"], activeTestingAllowed: true };
 expect(investigationPlan(web.inScope[0],web).find(step=>step.tool==="nmap")?.status).toBe("skipped");
 expect(investigationPlan(web.inScope[0],{...web,portScanAllowed:true}).find(step=>step.tool==="nmap")?.status).toBe("waiting");
 const narrow = {...web,inScope:["https://app.example.test/private"]};
 expect(investigationPlan(narrow.inScope[0],{...narrow,portScanAllowed:true}).find(step=>step.tool==="nmap")?.status).toBe("skipped");
});
it("executes allowed tools sequentially, streams structured progress and extracts source signals", async () => {
 const deps=dependencies(), events:ExecutionEvent[]=[];
 deps.run.mockImplementation(async tool => ({code:0,output:tool==="repo-review"?"src/auth.ts:42 [Access control] check ownership":`${tool} fixture`}));
 const result=await withExecution(event=>events.push(event),()=>runInvestigation(program.inScope[0],program,deps));
 expect(result.code).toBe(0);expect(deps.run.mock.calls.map(call=>call[0])).toEqual(["ghosthunt-status","ghosthunt-doctor","ghosthunt-engines","ghosthunt-playbooks","pentest-prepare","cbh-classify","repo-review","repo-secrets","repo-semgrep","repo-trufflehog","ghosthunt-report"]);
 const review=events.filter(event=>event.stage?.tool==="repo-review").at(-1)!.stage!;
 expect(review.status).toBe("completed");expect(review.signals).toHaveLength(1);expect(review.nextStep).toContain("não é uma vulnerabilidade confirmada");
 expect(deps.advise).toHaveBeenCalledOnce();expect(deps.references).not.toHaveBeenCalled();
});
it("stops collection after a failed preparation rather than continuing on the host", async () => {
 const deps=dependencies();deps.run.mockImplementation(async tool=>({code:tool==="pentest-prepare"?1:0,output:"fixture"}));
 const result=await runInvestigation(program.inScope[0],program,deps);
 expect(result.code).toBe(1);expect(deps.run.mock.calls.some(call=>call[0]==="repo-review")).toBe(false);expect(deps.advise).not.toHaveBeenCalled();expect(result.output).toContain("blocked");
});
it("cancels the remaining queue and never starts another target tool", async () => {
 const deps=dependencies(),controller=new AbortController();deps.run.mockImplementationOnce(async()=>{controller.abort();return {code:130,output:"Cancelled fixture"};});
 const result=await runInvestigation(program.inScope[0],program,deps,controller.signal);
 expect(result.code).toBe(130);expect(deps.run).toHaveBeenCalledOnce();expect(deps.advise).not.toHaveBeenCalled();
});
it("records unavailable network tools as blocked and still permits offline analysis", async () => {
 const deps=dependencies(),events:ExecutionEvent[]=[];deps.available.mockImplementation(async tool=>tool.startsWith("repo-")?"VPN disconnected":null);
 await withExecution(event=>events.push(event),()=>runInvestigation(program.inScope[0],program,deps));
 expect(events.some(event=>event.stage?.tool==="repo-review"&&event.stage.status==="blocked")).toBe(true);
 expect(deps.run.mock.calls.some(call=>call[0]==="cbh-classify")).toBe(true);expect(deps.run.mock.calls.some(call=>call[0]==="repo-review")).toBe(false);
});
it("does not interpret an open port as a confirmed vulnerability and only looks up observed CVEs", async () => {
 expect(investigationSignals("nmap","443/tcp open https")[0]).toContain("ainda sem falha demonstrada");
 const deps=dependencies();deps.run.mockImplementation(async tool=>({code:0,output:tool==="repo-review"?"src/check.ts:9 [CVE] CVE-2024-12345 requires verification":"fixture"}));
 await runInvestigation(program.inScope[0],program,deps);expect(deps.references).toHaveBeenCalledOnce();
});
it("rejects unapproved plans before spawning any tool", async () => {
 const deps=dependencies();await expect(runInvestigation(program.inScope[0],{...program,assessment:undefined},deps)).rejects.toThrow("Avalie");expect(deps.run).not.toHaveBeenCalled();
});
