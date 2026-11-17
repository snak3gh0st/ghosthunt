import { describe, expect, it } from "vitest";
import { assessProgram, assessmentState, requireAssessment } from "../../src/bounty/assessment.js";
import { programInput, type Program } from "../../src/bounty/model.js";
const program: Program = { ...programInput.parse({ name: "Assessment lab", url: "https://hackerone.com/example", inScope: ["https://app.example.test/api"], outOfScope: ["https://app.example.test/api/admin"], policy: "Researcher accounts only.", scopeConfirmed: true, offersBounties: true, automationAllowed: true }), id: "lab", scopeVersion: 1, createdAt: "", updatedAt: "" };
const input = { target: "https://app.example.test/api/user", objective: "Compare ownership checks in two test accounts", timeBudgetMinutes: 120, access: "test-accounts", policyReviewed: true, limits: "Only controlled data; stop on third party data." };
describe("program selection assessment", () => {
  it("records feasibility, unknown rewards and a bounded plan without treating readiness as profit", () => {
    const value = assessProgram(program, input);
    expect(value.blockers).toEqual([]); expect(value.plan.join(" ")).toContain("120 minutos");
    expect(value.warnings.join(" ")).toContain("ganho garantido");
    expect(value.warnings.join(" ")).toContain("recompensa");
    expect(assessmentState({ ...program, assessment: value }).approved).toBe(false);
    value.approvedAt = new Date().toISOString();
    expect(assessmentState({ ...program, assessment: value }).approved).toBe(true);
  });
  it("blocks excluded assets, missing policy review, missing limits and unavailable access", () => {
    const value = assessProgram(program, { ...input, target: "https://app.example.test/api/admin", access: "pending", policyReviewed: false, limits: "" });
    expect(value.blockers).toHaveLength(4); expect(value.recommendation).toBe("hold");
    value.approvedAt = new Date().toISOString();
    expect(() => requireAssessment({ ...program, assessment: value })).toThrow("Avalie");
  });
  it("invalidates approval when policy, reward assumptions, focus or scope version changes", () => {
    const assessment = assessProgram(program, input); assessment.approvedAt = new Date().toISOString();
    for (const change of [{ policy: "Changed" }, { offersBounties: false }, { bountyNote: "Different reward eligibility" }, { focus: "New investigation" }, { scopeVersion: 2 }]) {
      const changed = { ...program, assessment, ...change };
      expect(assessmentState(changed).current).toBe(false); expect(() => requireAssessment(changed)).toThrow();
    }
  });
  it("keeps non-paying practice programs explicit and never broadens wildcard scope", () => {
    const wildcard = { ...program, offersBounties: false, inScope: ["*.example.test"] };
    const value = assessProgram(wildcard, { ...input, target: "https://example.test" });
    expect(value.blockers.join(" ")).toContain("fora do escopo");
    expect(value.warnings.join(" ")).toContain("receita prevista");
    expect(wildcard.inScope).toEqual(["*.example.test"]);
  });
});
