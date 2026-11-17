import { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, ShieldAlert, ArrowUpRight, RefreshCw, Upload } from "lucide-react";
import { api } from "../lib/api";
import { ErrorNote, External } from "./shared";
import type { Integrations } from "./types";
export default function IsolationPanel({ data, compact = false, refresh }: { data: Integrations; compact?: boolean; refresh?: () => unknown }) {
  const [busy, setBusy] = useState(""), [message, setMessage] = useState(""), [error, setError] = useState<unknown>(null);
  const state = data.isolation;
  if (!state) return null;
  const ReadyIcon = state.networkReady ? ShieldCheck : ShieldAlert;
  async function upload(file?: File) {
    if (!file) return;
    setError(null); setMessage(""); setBusy("upload");
    try {
      if (file.size > 20000) throw new Error("A configuração deve ter até 20 KB.");
      await api.post("/bounty/isolation/wireguard", { content: await file.text() });
      setMessage("Arquivo WireGuard armazenado de forma privada. Agora conecte a VPN.");
      refresh?.();
    } catch (e) { setError(e); } finally { setBusy(""); }
  }
  async function connect() {
    setError(null); setBusy("connect");
    try { await api.post("/bounty/isolation/start"); setMessage("Conexão iniciada. Aguarde alguns segundos e verifique o estado."); refresh?.(); }
    catch (e) { setError(e); } finally { setBusy(""); }
  }
  if (compact) return <div className={`b-protection-strip ${state.networkReady ? "is-ready" : ""}`}><ReadyIcon size={18} /><div><strong>{state.networkReady ? "Executor protegido pronto" : "Análises de rede bloqueadas"}</strong><span>Docker {state.dockerReady ? "ativo" : "parado"} · Conda {state.conda ? "pronto" : "pendente"} · VPN {state.vpnReady ? "conectada" : "pendente"}</span></div><Link to="/integrations#isolation">Configurar proteção<ArrowUpRight size={14} /></Link></div>;
  return <section className="b-section b-isolation-panel" id="isolation">
    <div className="b-section-head"><h2><ReadyIcon size={18} /> Execução protegida</h2><button className="b-button b-secondary" disabled={!!busy} onClick={() => refresh?.()}><RefreshCw size={14} />Verificar estado</button></div>
    <div className="b-padded">
      <div className="b-runtime-states">{[["Docker", state.dockerReady], ["Conda", state.conda], ["Imagem", state.imageReady], ["VPN", state.vpnReady]].map(([label, ready]) => <span className={`b-badge ${ready ? "b-completed" : ""}`} key={String(label)}>{label}: {ready ? "pronto" : "pendente"}</span>)}</div>
      <p className="b-notice">{state.reason}</p>
      <p className="b-help">Cada investigação usa um container novo, sem privilégios, com disco somente leitura e ambiente Conda. Ferramentas offline ficam sem rede. As demais compartilham somente a rede do gateway Proton; análises de rede exigem um gateway saudável e a conferência do IP antes de acessar o alvo.</p>
      <div className="b-vpn-setup">
        <div><strong>Conectar seu Proton VPN</strong><p className="b-help">Na conta Proton, gere uma configuração WireGuard para Linux. Importe o arquivo .conf aqui. A chave fica em arquivo privado neste Mac, fora do repositório e dos containers de análise.</p><External href="https://protonvpn.com/support/wireguard-configurations/">Como gerar a configuração WireGuard</External></div>
        <div className="b-vpn-actions"><label className="b-button b-secondary"><Upload size={14} />{busy === "upload" ? "Importando…" : "Importar arquivo .conf"}<input type="file" accept=".conf" aria-label="Importar configuração WireGuard" disabled={!!busy} onChange={(e) => void upload(e.target.files?.[0])} /></label><button className="b-button" onClick={() => void connect()} disabled={!!busy || !state.imageReady || !state.wireguardConfigured}>{busy === "connect" ? "Conectando…" : "Conectar VPN"}</button></div>
      </div>
      {message && <p className="b-help" role="status">{message}</p>}<ErrorNote error={error} />
      <details className="b-runtime-inventory"><summary>Inventário da imagem: {Object.values(state.installedTools).filter(Boolean).length} ferramentas instaladas</summary><div>{Object.entries(state.installedTools).map(([name, installed]) => <span key={name}><code>{name}</code><span className="b-badge">{installed ? "Instalada" : "Ausente"}</span></span>)}</div></details>
      {!state.imageReady && <div className="b-command"><code>npm run isolation:prepare</code></div>}
    </div>
  </section>;
}
