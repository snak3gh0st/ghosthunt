export interface Program {
  scopeReferences?: {identifier:string;kind:"in"|"out";reason:string}[];
  assessment?: import("../../../src/bounty/assessment").ProgramAssessment;
  id: string;
  name: string;
  url: string;
  offersBounties: boolean;
  bountyNote: string;
  inScope: string[];
  outOfScope: string[];
  policy: string;
  focus: string;
  automationAllowed: boolean;
  activeTestingAllowed?: boolean;
  portScanAllowed?: boolean;
  scopeConfirmed: boolean;
  scopeVersion: number;
  updatedAt: string;
}
export interface Finding {
  sourceRunId?: string;
  reportApproval?: { revision: string; approvedAt: string };
  id: string;
  programId: string;
  title: string;
  target: string;
  category: string;
  severity: string;
  summary: string;
  preconditions: string;
  steps: string;
  expected: string;
  actual: string;
  impact: string;
  reproductionConfirmed: boolean;
  status: string;
  scopeVersion: number;
  reportUrl: string;
  rewardCents: number;
  currency: string;
  minutesSpent: number;
  updatedAt: string;
}
export interface AssessmentState { assessment: import("../../../src/bounty/assessment").ProgramAssessment | null; current: boolean; approved: boolean }
export interface ReportPreview { markdown: string; revision: string; gaps: string[]; approved: boolean; approvedAt: string | null }
export interface Evidence {
  id: string;
  findingId: string;
  title: string;
  kind: string;
  content?: string;
  createdAt: string;
  sha256: string;
}
export interface Run {
  stages?: import("../../../src/bounty/investigation-model").InvestigationStage[];
  id: string;
  programId: string;
  tool: string;
  target: string;
  status: string;
  output: string;
  error?: string;
  createdAt: string;
  scopeVersion: number;
}
export interface Advice {
  id: string;
  programId: string;
  question: string;
  answer: string;
  sources: string[];
  costUsd: number | null;
  provider?: "local" | "claude" | "openai";
  model?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  contextTruncated?: boolean;
  outputTruncated?: boolean;
}
export interface Workspace {
  programs: Program[];
  findings: Finding[];
  evidence: Evidence[];
  runs: Run[];
  advice: Advice[];
  summary: {
    programs: number;
    paidPrograms: number;
    findings: number;
    submitted: number;
    rewards: Record<string, number>;
    minutesSpent: number;
    aiCostUsd: number;
    localAdviceCount: number;
    claudeAdviceCount: number;
    openaiAdviceCount: number;
    unpricedAdviceCount: number;
  };
}
export interface CatalogProgram {
  scopeReferences?: {identifier:string;kind:"in"|"out";reason:string}[];
  handle: string;
  name: string;
  url: string;
  offersBounties: boolean;
  inScope: string[];
  outOfScope: string[];
  notes: string;
  omittedAssets: number;
  open: boolean;
}
export interface ScopeReview {scopeVersion:number;confirmed:boolean;inScope:string[];outOfScope:string[];unsupported:{identifier:string;kind:"in"|"out";reason:string}[];references:{identifier:string;kind:"in"|"out";reason:string}[];reviewToken:string}
export interface Integrations {
  toolkit?: { expected: string[]; installed: string[]; missing: string[]; legacy: {id:string;replacement:string;reason:string}[] };
  zap?: { installed: boolean; mode: string; running: boolean };
  isolation?: { engine: string; conda: boolean; imageReady: boolean; dockerReady: boolean; vpnReady: boolean; networkReady: boolean; wireguardConfigured: boolean; installedTools: Record<string, boolean>; reason: string };
  cloudAdvisorReady?: boolean;
  native?: { available: boolean; python: string; tools: { id: string; installed: boolean; mode: string }[]; engines: { id: string; role: string; phase: string; kind: string; available: boolean }[] };
  tools: {
    id: string;
    name: string;
    mode: string;
    installed: boolean;
    blockedReason?: string | null;
    description: string;
  }[];
  integrations: {
    id: string;
    name: string;
    repository: string;
    commit: string;
    installed: boolean;
  }[];
  advisorAvailable: boolean;
  claudeAvailable: boolean;
  openai: { configured: boolean; model: string };
  burp: { verified?: boolean; url: string | null; online: boolean; mode: string; tools: string[] };
  metasploit: {
    catalogInstalled: boolean;
    mode: string;
    consoleInstalled: boolean;
  };
  localModels: { id: string; backend: "ollama" | "lmstudio"; model: string }[];
  localRuntimes: {
    backend: "ollama" | "lmstudio";
    online: boolean;
    models: { id: string; model: string }[];
  }[];
  defaultProvider: "local" | "claude" | "openai";
  advisorBudgetUsd: number;
  skills: string[];
}
