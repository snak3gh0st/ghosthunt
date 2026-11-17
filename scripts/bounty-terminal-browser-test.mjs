import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, symlink, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { BountyStore } from "../dist/bounty/store.js";
import { buildBountyApp } from "../dist/bounty/server.js";
import { runProcess } from "../dist/bounty/process.js";
const directory = await mkdtemp(join(tmpdir(), "ghosthunt-terminal-browser-"));
const store = new BountyStore(directory);
await store.init();
for (const name of ["integrations", "bin", "catalogs"])
  await symlink(resolve(".bounty/web", name), join(directory, name));
const imageConfig = JSON.parse(await readFile(resolve(".bounty/web/runtime/config.json"), "utf8"));
await mkdir(join(directory, "runtime"), { recursive: true });
await writeFile(join(directory, "runtime", "config.json"), JSON.stringify({ imageId: imageConfig.imageId, vpnImageId: imageConfig.vpnImageId }));
await writeFile(join(directory, "runtime", "resolv.conf"), "nameserver 127.0.0.1\noptions timeout:2 attempts:2\n");
const key = randomUUID();
let launches = 0;
const app = await buildBountyApp({
  store,
  apiKey: key,
  dashboard: resolve("dashboard/dist"),
  runner: async (_tool, _target, _program, signal) => {
    launches++;
    return runProcess(
      process.execPath,
      [
        "-e",
        launches === 1
          ? 'process.stdout.write("LIVE_PROCESS_ONE\\n");setInterval(()=>process.stdout.write("tick\\n"),300)'
          : 'process.stdout.write("LIVE_PROCESS_TWO\\n");setTimeout(()=>process.stdout.write("PROCESS_COMPLETED\\n"),1800)',
      ],
      { cwd: directory, signal },
    );
  },
});
await app.inject({
  method: "POST",
  url: "/api/bounty/programs",
  headers: { "x-api-key": key },
  payload: {
    name: "Terminal verification, synthetic lab",
    url: "https://hackerone.com/example",
    inScope: ["app.example.test"],
    scopeConfirmed: true,
    policy: "Synthetic controlled-process fixtures only.",
  },
});
const preparedProgram = (await store.read()).programs[0];
const evaluated = await app.inject({method:'POST',url:`/api/bounty/programs/${preparedProgram.id}/assessment`,headers:{'x-api-key':key},payload:{target:'https://app.example.test',objective:'Review isolated synthetic process output',timeBudgetMinutes:30,access:'public',policyReviewed:true,limits:'No selected-target requests; process fixtures only.'}});
assert.equal(evaluated.statusCode,200);
const approved = await app.inject({method:'POST',url:`/api/bounty/programs/${preparedProgram.id}/assessment/approve`,headers:{'x-api-key':key},payload:{assessmentId:evaluated.json().assessment.id}});
assert.equal(approved.statusCode,200);
await mkdir(join(directory, "pentests"), { recursive: true });
await writeFile(join(directory, "pentests", `${preparedProgram.id}.json`), JSON.stringify({ installed: true, imageId: imageConfig.imageId, status: "blocked", blockers: ["Synthetic fixture"], scopeVersion: preparedProgram.scopeVersion }));
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByLabel("Chave de acesso").fill(key);
  await page.getByRole("button", { name: "Entrar no workspace" }).click();
  await page
    .getByRole("heading", { name: "Command center", exact: true })
    .waitFor();
  if (process.env.GHOSTHUNT_TEST_POLL === "1") {
    await page.goto(base + "?terminal=poll");
    await page.getByRole("heading", { name: "Command center", exact: true }).waitFor();
  }
  await page.getByRole("button", { name: "Filtrar ferramentas: Todas", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /^Rodar / }).count(), 18);
  await page.getByRole("button", { name: "Filtrar ferramentas: Código", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /^Rodar / }).count(), 9);
  await page.getByRole("button", { name: "Filtrar ferramentas: Prontas", exact: true }).click();
  await page.getByRole("button", { name: "Rodar Claude-BugHunter", exact: true }).waitFor();
  assert.ok(await page.getByRole("button", { name: /^Rodar / }).count() >= 6);
  await mkdir("/tmp/ghosthunt-command-center-proof", { recursive: true });
  await page.screenshot({
    path: "/tmp/ghosthunt-command-center-proof/desktop.png",
    fullPage: true,
  });
  const launchEvent = page.waitForResponse(
    (r) => r.url().endsWith("/runs") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Rodar Claude-BugHunter", exact: true })
    .click();
  const first = await (await launchEvent).json();
  await page
    .getByRole("region", { name: "Terminal real da ferramenta" })
    .waitFor();
  await page.locator(".xterm").waitFor();
  const response = await fetch(`${base}/api/bounty/runs/${first.id}/terminal`, {
    headers: { "x-api-key": key },
  });
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let output = "";
  function stdout(text) {
    return text
      .split("\n\n")
      .slice(0, -1)
      .filter((f) => f.startsWith("data: "))
      .map((f) => JSON.parse(f.slice(6)))
      .filter((e) => e.kind === "stdout")
      .map((e) => e.text)
      .join("");
  }
  while (!stdout(output).includes("LIVE_PROCESS_ONE")) {
    const { value } = await reader.read();
    output += decoder.decode(value);
  }
  assert.equal((await store.read()).runs[0].status, "running");
  const pid = Number(/"pid":(\d+)/.exec(output)[1]);
  process.kill(pid, 0);
  await page.screenshot({
    path: "/tmp/ghosthunt-command-center-proof/live-terminal.png",
  });
  await page
    .getByRole("button", { name: "Expandir terminal", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reduzir terminal", exact: true })
    .click();
  for (const width of [834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Overflow at ${width}`,
    );
    await page.screenshot({
      path: `/tmp/ghosthunt-command-center-proof/terminal-${width}.png`,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByLabel("Terminal da ferramenta. Ctrl+C cancela o processo.", {
      exact: true,
    })
    .focus();
  await page.keyboard.press("Control+c");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }
  assert.ok(output.includes('"status":"interrupted"'));
  assert.throws(() => process.kill(pid, 0));
  await page
    .getByRole("button", { name: "Fechar terminal", exact: true })
    .click();
  const secondEvent = page.waitForResponse(
    (r) => r.url().endsWith("/runs") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Rodar Claude-BugHunter", exact: true })
    .click();
  const second = await (await secondEvent).json();
  await page
    .getByRole("region", { name: "Terminal real da ferramenta" })
    .waitFor();
  await page
    .getByRole("button", { name: "Fechar terminal", exact: true })
    .click();
  assert.equal((await store.read()).runs[0].status, "running");
  await new Promise((resolve) => setTimeout(resolve, 2200));
  assert.equal((await store.read()).runs[0].status, "completed");
  await page.reload();
  await page
    .getByRole("heading", { name: "Command center", exact: true })
    .waitFor();
  await page
    .getByRole("button", {
      name: `Abrir terminal cbh-classify ${second.id.slice(0, 8)}`,
      exact: true,
    })
    .click();
  await page.locator(".xterm").waitFor();
  await page
    .getByRole("region", { name: "Terminal real da ferramenta" })
    .getByRole("status")
    .filter({ hasText: "Concluído" })
    .waitFor();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar transcrição", exact: true })
    .click();
  const download = await downloadEvent;
  const text = await readFile(await download.path(), "utf8");
  assert.ok(text.includes("PROCESS_COMPLETED"));
  assert.equal(launches, 2);
  assert.deepEqual(errors, []);
  await page
    .getByRole("button", { name: "Fechar terminal", exact: true })
    .click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page
    .getByRole("heading", { name: "Command center", exact: true })
    .hover();
  assert.equal(
    await page
      .getByRole("heading", { name: "Command center", exact: true })
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  console.log(
    "PASS: 18 tool triggers, real child stdout streamed while running, actual PID, xterm, Ctrl+C killed process, close preserved next process, replay/download without re-execution, 1440/834/390 layouts, reduced motion, no JavaScript errors.",
  );
} finally {
  await browser.close();
  await app.close();
  await store.close();
  await rm(directory, { recursive: true, force: true });
}
