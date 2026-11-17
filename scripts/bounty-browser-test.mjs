import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, symlink, mkdir, writeFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { BountyStore } from "../dist/bounty/store.js";
import { buildBountyApp } from "../dist/bounty/server.js";

const directory = await mkdtemp(join(tmpdir(), "ghosthunt-browser-"));
const store = new BountyStore(directory);
await store.init();
for (const name of ["integrations", "bin", "catalogs"])
  if(name === "integrations" && process.argv.includes("--real-preparation")) await cp(resolve(".bounty/web",name),join(directory,name),{recursive:true});
  else await symlink(resolve(".bounty/web", name), join(directory, name));
const imageConfig = JSON.parse(await readFile(resolve(".bounty/web/runtime/config.json"), "utf8"));
await mkdir(join(directory, "runtime"), { recursive: true });
await writeFile(join(directory, "runtime", "config.json"), JSON.stringify(process.argv.includes("--real-preparation") ? imageConfig : { imageId: imageConfig.imageId, vpnImageId: imageConfig.vpnImageId }));
await writeFile(join(directory, "runtime", "resolv.conf"), "nameserver 127.0.0.1\noptions timeout:2 attempts:2\n");
const apiKey = randomUUID();
const app = await buildBountyApp({
  store,
  apiKey,
  dashboard: resolve("dashboard/dist"),
  catalog: {list:async()=>({fetchedAt:new Date().toISOString(),programs:[{handle:"example",name:"Browser test, synthetic program",url:"https://hackerone.com/example",offersBounties:true,inScope:["https://api.example.test/api/users"],outOfScope:["https://api.example.test/api/users/admin"],notes:"Only researcher-owned test accounts; exact asset paths only; no destructive testing.",scopeReferences:[],omittedAssets:0,open:true}]})},
});
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
const url = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
});
let diagnosticPage;
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  diagnosticPage=page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByLabel("Chave de acesso").fill(apiKey);
  await page.getByRole("button", { name: "Entrar no workspace" }).click();
  await page
    .getByRole("heading", { name: "Command center", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "Ferramentas e fontes", exact: true })
    .click();
  await page.getByRole("heading", { name: "Burp MCP", exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "OpenAI API", exact: true })
    .waitFor();
  await page.getByLabel("Pesquisar módulos Metasploit").fill("CVE-2021-41773");
  const modulesEvent = page.waitForResponse((response) =>
    response.url().includes("/integrations/metasploit?q="),
  );
  await page
    .getByRole("button", { name: "Pesquisar catálogo Metasploit", exact: true })
    .click();
  const modules = await modulesEvent;
  assert.equal(modules.status(), 200);
  assert.ok((await modules.json()).total > 0);
  await page.getByText(/módulos encontrados/).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "Integrations overflow on mobile",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Programas", exact: true }).click();
  await page.getByRole('button',{name:'Explorar HackerOne',exact:true}).first().click();
  await page.getByRole('button',{name:'Selecionar e avaliar',exact:true}).click();
  await page
    .getByRole("heading", {
      name: "Browser test, synthetic program",
      exact: true,
    })
    .waitFor();
  assert.equal((await store.read()).programs[0].scopeConfirmed,false);
  assert.equal(await page.getByRole('button',{name:'Analisar viabilidade',exact:true}).isDisabled(),true);
  await page.getByLabel('Conferi estes ativos, exclusões e regras na página oficial e quero confirmar este escopo',{exact:true}).check();
  await page.getByRole('button',{name:'Confirmar escopo',exact:true}).click();
  await page.getByText('Escopo confirmado. Continue na avaliação abaixo.',{exact:true}).waitFor();
  const preparedProgram = (await store.read()).programs[0];
  assert.equal(preparedProgram.scopeConfirmed,true);assert.equal(preparedProgram.scopeVersion,2);
  assert.equal(await page.getByRole('button', {name:'Iniciar pentest',exact:true}).isDisabled(), true);
  await page.getByLabel('Objetivo da investigação',{exact:true}).fill('Review ownership checks with two controlled test accounts.');
  await page.getByLabel('Acesso necessário',{exact:true}).selectOption('test-accounts');
  await page.getByLabel('Limites e critérios de parada',{exact:true}).fill('Only controlled accounts; stop on unrelated data; no target requests in this synthetic test.');
  await page.getByLabel('Revisei a política oficial e a elegibilidade do ativo selecionado',{exact:true}).check();
  await page.getByRole('button',{name:'Analisar viabilidade',exact:true}).click();
  await page.getByRole('button',{name:'Aprovar plano e liberar pentest',exact:true}).click();
  await page.getByText('Plano aprovado',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Iniciar pentest',exact:true}).isEnabled(),true);
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Assessment overflow');
    await page.screenshot({path:`/tmp/ghosthunt-assessment-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  const runtime = JSON.parse(await readFile(join(directory, "runtime", "config.json"), "utf8"));
  if(process.argv.includes('--real-preparation')) {
    const started=page.waitForResponse(r=>r.url().endsWith('/runs')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Iniciar pentest',exact:true}).click();
    assert.equal((await started).status(),202);
    await page.locator('.b-terminal-dock[data-status="completed"]').waitFor({timeout:900000});
    const session=JSON.parse(await readFile(join(directory,'pentests',`${preparedProgram.id}.json`),'utf8'));
    assert.equal(session.installed,true);assert.equal(session.requiredTools.length,50);assert.deepEqual(session.scope,preparedProgram.inScope);assert.deepEqual(session.excludedScope,preparedProgram.outOfScope);assert.equal(session.burpMcpReady,true);assert.equal(session.status,'ready');
    await page.getByRole('button',{name:'Fechar terminal',exact:true}).click();
    console.log('PASS: actual scoped Docker/Conda preparation, 50 executables, live Burp MCP and VPN readiness, exact path scope and exclusions.');
  } else {
    await mkdir(join(directory, "pentests"), { recursive: true });
    await writeFile(join(directory, "pentests", `${preparedProgram.id}.json`), JSON.stringify({ installed: true, imageId: runtime.imageId, status: "blocked", blockers: ["Synthetic workflow fixture"], scopeVersion: preparedProgram.scopeVersion }));
  }
  await page.getByRole("button", { name: "Verificar preparo", exact: true }).waitFor();
  const providers = page.getByLabel("Onde executar a IA");
  await providers.waitFor();
  assert.equal(await providers.inputValue(), "local");
  const integrationResponse = await page.request.get(
    `${url}/api/bounty/integrations`,
    { headers: { "x-api-key": apiKey } },
  );
  const integrationData = await integrationResponse.json();
  assert.equal(
    await providers
      .locator('option[value="openai"]')
      .evaluate((option) => option.disabled),
    !integrationData.openai.configured || !integrationData.cloudAdvisorReady,
  );
  if (process.argv.includes("--local-ai")) {
    const provider = page.getByLabel("Onde executar a IA");
    await provider.waitFor();
    assert.equal(await provider.inputValue(), "local");
    await page
      .getByLabel("Modelo local")
      .selectOption("ollama:ghosthunt-local:q4");
    await page
      .getByLabel("O que você quer investigar?")
      .fill(
        "Teste sintético: duas contas de teste recebem HTTP 403 e nenhum dado alheio. Já existe evidência para relatar IDOR? Explique em até 120 palavras, sem executar ferramentas nem sugerir testes externos.",
      );
    const answerEvent = page.waitForResponse(
      (response) =>
        response.url().endsWith("/advice") &&
        response.request().method() === "POST",
      { timeout: 145000 },
    );
    await page
      .getByRole("button", { name: "Consultar assistente", exact: true })
      .click();
    const response = await answerEvent;
    const result = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(result));
    assert.equal(result.provider, "local");
    assert.equal(result.costUsd, 0);
    await page
      .getByText("Local · ghosthunt-local:q4 · sem consumo de API", {
        exact: false,
      })
      .waitFor();
    await page.screenshot({
      path: "/tmp/ghosthunt-local-ai-browser.png",
      fullPage: true,
    });
    console.log(
      JSON.stringify({
        localAI: {
          model: result.model,
          durationMs: result.durationMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
          answer: result.answer,
        },
      }),
    );
  }
  await page
    .getByLabel("URL dentro do escopo")
    .fill("https://api.example.test/api/users/42");
  await page
    .getByRole("button", { name: "Iniciar execução", exact: true })
    .click();
  await page.getByText("Concluído", { exact: true }).first().waitFor();
  await page
    .getByRole("region", { name: "Terminal real da ferramenta" })
    .waitFor();
  await page.locator('[data-testid="live-terminal"] .xterm').waitFor();
  const transcriptEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar transcrição", exact: true })
    .click();
  const terminalFile = await transcriptEvent;
  const terminalText = await readFile(await terminalFile.path(), "utf8");
  assert.ok(
    terminalText.includes("classify"),
    "Real classifier command missing from terminal",
  );
  await page
    .getByRole("button", { name: "Fechar terminal", exact: true })
    .click();
  const runRow=page.locator('details.b-run').filter({has:page.locator('summary strong',{hasText:'cbh-classify'})});
  await runRow.getByText('Concluído',{exact:true}).waitFor();
  await runRow.evaluate(el=>{el.open=true;});
  await runRow.getByRole('button',{name:'Documentar hipótese desta execução',exact:true}).click();
  await page
    .getByRole("heading", {
      name: "Hipótese após cbh-classify",
      exact: true,
    })
    .first()
    .waitFor();
  await page.getByRole('button',{name:'Editar e anexar evidências',exact:true}).click();
  await page.getByLabel('Título',{exact:true}).fill('Synthetic account isolation test');
  await page.getByLabel('URL afetada',{exact:true}).fill('https://api.example.test/api/users/42');
  await page
    .getByLabel("Nome da evidência")
    .fill("Synthetic request and response");
  await page
    .getByLabel("Conteúdo", { exact: true })
    .fill(
      "GET /api/users/42\nSynthetic controlled-account response. This is a test fixture.",
    );
  await page
    .getByRole("button", { name: "Adicionar evidência", exact: true })
    .click();
  await page
    .getByText("Synthetic request and response", { exact: true })
    .waitFor();
  for (const [label, value] of [
    ["Resumo", "Synthetic test finding.\n\n**Controlled test only.**\n\n<script>window.GHOSTHUNT_XSS=1</script>\n\n![tracking](https://tracking.invalid/pixel)"],
    ["Pré-condições e contas de teste", "Two researcher-owned test accounts."],
    [
      "Passos de reprodução numerados",
      "1. Sign in as test A.\n2. Request test B record.",
    ],
    ["Comportamento esperado", "Deny access to the other test account."],
    ["Comportamento observado", "Synthetic response contains test B record."],
    ["Impacto demonstrado", "Read access to another controlled test record."],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByLabel(
      "Reproduzi a falha com minhas contas de teste e conferi as evidências",
    )
    .check();
  await page
    .getByRole("button", { name: "Salvar documentação", exact: true })
    .click();
  await page.getByText("Documentação salva.", { exact: true }).waitFor();
  await page.getByRole('button',{name:'Revisar relatório',exact:true}).click();
  await page.getByRole('article',{name:'Conteúdo renderizado do relatório'}).getByText('Controlled test only.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.GHOSTHUNT_XSS),undefined);
  assert.equal(await page.locator('.b-report-document img, .b-report-document script').count(),0);
  assert.equal(await page.getByRole('button',{name:'Baixar relatório aprovado',exact:true}).isDisabled(),true);
  await page
    .getByRole("button", { name: "Validar achado documentado", exact: true })
    .click();
  await page.getByLabel('Revisei esta versão, o impacto e as evidências para envio',{exact:true}).check();
  await page
    .getByRole("button", { name: "Aprovar relatório para envio", exact: true })
    .click();
  await page.getByText("Pronto para enviar", { exact: true }).first().waitFor();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar relatório aprovado", exact: true })
    .click();
  const download = await downloadEvent;
  const report = await readFile(await download.path(), "utf8");
  assert.ok(report.includes("Synthetic test finding."));
  assert.ok(report.includes("SHA-256"));
  assert.ok(!report.includes("DRAFT"));
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Report overflow');
    await page.screenshot({path:`/tmp/ghosthunt-report-review-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByLabel("Etapa",{exact:true}).selectOption("submitted");
  await page
    .getByLabel("Link do relatório", { exact: true })
    .fill("https://hackerone.com/reports/123");
  await page.getByLabel("Tempo total dedicado (minutos)").fill("90");
  await page
    .getByRole("button", { name: "Salvar acompanhamento", exact: true })
    .click();
  await page.getByText("Enviado", { exact: true }).first().waitFor();
  await page.getByLabel("Etapa",{exact:true}).selectOption("paid");
  await page.getByLabel("Valor recebido", { exact: true }).fill("250");
  await page
    .getByRole("button", { name: "Salvar acompanhamento", exact: true })
    .click();
  await page.getByText("Pago", { exact: true }).first().waitFor();
  await page.getByRole("link", { name: "Visão geral", exact: true }).click();
  await page.getByText("US$ 250,00", { exact: false }).first().waitFor();
  await page.screenshot({
    path: "/tmp/ghosthunt-browser-workflow.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  assert.equal((await store.read()).findings[0].rewardCents, 25000);
  console.log(
    "PASS: login, HackerOne catalog import, explicit path-scope confirmation, feasibility and plan approval, isolated classifier, run-to-hypothesis, evidence, validation, rendered report approval/download, submission/payment tracking and mobile layout. No external target requests.",
  );
} catch(error) {
  console.log('Workflow diagnostics:',JSON.stringify({runs:(await store.read()).runs.map(({tool,status,error,output})=>({tool,status,error,output:output.slice(-1600)})),text:(await diagnosticPage?.locator('body').innerText())?.slice(-2200)}));
  throw error;
} finally {
  await browser.close();
  await app.close();
  await store.close();
  await rm(directory, { recursive: true, force: true });
}
