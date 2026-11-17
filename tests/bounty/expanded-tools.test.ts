import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../src/bounty/process.js", () => ({
  binaryPath: vi.fn().mockResolvedValue("/test/tool"),
  runProcess: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));
import { runProcess } from "../../src/bounty/process.js";
import { lookup } from "node:dns/promises";
import {
  runExpandedTool,
  publicAddress,
} from "../../src/bounty/expanded-tools.js";
import { validateToolRequest } from "../../src/bounty/tools.js";
import { programInput, type Program } from "../../src/bounty/model.js";
const program: Program = {
  ...programInput.parse({
    name: "Lab",
    url: "https://hackerone.com/example",
    inScope: ["https://app.example.test/path"],
    scopeConfirmed: true,
    automationAllowed: true,
  }),
  id: "p",
  scopeVersion: 1,
  createdAt: "",
  updatedAt: "",
};
afterEach(() => vi.clearAllMocks());
it("executes Nmap only with separate permission, a pinned public IPv4 and the selected URL port", async () => {
 const p={...program,inScope:["https://app.example.test:8443"],activeTestingAllowed:true,portScanAllowed:true};
 vi.mocked(runProcess).mockResolvedValue({code:0,output:"8443/tcp open https-alt"});
 expect(()=>validateToolRequest("nmap","https://app.example.test:8443",{...p,portScanAllowed:false})).toThrow("TCP");
 await runExpandedTool("/tmp","nmap","https://app.example.test:8443",p);
 const args=vi.mocked(runProcess).mock.calls.at(-1)![1];expect(args).toContain("8443");expect(args.at(-1)).toBe("93.184.216.34");expect(args).toContain("-sT");expect(args).not.toContain("-sV");expect(args).not.toContain("--script");
 vi.mocked(lookup).mockResolvedValueOnce([{address:"127.0.0.1",family:4}] as never);
 await expect(runExpandedTool("/tmp","nmap","https://app.example.test:8443",p)).rejects.toThrow("públicos");
});
it("requires explicit active permission and keeps passive domain restrictions", () => {
  expect(() =>
    validateToolRequest("httpx", "https://app.example.test/path", program),
  ).toThrow("ativas");
  expect(() =>
    validateToolRequest("httpx", "https://app.example.test/path", {
      ...program,
      activeTestingAllowed: true,
    }),
  ).not.toThrow();
  expect(() =>
    validateToolRequest("gau", "https://app.example.test/path", program),
  ).toThrow("restrito");
  expect(() =>
    validateToolRequest("burp-history", "https://app.example.test/path", {
      ...program,
      automationAllowed: false,
    }),
  ).not.toThrow();
});
it("queries one exact HTTP URL without redirect following, fallback or response dumps", async () => {
  vi.mocked(runProcess).mockResolvedValue({
    code: 0,
    output:
      JSON.stringify({
        url: "https://app.example.test/path",
        status_code: 200,
        title: "Lab",
        body: "not stored",
      }) +
      "\n" +
      JSON.stringify({ url: "https://outside.test", status_code: 200 }),
  });
  const result = await runExpandedTool(
    "/tmp",
    "httpx",
    "https://app.example.test/path",
    { ...program, activeTestingAllowed: true },
  );
  expect(result?.output).toContain("Lab");
  expect(result?.output).not.toMatch(/outside.test|not stored/);
  const args = vi.mocked(runProcess).mock.calls[0][1];
  expect(args).toContain("-nfs");
  expect(args).not.toContain("-fr");
  expect(args).not.toContain("-fhr");
  expect(args).not.toContain("-irr");
  expect(args).toContain("-duc");
});
it("excludes local, private, reserved and mapped addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "2001:db8::1",
    "198.51.100.1",
  ])
    expect(publicAddress(address), address).toBe(false);
  expect(publicAddress("1.1.1.1")).toBe(true);
  expect(publicAddress("2606:4700:4700::1111")).toBe(true);
});
it("filters and deduplicates passive URL output against current exclusions", async () => {
  vi.mocked(runProcess).mockResolvedValue({
    code: 0,
    output:
      "https://app.example.test/path\nhttps://app.example.test/path\nhttps://app.example.test/private\nhttps://outside.test",
  });
  const result = await runExpandedTool(
    "/tmp",
    "gau",
    "https://app.example.test",
    {
      ...program,
      inScope: ["app.example.test"],
      outOfScope: ["https://app.example.test/private"],
    },
  );
  expect(result?.output).toBe("https://app.example.test/path");
});
