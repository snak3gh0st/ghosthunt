import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const directory=resolve(process.env.GHOSTHUNT_DATA_DIR || '.bounty/web');
const folder=join(directory,'integrations','burp-mcp');
const command=(binary,args)=>new Promise((resolve,reject)=>{
 const child=spawn(binary,args,{shell:false,stdio:['ignore','inherit','inherit']});
 child.on('error',reject);child.on('close',code=>code?reject(Error(`${binary} failed (${code})`)):resolve());
});
if(process.platform==='darwin') {
 try {await access('/Applications/Burp Suite.app/Contents/Resources/app/burpsuite.jar');console.log('Burp Suite: aplicação encontrada');}
 catch {console.log('Instalando Burp Suite Community a partir do Homebrew oficial…');await command('brew',['install','--cask','burp-suite']);}
} else console.log('Burp desktop: confira a instalação neste sistema. Nenhuma licença Professional é instalada automaticamente.');
await mkdir(folder,{recursive:true,mode:0o700});
const path=join(folder,'mcp-server-1.4.0.bapp');
const sha='fe7b40d5b5ed13ab6e40907bddef5df4f4a0685de13cff13f416acac8e4c045d';
let bytes;try{bytes=await readFile(path);}catch{}
if(!bytes || createHash('sha256').update(bytes).digest('hex')!==sha) {
 const response=await fetch('https://portswigger.net/bappstore/bapps/download/9952290f04ed4f628e624d0aa9dccebc/12',{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error(`Official Burp MCP download failed (${response.status})`);
 bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length>50_000_000 || createHash('sha256').update(bytes).digest('hex')!==sha)throw Error('Burp MCP official package checksum mismatch');
 await writeFile(path,bytes,{mode:0o600});
}
await command('unzip',['-o',path,'burp-mcp-all.jar','-d',folder]);
const jar=join(folder,'burp-mcp-all.jar');
if(createHash('sha256').update(await readFile(jar)).digest('hex')!=='b2514a9bdc6c1d10da78c01289208523bb73914e0649535619a1bd7e12c4420e')throw Error('Burp MCP JAR checksum mismatch');
const config={user_options:{extender:{reload_on_startup:true,extensions:[{extension_file:jar,extension_type:'java',loaded:true,name:'MCP Server',output:'ui',errors:'ui'}]}}};
await writeFile(join(folder,'user-config.json'),JSON.stringify(config,null,2),{mode:0o600});
console.log('Burp MCP 1.4.0: pacote e JAR oficiais conferidos por SHA-256');
console.log('O teste MCP do preparo confirma se a extensão foi carregada e habilitada; instalação não significa conexão pronta.');

if(process.platform==='darwin') {
 const online=await new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port:9876});const finish=v=>{socket.destroy();resolve(v);};socket.setTimeout(400,()=>finish(false));socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));});
 if(!online) await command('open',['-a','/Applications/Burp Suite.app','--args',`--user-config-file=${join(folder,'user-config.json')}`]);
}
