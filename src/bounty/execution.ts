import { AsyncLocalStorage } from "node:async_hooks";

export interface ExecutionEvent {
  kind: "command" | "stdout" | "stderr" | "system" | "exit" | "status";
  text: string;
  pid?: number;
  code?: number;
  status?: string;
  stage?: import("./investigation-model.js").InvestigationStage;
}
const context = new AsyncLocalStorage<(event: ExecutionEvent) => void>();
export function executionEvent(event: ExecutionEvent) {
  context.getStore()?.(event);
}
export function withExecution<T>(
  emit: (event: ExecutionEvent) => void,
  operation: () => Promise<T>,
) {
  return context.run(emit, operation);
}
