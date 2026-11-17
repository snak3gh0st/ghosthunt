import { createContext, useContext } from "react";
import type { Run } from "./types";
export const ConsoleContext = createContext<{
  open: (run: Run) => void;
  launch: (programId: string, tool: string, target: string) => Promise<Run>;
  busy: boolean;
} | null>(null);
export function useConsole() {
  const context = useContext(ConsoleContext);
  if (!context) throw new Error("Console provider unavailable");
  return context;
}
