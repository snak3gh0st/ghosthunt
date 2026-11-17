import { expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
vi.mock("../../src/bounty/process.js", () => ({ runProcess: vi.fn(), binaryPath: vi.fn() }));
import { runProcess } from "../../src/bounty/process.js";
import { containerArgs, runIsolatedTool, dockerPrefix } from "../../src/bounty/isolation.js";
import { validateWireGuard, saveWireGuard, ipv4WireGuard } from "../../src/bounty/vpn.js";
import { programInput, type Program } from "../../src/bounty/model.js";
let directory: string;
const image = "sha256:" + "a".repeat(64), vpnImage = "sha256:" + "b".repeat(64);
const name = "ghosthunt-job-12345678-1234-1234-1234-123456789012";
const wireguard = `[Interface]\nPrivateKey = ${"A".repeat(43)}=\nAddress = 10.2.0.2/32\nDNS = 10.2.0.1\n[Peer]\nPublicKey = ${"B".repeat(43)}=\nAllowedIPs = 0.0.0.0/0, ::/0\nEndpoint = 8.8.8.8:51820\n`;
const program: Program = { ...programInput.parse({ name: "Isolation test", url: "https://hackerone.com/example", inScope: ["https://github.com/example/source"], automationAllowed: true, scopeConfirmed: true }), id: "test", createdAt: "", updatedAt: "", scopeVersion: 1 };
beforeEach(async () => { vi.clearAllMocks(); directory = await mkdtemp(join(tmpdir(), "ghosthunt-isolation-")); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
it("builds a non-root read-only limited container with no network for offline work", () => {
  const args = containerArgs(image, name);
  expect(args).toContain("--cap-drop=ALL"); expect(args).toContain("--read-only"); expect(args).toContain("1000:1000"); expect(args).toContain("no-new-privileges:true"); expect(args).toContain("1536m"); expect(args).toContain("--pids-limit"); expect(args[args.indexOf("--network") + 1]).toBe("none");
  expect(args).not.toContain("--privileged"); expect(args).not.toContain("--volume"); expect(args).not.toContain("--mount"); expect(args.at(-1)).toBe(image);
});
it("only shares a verified gateway namespace and a read-only resolver file", () => {
  const args = containerArgs(image, name, "c".repeat(64), "/private/runtime/resolv.conf");
  expect(args).toContain("container:" + "c".repeat(64));
  expect(args.filter((arg) => arg.startsWith("type=bind"))).toEqual(["type=bind,source=/private/runtime/resolv.conf,target=/etc/resolv.conf,readonly"]);
  expect(args.join(" ")).not.toMatch(/docker\.sock|ssh-auth|\/Users|\/\.ssh/);
});
it("rejects unpinned images, unsafe names, gateway IDs and mount separators", () => {
  expect(() => containerArgs("ghosthunt:latest", name)).toThrow();
  expect(() => containerArgs(image, "other-container")).toThrow();
  expect(() => containerArgs(image, name, "container:host", "/tmp/x")).toThrow();
  expect(() => containerArgs(image, name, "c".repeat(64), "/tmp/x,readonly=false")).toThrow();
  vi.stubEnv("GHOSTHUNT_DOCKER_CONTEXT", "unsafe; command"); expect(() => dockerPrefix()).toThrow();
});
it("stores WireGuard privately and rejects hooks, split routing and private endpoints", async () => {
  await saveWireGuard(directory, wireguard);
  const path = join(directory, "runtime", "wg0.conf");
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await readFile(join(directory, "runtime", "resolv.conf"), "utf8")).toContain("nameserver 127.0.0.1");
  expect(() => validateWireGuard(wireguard + "PostUp = curl https://bad.test\n")).toThrow();
  expect(() => validateWireGuard(wireguard.replace("0.0.0.0/0", "10.0.0.0/8"))).toThrow();
  expect(() => validateWireGuard(wireguard.replace("8.8.8.8", "192.168.1.1"))).toThrow();
});
it("fails closed without a healthy VPN and never starts a target worker or host tool", async () => {
  await mkdir(join(directory, "runtime"));
  await writeFile(join(directory, "runtime", "config.json"), JSON.stringify({ imageId: image, vpnImageId: vpnImage, hostEgressHash: "d".repeat(64) }));
  vi.mocked(runProcess).mockImplementation(async (_binary, args) => {
    if (args.includes("info")) return { code: 0, output: "29.2.1" };
    if (args.includes("--inventory")) return { code: 0, output: JSON.stringify({ conda: "base", prefix: "/opt/conda", uid: 1000, tools: { python3: true } }) };
    return { code: 1, output: "" };
  });
  await expect(runIsolatedTool(directory, "repo-review", program.inScope[0], program)).rejects.toThrow("VPN");
  const calls = vi.mocked(runProcess).mock.calls;
  expect(calls.every(([binary]) => binary === "docker")).toBe(true);
  expect(calls.filter(([, args]) => args.includes("run")).every(([, args]) => args.includes("--inventory"))).toBe(true);
});
it("does not fall back to direct execution when Docker is unavailable", async () => {
  vi.mocked(runProcess).mockRejectedValue(new Error("Docker offline"));
  await expect(runIsolatedTool(directory, "cbh-classify", program.inScope[0], program)).rejects.toThrow("Docker");
  expect(vi.mocked(runProcess).mock.calls.every(([binary]) => binary === "docker")).toBe(true);
});
it("forwards an explicitly selected OpenAI call only through the protected worker, with its key on stdin", async () => {
  const { protectedOpenAICompletion } = await import("../../src/bounty/isolation.js");
  const fakeKey = "sk-test-only-never-a-real-credential-1234567890";
  vi.stubEnv("OPENAI_API_KEY", fakeKey);
  await mkdir(join(directory, "runtime"));
  await writeFile(join(directory, "runtime", "config.json"), JSON.stringify({ imageId: image, vpnImageId: vpnImage, hostEgressHash: "d".repeat(64) }));
  await writeFile(join(directory, "runtime", "resolv.conf"), "nameserver 127.0.0.1\noptions timeout:2 attempts:2\n");
  const answer = { answer: "Test response", provider: "openai", model: "test-model", durationMs: 10, costUsd: null, outputTruncated: false, inputTokens: 100, outputTokens: 20 };
  vi.mocked(runProcess).mockImplementation(async (_binary, args, options) => {
    if (args.includes("info")) return { code: 0, output: "29.2.1" };
    if (args.includes("--inventory")) return { code: 0, output: JSON.stringify({ conda: "base", prefix: "/opt/conda", uid: 1000, tools: { python3: true } }) };
    if (args.includes("inspect")) return { code: 0, output: JSON.stringify([{ Id: "c".repeat(64), Image: vpnImage, Config: { Labels: { app: "ghosthunt-vpn" }, Env: ["FIREWALL=on"] }, State: { Running: true, Health: { Status: "healthy" } }, HostConfig: { NetworkMode: "bridge" } }]) };
    if (args.includes("run")) {
      const input = JSON.parse(options.input!);
      expect(input.tool).toBe("openai-advice"); expect(input.openai.apiKey).toBe(fakeKey);
      expect(args.join(" ")).not.toContain(fakeKey); expect(args).toContain("container:" + "c".repeat(64));
      options.onStdout?.(JSON.stringify({ type: "result", result: { code: 0, output: JSON.stringify(answer) }, artifacts: [] }) + "\n");
    }
    return { code: 0, output: "" };
  });
  expect(await protectedOpenAICompletion(directory, program, "System", "Selected evidence")).toMatchObject(answer);
  expect(vi.mocked(runProcess).mock.calls.every(([binary]) => binary === "docker")).toBe(true);
});

it("normalizes a dual-stack Proton export to an IPv4-only gateway without altering keys", () => {
  const dual = wireguard.replace("Address = 10.2.0.2/32", "Address = 10.2.0.2/32, 2a07:b944::2:2/128").replace("DNS = 10.2.0.1", "DNS = 10.2.0.1, 2a07:b944::1");
  const normalized = ipv4WireGuard(dual);
  expect(normalized).toContain("Address = 10.2.0.2/32\n");
  expect(normalized).toContain("AllowedIPs = 0.0.0.0/0\n");
  expect(normalized).not.toContain("2a07:"); expect(normalized).not.toContain("::/0");
  expect(normalized).toContain(`PrivateKey = ${"A".repeat(43)}=`);
  expect(dual).toContain("2a07:b944::2:2/128");
});
it("rejects duplicate endpoint directives and IPv6-only interface configurations", () => {
  expect(() => ipv4WireGuard(wireguard + "Endpoint = 127.0.0.1:51820\n")).toThrow("duplicadas");
  expect(() => ipv4WireGuard(wireguard.replace("10.2.0.2/32", "2a07:b944::2:2/128"))).toThrow("IPv4");
});
