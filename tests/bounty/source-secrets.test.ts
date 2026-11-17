import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  rm,
  readdir,
  symlink,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { binaryPath } from "../../src/bounty/process.js";
import { scanSourceSecrets } from "../../src/bounty/expanded-tools.js";
import { MetasploitCatalog } from "../../src/bounty/metasploit.js";
import { programInput, type Program } from "../../src/bounty/model.js";
let directory: string;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (directory) await rm(directory, { recursive: true, force: true });
});
it.skipIf(!(await binaryPath("gitleaks", process.cwd())))(
  "runs the installed Gitleaks against a synthetic source snapshot and removes temporary plaintext",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "ghosthunt-secret-test-"));
    const sha = "a".repeat(40),
      tree = "b".repeat(40);
    const fakeToken = "ghp_" + "AbcD1234EFgh5678IJKl9012MNop3456QRST7890";
    const body = `#!/bin/sh\nTOKEN="${fakeToken}"\n`;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/releases/latest"))
        return new Response("", { status: 404 });
      if (url.endsWith("/commits/main"))
        return Response.json({ sha, commit: { tree: { sha: tree } } });
      if (url.includes("/git/trees/"))
        return Response.json({
          tree: [
            {
              path: "bin/lab",
              type: "blob",
              mode: "100644",
              size: body.length,
              sha: "c".repeat(40),
            },
          ],
        });
      if (url.startsWith("https://raw.githubusercontent.com/"))
        return new Response(body);
      return Response.json({ private: false, default_branch: "main" });
    });
    vi.stubGlobal("fetch", fetcher);
    const target = "https://github.com/example/lab";
    const program: Program = {
      ...programInput.parse({
        name: "Lab",
        url: "https://hackerone.com/example",
        inScope: [target],
        scopeConfirmed: true,
        automationAllowed: true,
      }),
      id: "p",
      scopeVersion: 1,
      createdAt: "",
      updatedAt: "",
    };
    const result = await scanSourceSecrets(directory, target, program);
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/Gitleaks: [1-9]\d* possíveis segredos/);
    expect(result.output.includes(fakeToken)).toBe(false);
    expect(
      (await readdir(directory)).some((p) => p.startsWith("source-secrets-")),
    ).toBe(false);
  },
);
it.skipIf(!existsSync(resolve(".bounty/web/catalogs/metasploit.json")))(
  "searches the pinned real Metasploit catalog without executing modules or contacting a target",
  async () => {
    directory = await mkdtemp(join(tmpdir(), "ghosthunt-msf-test-"));
    await symlink(resolve(".bounty/web/catalogs"), join(directory, "catalogs"));
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const catalog = new MetasploitCatalog(directory);
    const results = await catalog.search("CVE-2021-41773");
    expect(results.total).toBeGreaterThan(0);
    expect(results.mode).toBe("catalog-only");
    expect(results.results[0].url).toContain(results.commit);
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it("rejects a catalog whose contents no longer match the locked checksum", async () => {
  directory = await mkdtemp(join(tmpdir(), "ghosthunt-msf-invalid-"));
  await mkdir(join(directory, "catalogs"));
  await writeFile(join(directory, "catalogs", "metasploit.json"), "{}");
  await expect(
    new MetasploitCatalog(directory).search("nginx"),
  ).rejects.toThrow("conferido");
});
