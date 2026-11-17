import {chromium} from 'playwright';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
import {BountyStore} from '../dist/bounty/store.js';import {buildBountyApp} from '../dist/bounty/server.js';
import {runInvestigation} from '../dist/bounty/investigation.js';import {runProcess} from '../dist/bounty/process.js';
const directory=await mkdtemp(join(tmpdir(),'ghosthunt-investigation-ui-')),store=new BountyStore(directory),key=randomUUID();await store.init();
const calls=[];
const app=await buildBountyApp({store,apiKey:key,dashboard:resolve('dashboard/dist'),runner:async(tool,target,program,signal)=>{
 assert.equal(tool,'investigation');
 return runInvestigation(target,program,{
  run:async(id,_target,_program,currentSignal)=>{
   calls.push(id);const output=id==='repo-review'?'src/auth.ts:42 [Access control] Synthetic ownership check requires proof.':`SYNTHETIC_TOOL_RESULT ${id}`;
   return runProcess(process.execPath,['-e',`process.stdout.write(${JSON.stringify('REAL_FIXTURE_PROCESS '+id+'\n')});setTimeout(()=>process.stdout.write(${JSON.stringify(output+'\n')}),500)`],{cwd:directory,signal:currentSignal});
  },available:async()=>null,
  advise:async()=>({code:0,output:'Synthetic local analysis: compare researcher-owned accounts before reporting. No vulnerability confirmed.'}),
  references:async()=>({code:0,output:'Synthetic metadata; no exploit.'}),
 },signal);
}});
const headers={'x-api-key':key};
const p=(await app.inject({method:'POST',url:'/api/bounty/programs',headers,payload:{name:'Synthetic investigation workflow',url:'https://hackerone.com/example',inScope:['https://github.com/example/lab'],scopeConfirmed:true,automationAllowed:true,policy:'Read public source only; never execute fetched code.'}})).json();
const assessment=(await app.inject({method:'POST',url:`/api/bounty/programs/${p.id}/assessment`,headers,payload:{target:p.inScope[0],objective:'Review ownership boundaries in a controlled source fixture',timeBudgetMinutes:60,access:'public',policyReviewed:true,limits:'Synthetic child processes only. No target requests.'}})).json();
assert.equal((await app.inject({method:'POST',url:`/api/bounty/programs/${p.id}/assessment/approve`,headers,payload:{assessmentId:assessment.assessment.id}})).statusCode,200);
await app.listen({host:'127.0.0.1',port:0});const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});const errors=[];let diagnosticPage;
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});diagnosticPage=page;page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(k=>localStorage.setItem('ghosthunt_api_key',k),key);
 await page.goto(base+`/?program=${p.id}`,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Iniciar investigação por etapas',exact:true}).click();
 await page.locator('[data-testid="live-terminal"] .xterm').waitFor();
 await page.getByRole('button',{name:'Investigação em andamento',exact:true}).waitFor();
 await page.getByText('Agora:',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Desktop split overflow');
 await page.screenshot({path:'/tmp/ghosthunt-investigation-live-1440.png',fullPage:true});
 await page.locator('.b-terminal-dock[data-status="completed"]').waitFor({timeout:60000});
 const run=(await store.read()).runs[0];assert.equal(run.stages.length,21);assert.equal(run.stages.find(step=>step.tool==='repo-review').signals.length,1);assert.equal(run.stages.find(step=>step.tool==='subfinder').status,'skipped');
 assert.ok(!calls.includes('subfinder'));assert.ok(calls.includes('repo-review'));assert.ok(calls.includes('repo-secrets'));
 const terminal=(await app.inject({method:'GET',url:`/api/bounty/runs/${run.id}/terminal?transport=poll`,headers})).json();assert.ok(terminal.events.some(event=>event.pid));assert.ok(terminal.events.some(event=>event.text.includes('REAL_FIXTURE_PROCESS repo-review')));
 await page.getByText('Possibilidades para investigar',{exact:true}).waitFor();
 for(const width of [1440,834,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Investigation overflow ${width}`);await page.screenshot({path:`/tmp/ghosthunt-investigation-results-${width}.png`,fullPage:true});}
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Fechar terminal',exact:true}).click();
 const stage=page.locator('.b-investigation-stage').filter({has:page.getByText('Revisão estática do repositório',{exact:true})});
 await stage.getByRole('button',{name:'Documentar hipótese desta etapa',exact:true}).click();await page.getByRole('heading',{name:'Hipótese após repo-review',exact:true}).waitFor();
 const finding=(await store.read()).findings[0];assert.equal(finding.sourceStageId,'repo-review');assert.equal(finding.reproductionConfirmed,false);assert.equal(finding.status,'hypothesis');
 assert.deepEqual(errors,[]);console.log('PASS: sequential investigation; real subprocess PID/stdout; rendered live stages and signals beside terminal; skipped incompatible tools; 1440/834/390 layouts; stage-specific hypothesis and evidence. Synthetic fixture only; no target requests.');
 await writeFile('/tmp/ghosthunt-investigation-browser.json',JSON.stringify({verifiedAt:new Date().toISOString(),calls,stages:run.stages.map(({tool,status,signals})=>({tool,status,signals})),errors},null,2));
}catch(error){console.log('Browser diagnostics:',JSON.stringify({errors,text:await diagnosticPage?.locator('body').innerText()}));throw error;}finally{await browser.close();await app.close();await store.close();await rm(directory,{recursive:true,force:true});}
