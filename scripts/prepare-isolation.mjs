import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const folder=resolve(process.env.GHOSTHUNT_DATA_DIR || '.bounty/web','runtime');
const context=process.env.GHOSTHUNT_DOCKER_CONTEXT || 'desktop-linux';
if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(context)) throw Error('Invalid Docker context');
const command=(args,capture=false)=>new Promise((resolve,reject)=>{
 const p=spawn('docker',['--context',context,...args],{shell:false,stdio:capture?['ignore','pipe','pipe']:['ignore','inherit','inherit']});
 let output=''; if(capture){p.stdout.on('data',c=>output+=c);p.stderr.on('data',()=>{});}
 p.on('error',reject);p.on('close',code=>code?reject(Error(`Docker command failed (${code})`)):resolve(output.trim()));
});
try { await command(['info','--format','{{.ServerVersion}}']); }
catch(error) {
 if(process.platform!=='darwin') throw error;
 console.log('Iniciando Docker Desktop para preparar o pentest…');
 await command(['desktop','start','--timeout','60']);
 await command(['info','--format','{{.ServerVersion}}']);
}
await command(['pull','qmcgaw/gluetun@sha256:fa19cc76b2af13d57a8d3dc3066f2ada061b1c761b8aecf989b3877c0486e027']);
const extra=JSON.parse(await readFile('arsenal-extra-lock.json','utf8'));
await command(['pull',extra.zapImage]);
await command(['build','--file','containers/analysis/Dockerfile','--tag','ghosthunt-analysis:local','.']);
const imageId=await command(['image','inspect','ghosthunt-analysis:local','--format','{{.Id}}'],true);
const vpnImageId=await command(['image','inspect','qmcgaw/gluetun@sha256:fa19cc76b2af13d57a8d3dc3066f2ada061b1c761b8aecf989b3877c0486e027','--format','{{.Id}}'],true);
const zapImageId=await command(['image','inspect',extra.zapImage,'--format','{{.Id}}'],true);
await mkdir(folder,{recursive:true,mode:0o700});
let previous={};try{previous=JSON.parse(await readFile(join(folder,'config.json'),'utf8'));}catch{}
await writeFile(join(folder,'config.json'),JSON.stringify({...previous,imageId,vpnImageId,zapImageId},null,2),{mode:0o600});
await chmod(join(folder,'config.json'),0o600);
await writeFile(join(folder,'resolv.conf'),'nameserver 127.0.0.1\noptions timeout:2 attempts:2\n',{mode:0o600});
console.log('Imagem de análise, arsenal e ambiente Conda preparados. Cada análise de rede exige o gateway VPN saudável e confere o IP antes de acessar o alvo.');
