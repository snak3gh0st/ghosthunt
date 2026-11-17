import {readFile,writeFile,mkdir} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
import {containerArgs,docker} from '../dist/bounty/isolation.js';import {protectedBinaries} from '../dist/bounty/tool-inventory.js';
const directory=process.cwd()+'/.bounty/web',config=JSON.parse(await readFile(directory+'/runtime/config.json','utf8'));
const args=containerArgs(config.imageId,'ghosthunt-job-'+randomUUID());args.splice(args.length-1,0,'--entrypoint','/opt/conda/bin/python3');
args.push('-c',`import json,os,subprocess,sys
names=json.load(sys.stdin)
special={'python3':['--version'],'node':['--version'],'ffuf':['-V'],'dig':['-v'],'openssl':['version'],'whois':['--version'],'msfconsole':['-q','-x','version; exit -y'],'msfvenom':['-h'],'theharvester':['-h'],'semgrep':['--version'],'sqlmap':['--version'],'commix':['--version'],'nuclei':['-version'],'naabu':['-version'],'tlsx':['-version'],'cdncheck':['-version'],'gowitness':['version'],'amass':['-h'],'hydra':['-h'],'medusa':['-h']}
env={**os.environ,'SEMGREP_SEND_METRICS':'off','SEMGREP_ENABLE_VERSION_CHECK':'0','NO_COLOR':'1','TERM':'dumb'}
for name in names:
 try:
  p=subprocess.run([name]+special.get(name,['--help']),capture_output=True,text=True,timeout=90 if name=='msfconsole' else 45,env=env)
  output=(p.stdout+'\\n'+p.stderr).strip()
  ok=p.returncode==0 or (name in ['hydra','medusa','crlfuzz','msfvenom','patator'] and any(marker in output for marker in ['Syntax:','Usage:','Medusa','Patator','msfvenom']) and 'Traceback' not in output and 'LoadError' not in output)
  print(json.dumps({'id':name,'ok':ok,'code':p.returncode,'detail':output[-1400:] if not ok else output[:250]}),flush=True)
 except Exception as error:print(json.dumps({'id':name,'ok':False,'error':str(error)}),flush=True)
`);
let pending='',records=[];
const result=await docker(args,{input:JSON.stringify(protectedBinaries),timeout:600000,maxBytes:200000,onStdout:text=>{pending+=text;const lines=pending.split('\n');pending=lines.pop()||'';for(const line of lines){try{const record=JSON.parse(line);records.push(record);console.log(`${record.ok?'PASS':'FAIL'} ${record.id}${record.ok?'':': '+(record.error||record.detail)}`);}catch{}}},onStderr:()=>{}});
await mkdir(directory+'/verification',{recursive:true});await writeFile(directory+'/verification/arsenal-smoke.json',JSON.stringify({verifiedAt:new Date().toISOString(),imageId:config.imageId,network:'none',uid:1000,records},null,2),{mode:0o600});
assert.equal(result.code,0);assert.equal(records.length,protectedBinaries.length);assert.equal(records.filter(record=>!record.ok).length,0,'Every installed executable must launch under the actual restricted runtime');
console.log(`PASS: ${records.length} actual executables launched under uid1000, read-only root, dropped capabilities and network none. No target was contacted.`);
