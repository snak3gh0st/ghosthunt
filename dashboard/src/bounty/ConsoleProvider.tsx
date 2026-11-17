import { useCallback, useState, lazy, Suspense, type ReactNode } from "react";
import { api } from "../lib/api";
import type { Run } from "./types";
import { ConsoleContext } from "./console-context";
const TerminalDock = lazy(() => import("./TerminalDock"));
import { useRefresh } from "./data";

export default function ConsoleProvider({ children }: { children: ReactNode }) {
  const [run, setRun] = useState<Run | null>(null),
    [busy, setBusy] = useState(false);
  const refresh = useRefresh();
  const open = useCallback((value: Run) => setRun(value), []);
  const launch = async (programId: string, tool: string, target: string) => {
    setBusy(true);
    try {
      const value = await api.post<Run>(`/bounty/programs/${programId}/runs`, {
        tool,
        target,
      });
      setRun(value);
      await refresh();
      return value;
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConsoleContext.Provider value={{ open, launch, busy }}>
      <div className={run?.tool === "investigation" ? "b-investigation-active" : undefined}>{children}</div>
      {run && (
        <div className={`bounty-app b-console-layer ${run.tool === "investigation" ? "b-investigation-console" : ""}`}>
          <Suspense
            fallback={
              <div className="b-terminal-dock b-terminal-empty">
                Abrindo terminal…
              </div>
            }
          >
            <TerminalDock key={run.id} run={run} onClose={() => setRun(null)} />
          </Suspense>
        </div>
      )}
    </ConsoleContext.Provider>
  );
}
