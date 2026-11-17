import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { containerArgs, docker, runIsolatedTool, isolationStatus } from '../dist/bounty/isolation.js';
import { programInput } from '../dist/bounty/model.js';
import { protectedBinaries } from '../dist/bounty/tool-inventory.js';
const directory=process.cwd()+'/.bounty/web';
const config=JSON.parse(await readFile(directory+'/runtime/config.json','utf8'));
const status=await isolationStatus(directory,true);
assert.equal(status.imageReady,true);assert.equal(status.conda,true);
for(const tool of protectedBinaries)assert.equal(status.installedTools[tool],true,tool);
const securityCode=`import os,json,socket,pathlib
status=pathlib.Path('/proc/self/status').read_text()
try:
 pathlib.Path('/opt/ghosthunt/escape-probe').write_text('forbidden');readonly=False
except OSError:readonly=True
try:
 socket.create_connection(('1.1.1.1',443),timeout=1);offline=False
except OSError:offline=True
probe=pathlib.Path('/work/fresh-probe')
fresh=not probe.exists()
probe.write_text('this container only')
print(json.dumps({'uid':os.getuid(),'readonly':readonly,'offline':offline,'fresh':fresh,'noNewPrivileges':'NoNewPrivs:\\t1' in status,'seccomp':'Seccomp:\\t2' in status,'capabilitiesDropped':'CapEff:\\t0000000000000000' in status,'dockerSocketVisible':pathlib.Path('/var/run/docker.sock').exists(),'homeVisible':pathlib.Path('/Users').exists(),'conda':os.environ.get('CONDA_PREFIX')}))`;
const records=[];
for(let i=0;i<2;i++) {
 const name='ghosthunt-job-'+randomUUID();
 const args=containerArgs(config.imageId,name);
 args.splice(args.length-1,0,'--entrypoint','/opt/conda/bin/python3');
 args.push('-c',securityCode);
 const r=await docker(args,{timeout:15000});assert.equal(r.code,0,r.stderr);
 const result=JSON.parse(r.output);records.push(result);
 assert.equal(result.uid,1000);for(const k of ['readonly','offline','fresh','noNewPrivileges','seccomp','capabilitiesDropped'])assert.equal(result[k],true,k);
 assert.equal(result.dockerSocketVisible,false);assert.equal(result.homeVisible,false);assert.equal(result.conda,'/opt/conda');
}
// Offline synthetic fixture: never depend on the user's changing program selection.
const program={...programInput.parse({name:'Isolation diagnostic fixture',url:'https://hackerone.com/example',inScope:['https://app.example.test'],scopeConfirmed:true}),id:'isolation-smoke',scopeVersion:1,createdAt:'',updatedAt:''};
const target=program.inScope[0];
const classified=await runIsolatedTool(directory,'cbh-classify',target,program);
assert.equal(classified.code,0);assert.ok(classified.output.length>0);
if(!status.networkReady) await assert.rejects(runIsolatedTool(directory,'repo-review',target,program),/VPN/);
await mkdir(directory+'/verification',{recursive:true});
await writeFile(directory+'/verification/isolation-smoke.json',JSON.stringify({verifiedAt:new Date().toISOString(),imageId:config.imageId,status,records,classification:classified,networkAnalysisBlocked:!status.networkReady},null,2),{mode:0o600});
console.log(`PASS: ${protectedBinaries.length} binaries installed; real disposable Conda containers; uid1000, read-only root, no capabilities, no-new-privileges, seccomp, no host home/socket; offline network disabled; fresh filesystem on second run; actual classifier.`);
