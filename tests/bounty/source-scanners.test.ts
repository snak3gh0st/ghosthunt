import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {mkdtemp,rm,writeFile,readdir} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";
vi.mock("../../src/bounty/process.js",()=>({binaryPath:vi.fn(async(id:string)=>`/fixed/${id}`),runProcess:vi.fn()}));
vi.mock("../../src/bounty/repository-review.js",()=>({reviewRepository:vi.fn(async(_directory,_target,_program,_signal,_fetcher,consume)=>({code:0,output:await consume([{path:"src/fixture.py",content:"# synthetic source only"}])}))}));
import {runProcess} from "../../src/bounty/process.js";import {scanSourceSecrets} from "../../src/bounty/expanded-tools.js";import {withExecution} from "../../src/bounty/execution.js";import {programInput,type Program} from "../../src/bounty/model.js";
let directory:string;
const target="https://github.com/example/lab";
const program:Program={...programInput.parse({name:"Scanner fixture",url:"https://hackerone.com/example",inScope:[target],scopeConfirmed:true,automationAllowed:true}),id:"fixture",scopeVersion:1,createdAt:"",updatedAt:""};
beforeEach(async()=>{vi.clearAllMocks();directory=await mkdtemp(join(tmpdir(),"ghosthunt-scanner-test-"));});afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
it("uses explicit local Semgrep rules, disables metrics and exposes bounded finding metadata",async()=>{
 vi.mocked(runProcess).mockImplementation(async(_binary,args,options)=>{expect(args).toContain("--config");expect(args).toContain("off");expect(options.env?.SEMGREP_ENABLE_VERSION_CHECK).toBe("0");await writeFile(args[args.indexOf("--output")+1],JSON.stringify({results:[{check_id:"python-shell-review",path:"src/fixture.py",start:{line:2},extra:{message:"Review trust boundary",lines:"not included in result"}}]}));return {code:0,output:""};});
 const result=await scanSourceSecrets(directory,target,program,undefined,"semgrep");expect(result.output).toContain("python-shell-review");expect(result.output).not.toContain("not included in result");expect(await readdir(directory)).toEqual([]);
});
it("never verifies discovered credentials or streams raw TruffleHog secrets",async()=>{
 const secret="synthetic-private-value-not-for-display",events:string[]=[];
 vi.mocked(runProcess).mockImplementation(async(_binary,args,options)=>{expect(args).toContain("--no-verification");expect(args).toContain("--no-update");expect(options.onStdout).toBeTypeOf("function");const output=JSON.stringify({DetectorName:"Synthetic",Raw:secret,RawV2:secret,SourceMetadata:{Data:{Filesystem:{file:"src/fixture.py",line:2}}}})+"\n";options.onStdout?.(output);return {code:0,output};});
 const result=await withExecution(event=>events.push(event.text),()=>scanSourceSecrets(directory,target,program,undefined,"trufflehog"));expect(result.output).toContain("Synthetic");expect(result.output).not.toContain(secret);expect(events.join("")).not.toContain(secret);expect(await readdir(directory)).toEqual([]);
});
it("removes sampled plaintext when a scanner fails without forwarding its raw output",async()=>{
 vi.mocked(runProcess).mockResolvedValue({code:2,output:"synthetic raw secret diagnostic"});await expect(scanSourceSecrets(directory,target,program,undefined,"trufflehog")).rejects.toThrow("não concluiu");expect(await readdir(directory)).toEqual([]);
});
