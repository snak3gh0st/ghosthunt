import {beforeEach,afterEach,it,expect} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";import {join} from "node:path";import {tmpdir} from "node:os";
import {BountyStore} from "../../src/bounty/store.js";import {buildBountyApp} from "../../src/bounty/server.js";import {parseCatalog} from "../../src/bounty/catalog.js";import {validScopeRule,matchesRule} from "../../src/bounty/scope.js";
const key="scope-review-test-only-credential",headers={"x-api-key":key};let directory:string,store:BountyStore,app:Awaited<ReturnType<typeof buildBountyApp>>;
const input={name:"Path-scoped program fixture",url:"https://hackerone.com/example",inScope:["https://app.example.test/account/cashback","https://app.example.test/book/"],outOfScope:["https://app.example.test/book/admin"],policy:"Own test accounts only. Follow the exact published asset paths.",scopeConfirmed:false};
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),"ghosthunt-scope-review-"));store=new BountyStore(directory);await store.init();app=await buildBountyApp({store,apiKey:key,catalog:{list:async()=>({fetchedAt:new Date().toISOString(),programs:[]})} as never});await app.ready();});
afterEach(async()=>{await app.close();await store.close();await rm(directory,{recursive:true,force:true});});
const req=(method:"GET"|"POST"|"PUT",url:string,payload?:unknown)=>app.inject({method,url,headers,...(payload===undefined?{}:{payload})});
async function create(){const response=await req("POST","/api/bounty/programs",input);expect(response.statusCode).toBe(201);return response.json();}
it("confirms the exact reviewed scope without requiring a pre-approved assessment or starting work",async()=>{
 const p=await create(),path=`/api/bounty/programs/${p.id}`,review=(await req("GET",path+"/scope-review")).json();expect(review.confirmed).toBe(false);
 expect((await req("POST",path+"/scope/confirm",{reviewToken:review.reviewToken,policyReviewed:false})).statusCode).toBe(400);
 const response=await req("POST",path+"/scope/confirm",{reviewToken:review.reviewToken,policyReviewed:true});expect(response.statusCode).toBe(200);
 expect(response.json().program).toMatchObject({scopeConfirmed:true,scopeVersion:2,inScope:input.inScope,outOfScope:input.outOfScope,policy:input.policy});
 expect((await store.read()).runs).toHaveLength(0);expect((await req("GET",path+"/assessment")).json().approved).toBe(false);
});
it("rejects a stale review instead of confirming changed rules",async()=>{
 const p=await create(),path=`/api/bounty/programs/${p.id}`,review=(await req("GET",path+"/scope-review")).json();await req("PUT",path,{...input,policy:"Changed policy"});
 expect((await req("POST",path+"/scope/confirm",{reviewToken:review.reviewToken,policyReviewed:true})).statusCode).toBe(409);expect((await store.read()).programs[0].scopeConfirmed).toBe(false);
});
it("preserves legacy non-web identifiers as references only after explicit acknowledgement",async()=>{
 const p=await create(),path=`/api/bounty/programs/${p.id}`;await store.mutate(data=>{data.programs[0].inScope.push("1477299281");data.programs[0].outOfScope.push("943905271");});
 const review=(await req("GET",path+"/scope-review")).json();expect(review.unsupported).toHaveLength(2);
 expect((await req("POST",path+"/scope/confirm",{reviewToken:review.reviewToken,policyReviewed:true})).statusCode).toBe(422);
 const result=await req("POST",path+"/scope/confirm",{reviewToken:review.reviewToken,policyReviewed:true,preserveUnsupported:true});expect(result.statusCode).toBe(200);expect(result.json().program.inScope).toEqual(input.inScope);expect(result.json().program.outOfScope).toEqual(input.outOfScope);expect(result.json().program.scopeReferences.map((item:{identifier:string})=>item.identifier)).toEqual(["1477299281","943905271"]);
});
it("does not approve a program containing only unsupported assets",async()=>{
 const p=await create(),path=`/api/bounty/programs/${p.id}`;await store.mutate(data=>{data.programs[0].inScope=["1477299281"];});const review=(await req("GET",path+"/scope-review")).json();expect((await req("POST",path+"/scope/confirm",{reviewToken:review.reviewToken,policyReviewed:true,preserveUnsupported:true})).statusCode).toBe(422);
});
it("does not reinterpret app-store IDs or noncanonical numeric hosts as IP permissions",()=>{
 for(const value of ["1477299281","https://1477299281","0x7f000001","127.1","0177.0.0.1"])expect(validScopeRule(value)).toBe(false);
 expect(validScopeRule("https://93.184.216.34:443")).toBe(true);expect(matchesRule("https://87.14.204.81","1477299281")).toBe(false);
});
it("retains typed mobile assets as catalog references instead of treating package IDs as DNS",()=>{
 const programs=parseCatalog([{handle:"example",name:"Example",url:input.url,offers_bounties:true,targets:{in_scope:[{asset_identifier:"app.example.test",asset_type:"URL",eligible_for_bounty:true},{asset_identifier:"com.example.android",asset_type:"GOOGLE_PLAY_APP_ID",eligible_for_bounty:true},{asset_identifier:"1477299281",asset_type:"APPLE_STORE_APP_ID",eligible_for_bounty:true}],out_of_scope:[]}}]);expect(programs[0].inScope).toEqual(["app.example.test"]);expect(programs[0].scopeReferences.map(item=>item.identifier)).toEqual(["com.example.android","1477299281"]);
});
