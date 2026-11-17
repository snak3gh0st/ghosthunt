import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { programInput, type Program } from "../../src/bounty/model.js";
import {
  inspectSource,
  reviewRepository,
  sourceCandidates,
} from "../../src/bounty/repository-review.js";
import {
  githubRepository,
  recommendedTool,
  toolIncompatibility,
} from "../../src/bounty/targets.js";

const target = "https://github.com/example/lab";
const program: Program = {
  ...programInput.parse({
    name: "Source lab",
    url: "https://hackerone.com/example",
    inScope: [target],
    scopeConfirmed: true,
    automationAllowed: true,
  }),
  id: "lab",
  scopeVersion: 1,
  createdAt: "",
  updatedAt: "",
};
let directory: string;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("chooses source review for GitHub and requires origin-wide scope for domain discovery", () => {
  expect(recommendedTool(target)).toBe("repo-review");
  expect(toolIncompatibility("subfinder", target, [target])).toContain(
    "compartilhada",
  );
  expect(
    toolIncompatibility("urlfinder", "https://app.example.test/api", [
      "https://app.example.test/api",
    ]),
  ).toContain("restrito");
  expect(
    toolIncompatibility("subfinder", "https://app.example.test/api", [
      "https://app.example.test",
      "https://other.example.test/path",
    ]),
  ).toBeNull();
  expect(
    toolIncompatibility("subfinder", "https://app.example.test", [
      "http://app.example.test",
    ]),
  ).toContain("restrito");
  expect(
    toolIncompatibility("subfinder", "https://app.example.test", [
      "*.example.test",
    ]),
  ).toBeNull();
  expect(
    toolIncompatibility("subfinder", "https://example.test", [
      "*.example.test",
    ]),
  ).toContain("restrito");
  expect(githubRepository(`${target}/tree/main`)).toBeNull();
  expect(githubRepository(`${target}?tab=readme`)).toBeNull();
  expect(
    githubRepository("https://github.com.attacker.test/example/lab"),
  ).toBeNull();
});

it("pins a release and hashes text without executing code, while respecting excluded paths", async () => {
  directory = await mkdtemp(join(tmpdir(), "ghosthunt-source-test-"));
  const sha = "a".repeat(40),
    tree = "b".repeat(40);
  const source =
    "#!/bin/bash\nsudo echo harmless-test\ncurl https://example.test/archive\n";
  const entry = (path: string, mode = "100644", size = 100) => ({
    path,
    mode,
    size,
    type: "blob",
    sha: "c".repeat(40),
  });
  const entries = [
    entry("bin/update"),
    entry("bin/secret"),
    entry("link.sh", "120000"),
    entry("../escape.sh"),
    entry("large.sh", "100644", 100001),
    entry("image.png"),
  ];
  expect(sourceCandidates(entries).map((item) => item.path)).toEqual([
    "bin/update",
    "bin/secret",
  ]);
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(init?.redirect).toBe("error");
      if (url === `https://api.github.com/repos/example/lab`)
        return Response.json({ private: false, default_branch: "main" });
      if (url.endsWith("/releases/latest"))
        return Response.json({ tag_name: "v1.2.3" });
      if (url.endsWith("/commits/v1.2.3"))
        return Response.json({ sha, commit: { tree: { sha: tree } } });
      if (url.endsWith(`/git/trees/${tree}?recursive=1`))
        return Response.json({ tree: entries });
      if (
        url ===
        `https://raw.githubusercontent.com/example/lab/${sha}/bin/update`
      )
        return new Response(source);
      throw new Error(`Unexpected source request: ${url}`);
    },
  );
  const result = await reviewRepository(
    directory,
    target,
    { ...program, outOfScope: [`${target}/bin/secret`] },
    undefined,
    fetcher,
  );
  expect(result.code).toBe(0);
  expect(result.output).toContain(
    "Nenhuma vulnerabilidade ou recompensa foi confirmada",
  );
  expect(result.output).toContain(`${sha}/bin/update`);
  expect(fetcher).toHaveBeenCalledTimes(5);
  const names = await readdir(join(directory, "repository-reviews"));
  const manifest = JSON.parse(
    await readFile(join(directory, "repository-reviews", names[0]), "utf8"),
  );
  expect(manifest.reference).toBe("v1.2.3");
  expect(manifest.files).toHaveLength(1);
  expect(manifest.files[0].sha256).toBe(
    createHash("sha256").update(source).digest("hex"),
  );
  expect(
    manifest.files[0].observations.map((o: { line: number }) => o.line),
  ).toEqual([2, 3]);
});

it("rejects excluded or unconfirmed repositories before requesting any source", async () => {
  const fetcher = vi.fn();
  await expect(
    reviewRepository(
      "/tmp",
      target,
      { ...program, scopeConfirmed: false },
      undefined,
      fetcher,
    ),
  ).rejects.toThrow("Confirme");
  await expect(
    reviewRepository(
      "/tmp",
      target,
      { ...program, outOfScope: [target] },
      undefined,
      fetcher,
    ),
  ).rejects.toThrow("escopo");
  expect(fetcher).not.toHaveBeenCalled();
});

it("treats commands as review observations and redacts recognizable credentials", () => {
  const observations = inspectSource(
    "# sudo comment\nsudo echo test\ntoken=ghp_12345678901234567890123",
  );
  expect(observations).toHaveLength(2);
  expect(observations[1].excerpt).toContain("ocultado");
  expect(JSON.stringify(observations)).not.toContain("ghp_");
});

it("prioritizes production code ahead of tests matching security keywords", () => {
  const paths = [
    "test/shell.d/update-hook-security-test.sh",
    "bin/product-update",
    "install/config/firewall.sh",
    ".github/SECURITY.md",
  ];
  expect(
    sourceCandidates(
      paths.map((path) => ({
        path,
        type: "blob",
        mode: "100644",
        size: 100,
        sha: "a".repeat(40),
      })),
    ).map((item) => item.path),
  ).toEqual([
    ".github/SECURITY.md",
    "bin/product-update",
    "install/config/firewall.sh",
    "test/shell.d/update-hook-security-test.sh",
  ]);
});
