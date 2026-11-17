import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isIP } from "node:net";
import { BountyError } from "./model.js";
import { docker, isolationConfig, isolationStatus, vpnName } from "./isolation.js";
import { publicAddress } from "./expanded-tools.js";
export function validateWireGuard(content: string) {
  if (Buffer.byteLength(content) > 20000 || !content.includes("[Interface]") || !content.includes("[Peer]")) throw new BountyError(422, "Selecione uma configuração WireGuard válida.");
  const sections = content.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("["));
  if (sections.length !== 2 || sections[0] !== "[Interface]" || sections[1] !== "[Peer]") throw new BountyError(422, "Use uma configuração com uma interface e um peer WireGuard.");
  const value = (key: string) => new RegExp(`^\\s*${key}\\s*=\\s*([^#\\r\\n]+)`, "m").exec(content)?.[1].trim() || "";
  if (!["PrivateKey", "PublicKey"].every((key) => /^[A-Za-z0-9+/]{43}=$/.test(value(key)))) throw new BountyError(422, "Configuração WireGuard incompleta.");
  if (!value("AllowedIPs").split(",").map((s) => s.trim()).includes("0.0.0.0/0")) throw new BountyError(422, "A VPN deve cobrir a rota IPv4 completa.");
  const endpoint = value("Endpoint");
  const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(endpoint);
  if (!match || !isIP(match[1]) || !publicAddress(match[1]) || Number(match[2]) < 1 || Number(match[2]) > 65535) throw new BountyError(422, "Use um endpoint WireGuard IPv4 público na configuração do Proton.");
  // Only supported WireGuard keys, no executable hooks or arbitrary configuration extensions.
  const allowed = new Set(["PrivateKey", "Address", "DNS", "MTU", "PublicKey", "PresharedKey", "AllowedIPs", "Endpoint", "PersistentKeepalive"]);
  const seen = new Set<string>();
  for (const line of content.split("\n")) {
    const text = line.trim();
    if (!text || text.startsWith("#") || text.startsWith("[")) continue;
    const key = text.split("=", 1)[0].trim();
    if (!allowed.has(key)) throw new BountyError(422, "A configuração contém diretivas não suportadas.");
    if (seen.has(key)) throw new BountyError(422, "A configuração contém diretivas duplicadas.");
    seen.add(key);
  }
}
/** Gluetun is deliberately IPv4-only; Proton exports may also contain IPv6. */
export function ipv4WireGuard(content: string) {
  validateWireGuard(content);
  let hasAddress = false;
  const normalized = content.split("\n").map((line) => {
    const match = /^\s*(Address|DNS|AllowedIPs)\s*=\s*([^#\r\n]+)/.exec(line);
    if (!match) return line;
    if (match[1] === "AllowedIPs") return "AllowedIPs = 0.0.0.0/0";
    const values = match[2].split(",").map((value) => value.trim()).filter((value) => isIP(value.split("/")[0]) === 4);
    if (match[1] === "Address") {
      if (!values.length || values.some((value) => !/^\d{1,3}(?:\.\d{1,3}){3}\/(?:[1-9]|[12][0-9]|3[0-2])$/.test(value))) throw new BountyError(422, "A configuração precisa de um endereço de interface IPv4 válido.");
      hasAddress = true;
    }
    return values.length ? `${match[1]} = ${values.join(", ")}` : "";
  }).join("\n").trim() + "\n";
  if (!hasAddress) throw new BountyError(422, "A configuração precisa de um endereço de interface IPv4.");
  validateWireGuard(normalized);
  return normalized;
}
export async function saveWireGuard(directory: string, content: string) {
  const normalized = ipv4WireGuard(content);
  const folder = join(directory, "runtime");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(join(folder, "wg0.conf"), normalized, { mode: 0o600 });
  await writeFile(join(folder, "resolv.conf"), "nameserver 127.0.0.1\noptions timeout:2 attempts:2\n", { mode: 0o600 });
  return { configured: true };
}
export async function startVpn(directory: string) {
  const config = await isolationConfig(directory);
  if (!config) throw new BountyError(503, "Prepare a imagem Docker primeiro.");
  const folder = join(directory, "runtime");
  let content: string;
  try { content = await readFile(join(folder, "wg0.conf"), "utf8"); } catch { throw new BountyError(409, "Importe a configuração WireGuard do Proton primeiro."); }
  validateWireGuard(content);
  // A diagnostic comparison only; never contact a selected target through the host.
  const response = await fetch("https://api.ipify.org", { redirect: "error", signal: AbortSignal.timeout(10000) });
  const ip = (await response.text()).trim();
  if (!response.ok || !isIP(ip)) throw new BountyError(502, "Não foi possível registrar a referência de saída do Mac.");
  config.hostEgressHash = createHash("sha256").update(ip).digest("hex");
  await writeFile(join(folder, "config.json"), JSON.stringify(config, null, 2), { mode: 0o600 });
  const mount = `type=bind,source=${join(folder, "wg0.conf")},target=/gluetun/wireguard/wg0.conf,readonly`;
  if (/[,\r\n]/.test(join(folder, "wg0.conf"))) throw new BountyError(503, "Caminho de configuração inválido.");
  const previous = await docker(["inspect", vpnName], { onStdout: () => {}, onStderr: () => {} });
  if (previous.code === 0) {
    const existing = JSON.parse(previous.output)[0];
    if (existing.Config?.Labels?.app !== "ghosthunt-vpn") throw new BountyError(409, "Existe um container com este nome que não pertence ao Ghosthunt.");
    await docker(["rm", "--force", vpnName], { onStdout: () => {}, onStderr: () => {} });
  }
  // The trusted gateway initializes /etc/passwd and file ownership at startup. Tool
  // containers retain their separate read-only, non-root, capability-free policy.
  const result = await docker(["run", "--detach", "--pull=never", "--name", vpnName, "--label", "app=ghosthunt-vpn", "--cap-drop=ALL", "--cap-add=NET_ADMIN", "--cap-add=CHOWN", "--cap-add=SETUID", "--cap-add=SETGID", "--device=/dev/net/tun", "--security-opt", "no-new-privileges:true", "--pids-limit", "128", "--memory", "256m", "--cpus", "0.5", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=32m", "--tmpfs", "/gluetun:rw,nosuid,nodev,noexec,size=32m", "--mount", mount, "--env", "VPN_SERVICE_PROVIDER=custom", "--env", "VPN_TYPE=wireguard", "--env", "FIREWALL=on", "--env", "DNS_SERVER=on", "--env", "DNS_UPSTREAM_RESOLVER_TYPE=dot", "--env", "DNS_UPSTREAM_IPV6=off", "--env", "PUBLICIP_FILE=/tmp/ghosthunt-public-ip", "--env", "IPV6=off", config.vpnImageId], { timeout: 30000, onStdout: () => {}, onStderr: () => {} });
  if (result.code) throw new BountyError(502, "Não foi possível iniciar o gateway VPN. Confira o Docker e o arquivo WireGuard.");
  return { starting: true, message: "Gateway iniciado. Aguarde a conexão antes de analisar.", isolation: await isolationStatus(directory, true) };
}
