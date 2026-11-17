import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  Download,
  ArrowUpToLine,
  ArrowDownToLine,
  Maximize2,
  Minimize2,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { api } from "../lib/api";
import { useRefresh, statusLabels } from "./data";
import type { Run } from "./types";

type Event = {
  seq: number;
  time: string;
  kind: "command" | "stdout" | "stderr" | "system" | "exit" | "status";
  text: string;
  pid?: number;
  status?: string;
};
export default function TerminalDock({
  run,
  onClose,
}: {
  run: Run;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null),
    transcript = useRef("");
  const [status, setStatus] = useState(run.status),
    [pid, setPid] = useState<number>(),
    [expanded, setExpanded] = useState(false),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false);
  const refresh = useRefresh();
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  const cancel = useCallback(async () => {
    try {
      await api.post(`/bounty/runs/${run.id}/cancel`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [run.id]);
  const cancelRef = useRef(cancel);
  useEffect(() => {
    cancelRef.current = cancel;
  }, [cancel]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const controller = new AbortController();
    transcript.current = "";
    const term = new Terminal({
      fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",monospace',
      fontSize: 12,
      lineHeight: 1.4,
      convertEol: true,
      scrollback: 6000,
      cursorBlink: false,
      screenReaderMode: true,
      theme: {
        background: "#060c09",
        foreground: "#d9ebdf",
        cursor: "#baff46",
        selectionBackground: "#29442e",
        black: "#09120d",
        green: "#baff46",
        cyan: "#68e1e1",
        red: "#ff718e",
        yellow: "#e4da85",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    terminal.current = term;
    fit.fit();
    term.textarea?.setAttribute(
      "aria-label",
      "Terminal da ferramenta. Ctrl+C cancela o processo.",
    );
    if (matchMedia("(pointer:fine)").matches) term.focus();
    const resized = new ResizeObserver(() => {
      if (element.clientWidth && element.clientHeight) fit.fit();
    });
    resized.observe(element);
    let finished = run.status !== "running";
    const input = term.onData((data) => {
      if (data === "\x03" && !finished) void cancelRef.current();
    });
    const colors = {
      command: "\x1b[1;32m",
      stdout: "\x1b[0m",
      stderr: "\x1b[33m",
      system: "\x1b[36m",
      exit: "\x1b[90m",
      status: "\x1b[1;32m",
    };
    let sequence = 0;
    const show = (event: Event) => {
      if (event.seq <= sequence) return;
      sequence = event.seq;
      if (event.pid) setPid(event.pid);
      transcript.current += event.text;
      term.write(colors[event.kind] + event.text + "\x1b[0m");
      if (event.status) {
        finished = true;
        setStatus(event.status);
        void refreshRef.current();
      }
    };
    const poll = async () => {
      let failures = 0;
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(`/api/bounty/runs/${run.id}/terminal?transport=poll&after=${sequence}`, {
            headers: { "x-api-key": localStorage.getItem("ghosthunt_api_key") || "" }, signal: controller.signal,
          });
          if (!response.ok) throw new Error("Terminal indisponível.");
          const body: { events: Event[]; ended: boolean } = await response.json();
          body.events.forEach(show);
          setConnected(true); setError(""); failures = 0;
          if (body.ended) { setConnected(false); return; }
        } catch (e) {
          if (controller.signal.aborted) return;
          setConnected(false);
          setError(e instanceof Error ? e.message : "Conexão interrompida.");
          if (++failures >= 3) return;
        }
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); };
          const timer = setTimeout(done, 750);
          controller.signal.addEventListener("abort", done, { once: true });
        });
      }
    };
    const stream = async () => {
      for (
        let attempt = 0;
        attempt < 3 && !controller.signal.aborted;
        attempt++
      ) {
        try {
          const response = await fetch(
            `/api/bounty/runs/${run.id}/terminal?after=${sequence}`,
            {
              headers: {
                "x-api-key": localStorage.getItem("ghosthunt_api_key") || "",
              },
              signal: controller.signal,
            },
          );
          if (!response.ok || !response.body) {
            const body = await response.json();
            throw new Error(body.error || "Terminal indisponível.");
          }
          setConnected(true);
          setError("");
          const reader = response.body.getReader(),
            decoder = new TextDecoder();
          let pending = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            const frames = pending.split("\n\n");
            pending = frames.pop() || "";
            for (const frame of frames) {
              if (frame.startsWith("data: ")) show(JSON.parse(frame.slice(6)));
            }
          }
          setConnected(false);
          if (finished) return;
          throw new Error("Fluxo interrompido. Reconectando ao processo…");
        } catch (e) {
          if (controller.signal.aborted) return;
          setConnected(false);
          setError(
            e instanceof Error
              ? e.message
              : "Conexão do terminal interrompida.",
          );
        }
      }
    };
    const polling = location.hostname.endsWith(".trycloudflare.com") || new URLSearchParams(location.search).get("terminal") === "poll";
    void (polling ? poll() : stream());
    return () => {
      controller.abort();
      resized.disconnect();
      input.dispose();
      term.dispose();
      terminal.current = null;
    };
  }, [run.id, run.status]);
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([transcript.current], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `ghosthunt-terminal-${run.id}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section
      className={`b-terminal-dock ${expanded ? "is-expanded" : ""}`}
      data-status={status}
      aria-label="Terminal real da ferramenta"
    >
      <header className="b-terminal-head">
        <div>
          <TerminalSquare size={17} />
          <strong>{run.tool}</strong>
          <span className="b-terminal-session">{run.id.slice(0, 8)}</span>
          <span className="b-terminal-state" role="status">
            {statusLabels[status] || status}
            {pid ? ` · PID ${pid}` : ""}
          </span>
        </div>
        <div className="b-terminal-actions">
          {status === "running" && (
            <button
              onClick={() => void cancel()}
              aria-label="Cancelar processo"
            >
              <Square size={13} />
              Ctrl+C
            </button>
          )}
          <button onClick={download} aria-label="Baixar transcrição">
            <Download size={16} />
          </button>
          <button
            onClick={() => terminal.current?.scrollToTop()}
            aria-label="Início da transcrição"
          >
            <ArrowUpToLine size={16} />
          </button>
          <button
            onClick={() => terminal.current?.scrollToBottom()}
            aria-label="Fim da transcrição"
          >
            <ArrowDownToLine size={16} />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? "Reduzir terminal" : "Expandir terminal"}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button onClick={onClose} aria-label="Fechar terminal">
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="b-terminal-target">
        {run.target}
        <span>
          {connected ? "STREAM CONECTADO" : "TRANSCRIÇÃO"} · saída real de
          processos / operações
        </span>
      </div>
      <div className="b-xterm-host" ref={host} data-testid="live-terminal" />
      <footer className="b-terminal-footer">
        <span>
          STDOUT / STDERR · credenciais comuns mascaradas · fechar preserva a
          execução
        </span>
        {error && <span role="alert">{error}</span>}
      </footer>
    </section>
  );
}
