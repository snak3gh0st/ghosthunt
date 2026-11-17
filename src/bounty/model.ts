import { z } from "zod";

const text = z.string().trim();
export const scopeRules = z.array(text.min(1).max(500)).max(1000);
export const programInput = z.object({
  name: text.min(1).max(150),
  url: z.url().refine((s) => new URL(s).protocol === "https:", "Use HTTPS"),
  offersBounties: z.boolean().default(false),
  bountyNote: text.max(1000).default(""),
  inScope: scopeRules.min(1),
  outOfScope: scopeRules.default([]),
  policy: text.max(12000).default(""),
  automationAllowed: z.boolean().default(false),
  activeTestingAllowed: z.boolean().default(false),
  portScanAllowed: z.boolean().default(false),
  scopeConfirmed: z.boolean().default(false),
  focus: text.max(2000).default(""),
  scopeReferences: z.array(z.object({ identifier: text.min(1).max(500), kind: z.enum(["in", "out"]), reason: text.min(1).max(500) })).max(2000).optional(),
});
export type ProgramInput = z.infer<typeof programInput>;
export interface Program extends ProgramInput {
  assessment?: import("./assessment.js").ProgramAssessment;
  id: string;
  createdAt: string;
  updatedAt: string;
  scopeVersion: number;
}
export const findingInput = z.object({
  title: text.min(1).max(200),
  target: z.url().max(2000),
  category: text.min(1).max(100).default("Access control"),
  severity: z
    .enum(["informational", "low", "medium", "high", "critical"])
    .default("medium"),
  summary: text.max(12000).default(""),
  preconditions: text.max(8000).default(""),
  steps: text.max(16000).default(""),
  expected: text.max(8000).default(""),
  actual: text.max(8000).default(""),
  impact: text.max(12000).default(""),
  reproductionConfirmed: z.boolean().default(false),
});
export type FindingInput = z.infer<typeof findingInput>;
export const findingStatuses = [
  "hypothesis",
  "validated",
  "ready",
  "submitted",
  "triaged",
  "duplicate",
  "rejected",
  "paid",
] as const;
export interface Finding extends FindingInput {
  sourceRunId?: string;
  sourceStageId?: string;
  reportApproval?: { revision: string; approvedAt: string };
  id: string;
  programId: string;
  status: (typeof findingStatuses)[number];
  scopeVersion: number;
  createdAt: string;
  updatedAt: string;
  reportUrl: string;
  rewardCents: number;
  currency: string;
  minutesSpent: number;
}
export const evidenceInput = z.object({
  title: text.min(1).max(150),
  kind: z.enum(["request-response", "notes", "reproduction", "tool-output"]),
  content: z.string().min(1).max(250000),
});
export interface Evidence extends z.infer<typeof evidenceInput> {
  id: string;
  findingId: string;
  createdAt: string;
  sha256: string;
}
export interface Run {
  stages?: import("./investigation-model.js").InvestigationStage[];
  id: string;
  programId: string;
  tool: string;
  target: string;
  scopeVersion: number;
  status: "running" | "completed" | "failed" | "interrupted";
  createdAt: string;
  finishedAt?: string;
  output: string;
  error?: string;
}
export interface Advice {
  id: string;
  programId: string;
  question: string;
  answer: string;
  createdAt: string;
  sources: string[];
  costUsd: number | null;
  provider?: "local" | "claude" | "openai";
  model?: string;
  localBackend?: "ollama" | "lmstudio";
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  contextTruncated?: boolean;
  outputTruncated?: boolean;
}
export interface Workspace {
  version: 1;
  programs: Program[];
  findings: Finding[];
  evidence: Evidence[];
  runs: Run[];
  advice: Advice[];
}
export const emptyWorkspace = (): Workspace => ({
  version: 1,
  programs: [],
  findings: [],
  evidence: [],
  runs: [],
  advice: [],
});

export class BountyError extends Error {
  public statusCode: number;
  constructor(
    statusCode: number,
    message: string,
  ) {
    super(message);
    this.statusCode = statusCode;
  }
}
