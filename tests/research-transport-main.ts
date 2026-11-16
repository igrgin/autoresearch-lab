import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { app, utilityProcess } from 'electron';
import Database from 'better-sqlite3';
import { ResearchSecurityHost } from '../src/research/security-port';
import { CredentialService } from '../src/security/credentials';
import { PrivateFiles } from '../src/security/private-files';
import type { SafeRecord } from '../src/security/recording';
import type { ResearchEvent } from '../src/research/contracts';
import { fixture } from './research-fixture';

function deferred() { let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve}; }
const wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
void app.whenReady().then(async()=>{
 for(const mode of ['late_commit','admission_timeout','utility_exit'] as const){
  const f=await fixture();let db:Database.Database|undefined;
  await f.seed();const a=f.attempt();await f.send(a);f.catalog.close();
  const credentials=new CredentialService(new PrivateFiles(path.join(f.root,'controlled-vault')),
   {available:async()=>true,encrypt:async value=>Buffer.from(value),decrypt:async bytes=>bytes.toString()},f.sanitizer);
  await credentials.initialize();const old='native-synthetic-current-credential',replacement='native-synthetic-replacement-credential';
  const credential=await credentials.register('openai',randomUUID(),'Controlled',old);
  const child=utilityProcess.fork(path.join(__dirname,'research-coordinator.cjs'),[f.root]);
  const ready=deferred(),exited=deferred(),admitted=deferred();
  const replies=new Map<string,(reply:{ok:boolean;value?:unknown})=>void>();
  let deliver:(()=>void)|undefined;let replacementDone=false;let changing:Promise<unknown>|undefined;
  const security=new ResearchSecurityHost(async()=>{await credentials.initialize();await f.recording.initialize();},f.sanitizer,f.recording,reply=>{
   const e=reply.record?.body as unknown as ResearchEvent|undefined;
   if(e && typeof e==='object' && e.fact?.kind==='activity' && !deliver){
    deliver=()=>child.postMessage(reply);
    changing=credentials.replace(credential.id,replacement).then(()=>{replacementDone=true;});
    admitted.resolve();return;
   }
   child.postMessage(reply);
  });
  child.on('message',(message:{coordinator?:string;channel?:string;id?:string;reply?:{ok:boolean;value?:unknown};record?:SafeRecord})=>{
   if(message.coordinator==='ready'){ready.resolve();return;}
   if(message.channel==='research_security'){void security.receive(message as Parameters<typeof security.receive>[0]);return;}
   if(message.id && message.reply){replies.get(message.id)?.(message.reply);replies.delete(message.id);}
  });
  child.once('exit',()=>{security.unavailable();exited.resolve();});
  try{
   await ready.promise;
   const event=f.make({kind:'activity',id:randomUUID(),revision:1,attemptId:a.fact.id,actionId:a.actionId,channel:'research',source:'stdout',type:'output',status:'completed',sourceTime:null,detail:`before ${old} after`});
   const requestId=randomUUID();const result=new Promise<{ok:boolean;value?:unknown}>(resolve=>replies.set(requestId,resolve));
   child.postMessage({channel:'research',id:requestId,request:{kind:'ingest',owner:'agent',event}});
   await admitted.promise;await wait(30);assert.equal(replacementDone,false);
   assert.throws(()=>f.sanitizer.register(randomUUID(),'native-intervening-registration'),{reason:'filter_unavailable'});
   db=new Database(path.join(f.project.location,'.lab','research.sqlite'));
   assert.equal((db.prepare('SELECT count(*) AS n FROM events WHERE event_id=?').get(event.eventId) as {n:number}).n,0);
   if(mode==='late_commit'){
    // The caller has stopped waiting before main forwards the final admission.
    assert.equal(await Promise.race([result.then(()=>'reply'),wait(30).then(()=>'caller_timeout')]),'caller_timeout');
    assert.equal(replacementDone,false);deliver!();assert.equal((await result).ok,true);await changing;
    assert.equal((db.prepare('SELECT count(*) AS n FROM events WHERE event_id=?').get(event.eventId) as {n:number}).n,1);
    assert.equal((db.prepare('SELECT body FROM detail').get() as {body:string}).body,'before [REDACTED:credential] after');
   }else if(mode==='admission_timeout'){
    assert.equal((await result).ok,false);await changing;deliver!();await wait(100);
    assert.equal((db.prepare('SELECT count(*) AS n FROM events WHERE event_id=?').get(event.eventId) as {n:number}).n,0);
   }else{child.kill();await exited.promise;await changing;assert.equal((db.prepare('SELECT count(*) AS n FROM events WHERE event_id=?').get(event.eventId) as {n:number}).n,0);}
   // Read SQLite and every WAL/SHM/identity file before any history read or quarantine.
   for(const name of readdirSync(path.join(f.project.location,'.lab')).filter(n=>n.startsWith('research.sqlite'))){
    const bytes=readFileSync(path.join(f.project.location,'.lab',name));assert.equal(bytes.includes(Buffer.from(old)),false);assert.equal(bytes.includes(Buffer.from(replacement)),false);
   }
   assert.equal(replacementDone,true);
  }finally{db?.close();child.kill();await exited.promise;f.cleanup();}
 }
 console.log('Research actual Electron main/utility: delayed caller, late admission timeout and utility exit passed; credential replacement waits for writer quiescence; native SQLite/WAL inspected before reads. Controlled fixtures only.');
 app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
