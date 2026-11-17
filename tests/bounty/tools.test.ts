import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../src/bounty/process.js", () => ({
  binaryPath: vi.fn().mockResolvedValue("/usr/bin/python3"),
  runProcess: vi.fn(),
}));
import { runProcess } from "../../src/bounty/process.js";
import { makeInProcessToolRunner, validateToolRequest } from "../../src/bounty/tools.js";
import { programInput, type Program } from "../../src/bounty/model.js";
const target = "https://github.com/example/lab";
const program: Program = {
  ...programInput.parse({
    name: "Lab",
    url: "https://hackerone.com/example",
    inScope: [target],
    scopeConfirmed: true,
    automationAllowed: true,
  }),
  id: "lab",
  scopeVersion: 1,
  createdAt: "",
  updatedAt: "",
};
beforeEach(() => vi.clearAllMocks());
it("treats a classifier no-match as a completed neutral result", async () => {
  vi.mocked(runProcess).mockResolvedValue({
    code: 1,
    output: "No high-confidence matches. Try recon.",
    stderr: "",
  });
  const result = await makeInProcessToolRunner("/tmp")("cbh-classify", target, program);
  expect(result.code).toBe(0);
  expect(result.output).toContain("nenhum padrão");
});
it("preserves real classifier errors and diagnostics", async () => {
  vi.mocked(runProcess).mockResolvedValue({
    code: 1,
    output: "No high-confidence matches.",
    stderr: "Traceback: unexpected error",
  });
  const result = await makeInProcessToolRunner("/tmp")("cbh-classify", target, program);
  expect(result.code).toBe(1);
  expect(result.output).toContain("Traceback");
});
it("rejects repository/domain mismatches before starting a process", async () => {
  expect(() => validateToolRequest("subfinder", target, program)).toThrow(
    "compartilhada",
  );
  await expect(
    makeInProcessToolRunner("/tmp")("subfinder", target, program),
  ).rejects.toThrow("compartilhada");
  expect(runProcess).not.toHaveBeenCalled();
});
