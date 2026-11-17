import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ResearchSecurityClient, ResearchSecurityHost } from '../src/research/security-port';
import { Sanitizer } from '../src/security/sanitizer';
import type { MemoryAdmission, SafeRecord } from '../src/security/recording';

function deferred() { let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve}; }
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function pair(initialize=async()=>{},timeout=30) {
 const matcher=new Sanitizer();const sent:unknown[]=[];
 const recording:MemoryAdmission={admit:async()=>{throw new Error();},admitReceipt:async()=>{throw new Error();},recheck:async record=>record};
 const host=new ResearchSecurityHost(initialize,matcher,recording,reply=>{sent.push(reply);client.receive(reply);});
 const client=new ResearchSecurityClient(message=>{void host.receive(message);},timeout);
 return {matcher,host,client,sent,recording};
}
test('R4 late hold reply after admission timeout cannot leak matching ownership',async()=>{
 const ready=deferred();const p=pair(()=>ready.promise);
 await assert.rejects(p.client.withMatchingPolicy(async()=>assert.fail()),{code:'capture_failed'});
 ready.resolve();await tick();p.matcher.register(randomUUID(),'synthetic-timeout-after-no-write');assert.deepEqual(p.sent,[]);p.host.unavailable();
});
test('R4 caller timeout does not release a live writer; actual settlement or exit does',async()=>{
 const p=pair();const commit=deferred(),started=deferred();
 const write=p.client.withMatchingPolicy(async()=>{started.resolve();await commit.promise;});await started.promise;
 assert.throws(()=>p.matcher.register(randomUUID(),'synthetic-during-write'),{reason:'filter_unavailable'});
 let mutated=false;const mutate=p.matcher.registerWhenMutable(randomUUID(),'synthetic-after-write').then(()=>{mutated=true;});
 // A caller may stop waiting; only the still-running writer owns its lease.
 assert.equal(await Promise.race([write.then(()=>'written'),tick().then(()=>'caller-timeout')]),'caller-timeout');assert.equal(mutated,false);
 commit.resolve();await write;await mutate;assert.equal(mutated,true);
 const blocked=deferred(),inFlight=deferred();const late=p.client.withMatchingPolicy(async()=>{inFlight.resolve();await blocked.promise;});await inFlight.promise;
 p.host.unavailable();p.matcher.register(randomUUID(),'synthetic-after-confirmed-exit');blocked.resolve();await late;
});
test('R4 admission timeout prevents late replies from reviving a settled writer',async()=>{
 const p=pair();const reply=deferred();const started=deferred();
 p.recording.admit=async()=>{started.resolve();await reply.promise;return {} as SafeRecord;};
 const writing=p.client.withMatchingPolicy(async port=>{await port.admit({} as never,null);assert.fail('late write revived');});
 await started.promise;await assert.rejects(writing,{code:'capture_failed'});
 p.matcher.register(randomUUID(),'synthetic-after-settled-writer');reply.resolve();await tick();p.host.unavailable();
});
