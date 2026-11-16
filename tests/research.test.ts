import assert from 'node:assert/strict';
import { createHash, randomUUID as id } from 'node:crypto';
import { readFileSync, readdirSync, renameSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { ResearchStore, type Checkpoint } from '../src/research/store';
import { RETENTION_V1, type Fact, type ResearchEvent } from '../src/research/contracts';
import { handleResearch } from '../src/research/host';
import { fixture, metric, commit } from './research-fixture';

async function baseline(f:Awaited<ReturnType<typeof fixture>>) {
  const attempt=f.attempt();const outcome=f.outcome(attempt.fact.id);const result=f.evaluation(attempt);
  const decision=f.make({kind:'decision',id:id(),revision:1,attemptId:attempt.fact.id,resultId:result.fact.id,comparatorResultId:null,comparatorCommit:null,
    policyRef:id(),previousDecisionEventId:null,status:'baseline_established',explanation:'Valid eligible baseline'});
  for(const e of [attempt,outcome,result,decision]) assert.equal((await f.send(e)).status,'applied');
  return {attempt,outcome,result,decision};
}
function decisionFact(e:ResearchEvent):Extract<Fact,{kind:'decision'}> { if(e.fact.kind!=='decision') throw new Error(); return e.fact; }

test('all outcome types, input/settings, hypotheses, history, hardware and decisions survive restart; replay has one effect',async()=>{
  const f=await fixture();try {
    await f.seed(); const b=await baseline(f);
    const candidates=[];
    for(const status of ['completed','failed','interrupted','pending'] as const) {
      const c=f.make({kind:'candidate',id:id(),revision:1,testedCommit:'c'.repeat(40),acceptedBaseCommit:commit,comparatorResultId:b.result.fact.id,hypothesis:`Hypothesis ${status}`,description:'Recorded before execution'});
      const a=f.attempt('candidate',c.fact as Extract<Fact,{kind:'candidate'}>);await f.send(c);await f.send(a);
      if(status!=='pending') await f.send(f.outcome(a.fact.id,status));
      const d=f.make({kind:'decision',id:id(),revision:1,attemptId:a.fact.id,resultId:null,comparatorResultId:b.result.fact.id,comparatorCommit:commit,policyRef:id(),previousDecisionEventId:null,
        status:status==='completed'||status==='pending'?'pending':'not_applicable',explanation:status==='completed'?'Acceptance unavailable':'Actual outcome'});
      if(status==='completed') {const result=f.evaluation(a);await f.send(result);decisionFact(d).resultId=result.fact.id;}
      await f.send(d); candidates.push({a,d});
      await f.send(f.make({kind:'sample',id:id(),revision:1,attemptId:a.fact.id,metric:metric('training',.5),phase:'training',step:3,sourceTime:null}));
    }
    const counts=f.make({kind:'counters',id:id(),revision:1,attemptCount:4,baselineCount:1,stagnationCount:0,policyRef:id()});await f.send(counts);
    const before=await f.store.inspect(f.runId);f.reopen();
    for(const e of [b.outcome,b.decision,counts,...candidates.flatMap(c=>[c.a,c.d])]) assert.equal((await f.send(e)).duplicate,true);
    const after=await f.store.inspect(f.runId);assert.deepEqual(after,before);
    assert.equal(after.projections.filter(e=>e.fact.kind==='attempt').length,5);
    assert.equal(after.projections.filter(e=>e.fact.kind==='decision').length,5);
    assert.equal(after.selectedResultId,b.result.fact.id);
    assert.equal(after.projections.filter(e=>e.fact.kind==='counters').length,1);
    assert.deepEqual(after.projections.filter(e=>e.fact.kind==='outcome').map(e=>(e.fact as Extract<Fact,{kind:'outcome'}>).status).sort(),['completed','completed','failed','interrupted']);
    assert.equal(after.projections.filter(e=>e.fact.kind==='sample').length,4);
  } finally {f.cleanup();}
});

test('pending decision resolves under the same identity with fixed comparator and selection once',async()=>{
 const f=await fixture();try{await f.seed();const b=await baseline(f);
 const c=f.make({kind:'candidate',id:id(),revision:1,testedCommit:'d'.repeat(40),acceptedBaseCommit:commit,comparatorResultId:b.result.fact.id,hypothesis:'Improve',description:'Candidate'});await f.send(c);
 const a=f.attempt('candidate',c.fact as Extract<Fact,{kind:'candidate'}>);const o=f.outcome(a.fact.id);const r=f.evaluation(a);
 const pending=f.make({kind:'decision',id:id(),revision:1,attemptId:a.fact.id,resultId:r.fact.id,comparatorResultId:b.result.fact.id,comparatorCommit:commit,policyRef:id(),previousDecisionEventId:null,status:'pending',explanation:'Waiting'});
 for(const e of [a,o,r,pending]) await f.send(e);f.reopen();
 const settled=f.make({...decisionFact(pending),revision:2,previousDecisionEventId:pending.eventId,status:'kept',explanation:'Validation improved'},{causedBy:[pending.eventId,o.eventId,r.eventId]});
 assert.equal((await f.send(settled)).status,'applied');assert.equal((await f.send(settled)).duplicate,true);
 const s=await f.store.inspect(f.runId);assert.equal(s.selectedResultId,r.fact.id);assert.equal(s.projections.filter(e=>e.fact.kind==='decision').length,2);
 assert.ok(s.records.some(e=>e.event?.eventId===pending.eventId));
 }finally{f.cleanup();}
});

test('out of order, missing causes, terminal conflicts and altered event IDs preserve evidence without last writer wins',async()=>{
 const f=await fixture();try{await f.seed();const a=f.attempt();await f.send(a);
 const first=f.outcome(a.fact.id);const stream=id(),producer=id();first.streamId=stream;first.producerId=producer;first.sequence=1;
 assert.equal((await f.send(first)).status,'pending');let s=await f.store.inspect(f.runId);assert.equal(s.gaps.length,1);assert.equal(s.projections.filter(e=>e.fact.kind==='outcome').length,0);
 const control=f.make({kind:'control',id:id(),revision:1,command:'stop',disposition:'unknown',supersededBy:null,explanation:'Cancellation receipt uncertain'},{streamId:stream,producerId:producer,sequence:0});await f.send(control);
 assert.equal((await f.store.inspect(f.runId)).projections.filter(e=>e.fact.kind==='outcome').length,1);
 const conflicting=f.outcome(a.fact.id,'interrupted');await f.send(conflicting);
 s=await f.store.inspect(f.runId);assert.equal(s.projections.filter(e=>e.fact.kind==='outcome').length,0);assert.equal(s.records.filter(e=>e.reason==='outcome_conflict').length,2);
 const altered={...first,fact:{...first.fact,explanation:'Changed source bytes'}};await f.send(altered);
 s=await f.store.inspect(f.runId);assert.equal(s.records.filter(e=>e.event?.eventId===first.eventId).length,2);assert.ok(s.records.some(e=>e.reason==='event_identity_conflict'));
 const late=f.make({kind:'action',id:id(),revision:1,phase:'preparation',integration:'fixture',model:'fixture',status:'pending',details:null},{causedBy:[id()]});assert.equal((await f.send(late)).status,'pending');
 }finally{f.cleanup();}
});

test('conflicting tested commits and wrong input/evaluator/checkpoint joins cannot advance acceptance',async()=>{
 const f=await fixture();try{await f.seed();const b=await baseline(f);const wrong=f.evaluation(b.attempt);if(wrong.fact.kind!=='evaluation')throw new Error();wrong.fact.testedCommit='e'.repeat(40);
 assert.equal((await f.send(wrong)).status,'conflict'); // competing final result invalidates dependent selection
 assert.equal((await f.store.inspect(f.runId)).selectedResultId,null);
 const altered=structuredClone(b.attempt);if(altered.fact.kind!=='attempt')throw new Error();altered.eventId=id();altered.streamId=id();altered.fact.testedCommit='f'.repeat(40);await f.send(altered);
 const s=await f.store.inspect(f.runId);assert.equal(s.projections.filter(e=>e.fact.kind==='attempt').length,0);assert.equal(s.selectedResultId,null);
 await assert.rejects(f.store.bind('agent').ingest(f.outcome(b.attempt.fact.id)),{code:'invalid_input'});
 await assert.rejects(f.send({...f.run,projectId:id()}),{code:'permission_denied'});
 }finally{f.cleanup();}
});

test('safe admission precedes SQL/WAL/detail; test assessments and activity stay out of agent validation',async()=>{
 const f=await fixture();try{const secret='synthetic-research-credential-87';f.sanitizer.register(id(),secret);await f.seed();const b=await baseline(f);
 const activity=f.make({kind:'activity',id:id(),revision:1,attemptId:b.attempt.fact.id,actionId:id(),channel:'research',source:'stdout',type:'tool',status:'completed',sourceTime:null,detail:`before ${secret} after`});await f.send(activity);
 const assessment=f.make({kind:'assessment',id:id(),revision:1,attemptId:b.attempt.fact.id,evaluationId:b.result.fact.id,checkpointId:(b.result.fact as Extract<Fact,{kind:'evaluation'}>).checkpointId,metrics:[metric('test',.912345)],explanation:'User-only assessment'});await f.send(assessment);
 await f.send(f.make({...activity.fact,id:id(),channel:'assessment',detail:'Test assessment: .912345'} as Fact));
 const context=JSON.stringify(await f.store.agentValidation(f.runId));assert.ok(context.includes('validation'));assert.ok(!context.includes('.912345'));assert.ok(!context.includes('Test assessment'));
 const s=JSON.stringify(await f.store.inspect(f.runId));assert.ok(s.includes('[REDACTED:credential]'));assert.ok(!s.includes(secret));
 for(const name of readdirSync(path.join(f.project.location,'.lab')).filter(n=>n.startsWith('research.sqlite'))) assert.ok(!readFileSync(path.join(f.project.location,'.lab',name)).includes(Buffer.from(secret)));
 f.reopen();assert.ok(!JSON.stringify(await f.store.inspect(f.runId)).includes(secret));
 }finally{f.cleanup();}
});

test('newly discovered secrets and quarantine withhold entire run including earlier projections and detail',async()=>{
 const f=await fixture();try{await f.seed();await baseline(f);const secret='later-discovered-synthetic-value';await f.send(f.make({kind:'action',id:id(),revision:1,phase:'preparation',integration:'fixture',model:'fixture',status:'completed',details:secret}));
 f.sanitizer.register(id(),secret);const s=await f.store.inspect(f.runId);assert.ok(s.records.every(r=>r.event===null));assert.deepEqual(s.projections,[]);assert.equal(s.requiresReconciliation,true);assert.ok(!JSON.stringify(s).includes(secret));
 await assert.rejects(f.store.agentValidation(f.runId),{code:'capture_failed'});
 }finally{f.cleanup();}
});

test('activity body retains UTF-8 head/tail with explicit gaps; structured metric history is independent',async()=>{
 const f=await fixture();try{await f.seed();const a=f.attempt();await f.send(a);
 const body='🙂'.repeat(25*1024);const activity=f.make({kind:'activity',id:id(),revision:1,attemptId:a.fact.id,actionId:id(),channel:'research',source:'stdout',type:'output',status:'completed',sourceTime:null,detail:body});await f.send(activity);
 await f.send(f.make({kind:'sample',id:id(),revision:1,attemptId:a.fact.id,metric:metric('training'),phase:'training',step:0,sourceTime:null}));
 const snapshot=await f.store.inspect(f.runId);const row=snapshot.records.find(r=>r.event?.eventId===activity.eventId)!;
 const chunks=row.detail as {from:number;to:number;text:string}[];assert.equal(chunks.reduce((sum,c)=>sum+Buffer.byteLength(c.text),0),RETENTION_V1.bodyBytes);
 assert.equal((row.omissions[0] as {byteTo:number;byteFrom:number}).byteTo-(row.omissions[0] as {byteFrom:number}).byteFrom,36*1024);
 assert.ok(!JSON.stringify(chunks).includes('�'));assert.equal(snapshot.projections.filter(e=>e.fact.kind==='sample').length,1);
 assert.equal((await f.send(activity)).duplicate,true);
 }finally{f.cleanup();}
});

test('Pause/Finish/Stop supersession and preparation actions remain inspectable without fictional attempts',async()=>{
 const f=await fixture();try{await f.seed();const stop=id();const commands=[];
 for(const command of ['pause','finish','stop'] as const){const e=f.make({kind:'control',id:command==='stop'?stop:id(),revision:1,command,disposition:command==='stop'?'applied':'superseded',supersededBy:command==='stop'?null:stop,explanation:'Stop dominates pending drain'});commands.push(e);await f.send(e);}
 await f.send(f.make({kind:'action',id:id(),revision:1,phase:'preparation',integration:'fixture',model:'fixture',status:'interrupted',details:'Partial prepared files retained'}));f.reopen();
 const s=await f.store.inspect(f.runId);assert.equal(s.projections.filter(e=>e.fact.kind==='attempt').length,0);assert.equal(s.projections.filter(e=>e.fact.kind==='control').length,3);for(const e of commands)assert.equal((await f.send(e)).duplicate,true);
 }finally{f.cleanup();}
});

for(const target of ['outcome','decision','counters'] as const) for(const checkpoint of ['before_event','after_event','after_projection','after_cursor','after_commit'] as Checkpoint[]) test(`SIGKILL ${target} at ${checkpoint} recovers event/projection/cursor atomically`,async()=>{
 const f=await fixture();try{await f.seed();const a=f.attempt();await f.send(a);let o=f.outcome(a.fact.id);
 if(target==='decision'){const outcome=o;const result=f.evaluation(a);await f.send(outcome);await f.send(result);o=f.make({kind:'decision',id:id(),revision:1,attemptId:a.fact.id,resultId:result.fact.id,comparatorResultId:null,comparatorCommit:null,policyRef:id(),previousDecisionEventId:null,status:'baseline_established',explanation:'Valid baseline'});}
 if(target==='counters')o=f.make({kind:'counters',id:id(),revision:1,attemptCount:0,baselineCount:1,stagnationCount:0,policyRef:id()});
 const file=path.join(f.project.location,'.lab','research.sqlite');f.store.close();
 const child=spawnSync(process.execPath,[path.resolve('.webpack/tests/research-crash.cjs'),file,f.project.projectId,path.join(f.root,'crash-security'),JSON.stringify(o),checkpoint],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8'});
 assert.equal(child.signal,'SIGKILL',child.stderr);
 // Catalog owns the closed handle, so open this store independently for the crash check.
 const reopened=new ResearchStore(file,f.project.projectId,f.recording);try{
 const before=await reopened.inspect(f.runId);assert.equal(before.projections.filter(e=>e.fact.kind===target).length,checkpoint==='after_commit'?1:0);
 const receipt=await reopened.bind(target==='outcome'?'execution':target==='decision'?'coordinator':'stopping').ingest(o);assert.equal(receipt.duplicate,checkpoint==='after_commit');assert.equal(receipt.cursor,0);
 assert.equal((await reopened.inspect(f.runId)).projections.filter(e=>e.fact.kind===target).length,1);
 }finally{reopened.close();}
 }finally{f.cleanup();}
});

test('host fails safely on unavailable projects without leaking raw diagnostics',async()=>{
 const f=await fixture();try{
 const reply=await handleResearch({research(){throw new Error('synthetic sensitive diagnostic');}} as never,f.recording,{kind:'inspect',projectId:id(),runId:id()});
 assert.equal(reply.ok,false);assert.ok(!JSON.stringify(reply).includes('sensitive diagnostic'));
 }finally{f.cleanup();}
});

test('4 MiB per-run capture queue drops detail with a durable gap and does not drop essential envelopes',async()=>{
 const f=await fixture();try{await f.seed();
 const activity=()=>f.make({kind:'activity',id:id(),revision:1,attemptId:null,actionId:id(),channel:'research',source:'stdout',type:'output',status:'completed',sourceTime:null,detail:'q-'.repeat(1.5*1024*1024)});
 const first=activity(),second=activity();const receipts=await Promise.all([f.send(first),f.send(second)]);assert.ok(receipts.every(r=>r.status==='applied'));
 const snapshot=await f.store.inspect(f.runId);const row=snapshot.records.find(r=>r.event?.eventId===second.eventId)!;assert.deepEqual(row.detail,[]);
 assert.equal((row.omissions[0] as {cause:string}).cause,'queue_overflow');
 // Replay retrieves sanitized detail under the same envelope; the original gap survives.
 assert.equal((await f.send(second)).duplicate,true);const repaired=await f.store.inspect(f.runId);const record=repaired.records.find(r=>r.event?.eventId===second.eventId)!;
 assert.equal(record.retrievals.length,1);assert.equal(record.omissions.length,2);assert.equal(repaired.records.length,snapshot.records.length);
 assert.equal((await f.send(second)).duplicate,true);
 }finally{f.cleanup();}
});

test('required transaction write failure rolls back, exposes a durable fault and fences new admissions after reopen',async()=>{
 const f=await fixture();try{await f.seed();const file=path.join(f.project.location,'.lab','failure.sqlite');
 const store=new ResearchStore(file,f.project.projectId,f.recording,stage=>{if(stage==='after_event')throw new Error('synthetic-private-storage-fault');});
 await assert.rejects(store.bind('configuration').ingest(f.run),error=>!String(error).includes('synthetic-private-storage-fault'));
 assert.equal((await store.inspect(f.runId)).records.length,0);store.close();
 const reopened=new ResearchStore(file,f.project.projectId,f.recording);try{assert.equal((await reopened.inspect(f.runId)).captureBlocked,true);
 await assert.rejects(reopened.bind('execution').ingest(f.attempt()),{code:'capture_failed'});
 assert.throws(()=>reopened.recoverCapture(f.runId,{id:id(),evidenceId:id(),effectsReconciled:true,boundaryVerified:true,explicitResume:false}),{code:'permission_denied'});
 reopened.recoverCapture(f.runId,{id:id(),evidenceId:id(),effectsReconciled:true,boundaryVerified:true,explicitResume:true});
 assert.equal((await reopened.inspect(f.runId)).captureBlocked,false);assert.equal((await reopened.bind('configuration').ingest(f.run)).status,'applied');
 }finally{reopened.close();}
 }finally{f.cleanup();}
});

test('invalid and absent metric values remain typed, while rejected valid measurements remain independent from selection',async()=>{
 const f=await fixture();try{await f.seed();const b=await baseline(f);
 const c=f.make({kind:'candidate',id:id(),revision:1,testedCommit:'d'.repeat(40),acceptedBaseCommit:commit,comparatorResultId:b.result.fact.id,hypothesis:'Maybe improves',description:'Rejected on validation'});await f.send(c);
 const a=f.attempt('candidate',c.fact as Extract<Fact,{kind:'candidate'}>);const o=f.outcome(a.fact.id);const r=f.evaluation(a);if(r.fact.kind!=='evaluation')throw new Error();r.fact.eligible=false;
 r.fact.metrics.push({...metric(),value:null,validity:'missing',reason:'Optional metric unavailable'});
 const d=f.make({kind:'decision',id:id(),revision:1,attemptId:a.fact.id,resultId:r.fact.id,comparatorResultId:b.result.fact.id,comparatorCommit:commit,policyRef:id(),previousDecisionEventId:null,status:'discarded',explanation:'Constraint failed'});
 for(const e of [a,o,r,d])await f.send(e);const s=await f.store.inspect(f.runId);assert.equal(s.selectedResultId,b.result.fact.id);
 assert.equal(s.projections.filter(e=>e.fact.kind==='evaluation').length,2);assert.ok(JSON.stringify(s).includes('Optional metric unavailable'));
 const invalid=f.evaluation(a);if(invalid.fact.kind!=='evaluation')throw new Error();invalid.fact.metrics[0].value=NaN;
 await assert.rejects(f.send(invalid),{code:'invalid_input'});
 }finally{f.cleanup();}
});

test('actual catalog host opens the project-bound store; unavailable projects and unsupported evidence stay fenced',async()=>{
 const f=await fixture();try{await f.seed();const response=await handleResearch(f.catalog,f.recording,{kind:'inspect',projectId:f.project.projectId,runId:f.runId});assert.equal(response.ok,true);
 const missing=await handleResearch(f.catalog,f.recording,{kind:'inspect',projectId:id(),runId:f.runId});assert.equal(missing.ok,false);
 const unknown=f.make({kind:'unsupported',id:id(),revision:1,originalKind:'future.terminal',payload:{futureStatus:'not understood'}});await f.send(unknown);
 const incompatible=f.make({kind:'action',id:id(),revision:1,phase:'preparation',integration:'fixture',model:'fixture',status:'completed',details:null},{contractVersion:{major:2,minor:0}});await f.send(incompatible);
 const s=await f.store.inspect(f.runId);assert.ok(s.records.some(r=>r.reason==='unsupported_critical_kind'));assert.ok(s.records.some(r=>r.reason==='incompatible_version'));
 assert.equal(s.requiresReconciliation,true);assert.deepEqual(await f.store.agentValidation(f.runId),[]);
 }finally{f.cleanup();}
});

test('excluded raw capture sources produce omission envelopes and preserve unknown ranges',async()=>{
 const f=await fixture();try{await f.seed();const e=f.make({kind:'activity',id:id(),revision:1,attemptId:null,actionId:id(),channel:'research',source:'native_history',type:'transcript',status:'completed',sourceTime:null,detail:'native-private-synthetic-value'});await f.send(e);
 const row=(await f.store.inspect(f.runId)).records.find(r=>r.event?.eventId===e.eventId)!;assert.deepEqual(row.detail,[]);assert.equal((row.omissions[0] as {droppedBytes:number|null}).droppedBytes,null);
 for(const name of readdirSync(path.join(f.project.location,'.lab')).filter(n=>n.startsWith('research.sqlite')))assert.ok(!readFileSync(path.join(f.project.location,'.lab',name)).includes(Buffer.from('native-private-synthetic-value')));
 }finally{f.cleanup();}
});

test('sanitizer failure blocks required publication without storing a raw fallback',async()=>{
 const f=await fixture();try{await f.seed();f.sanitizer.filter=()=>{throw new Error('unsafe-filter-diagnostic');};
 await assert.rejects(f.send(f.attempt()),error=>!String(error).includes('unsafe-filter-diagnostic'));
 assert.equal((await f.store.inspect(f.runId)).captureBlocked,true);
 }finally{f.cleanup();}
});

// Seed a controlled near-quota replica from an actually admitted event. This
// exercises quota boundaries without replaying thousands of earlier transactions.
async function quotaFixture(f:Awaited<ReturnType<typeof fixture>>,buckets:number) {
 const e=f.make({kind:'activity',id:id(),revision:1,attemptId:null,actionId:id(),channel:'research',source:'stdout',type:'output',status:'completed',sourceTime:null,detail:'x'.repeat(64*1024)});await f.send(e);
 const db=new Database(path.join(f.project.location,'.lab','research.sqlite'));
 const base=db.prepare('SELECT source FROM events WHERE event_id=?').get(e.eventId) as {source:string};
 const count=buckets*256;const bucketIds=Array.from({length:buckets},()=>id());
 db.transaction(()=>{
   db.prepare('DELETE FROM detail').run();
   for(let i=0;i<count;i++) {
     const source=JSON.parse(base.source);const eventId=id();source.event.eventId=eventId;source.event.fact.id=id();source.event.streamId=id();source.event.producerId=id();
     const bucket=buckets===1?'setup':bucketIds[Math.floor(i/256)];source.event.fact.attemptId=buckets===1?null:bucket;
     source.admission.envelope.eventId=eventId;source.admission.envelope.streamId=source.event.streamId;source.admission.envelope.producerId=source.event.producerId;
     const serialized=JSON.stringify(source);
     const ordinal=Number(db.prepare('INSERT INTO events(event_id,run_id,producer_id,stream_id,sequence,fingerprint,source,received_at) VALUES (?,?,?,?,?,?,?,?)').run(eventId,f.runId,source.event.producerId,source.event.streamId,0,createHash('sha256').update(serialized).digest('hex'),serialized,new Date().toISOString()).lastInsertRowid);
     db.prepare('INSERT INTO detail VALUES (?,0,?,?,0,65536,?,65536)').run(ordinal,f.runId,bucket,'x'.repeat(65536));
   }
 })();
 return {db,source:e,count};
}

test('16 MiB bucket preserves first 4 MiB and latest 12 MiB; eviction keeps every envelope',async()=>{
 const f=await fixture();let db:Database.Database|undefined;try{await f.seed();const q=await quotaFixture(f,1);db=q.db;
 const before=(db.prepare('SELECT count(*) AS n FROM events').get() as {n:number}).n;
 const next=structuredClone(q.source);next.eventId=id();next.streamId=id();next.fact.id=id();await f.send(next);
 assert.equal((db.prepare('SELECT sum(bytes) AS n FROM detail').get() as {n:number}).n,16*1024*1024);
 assert.equal((db.prepare("SELECT sum(end_byte-start_byte) AS n FROM omissions WHERE cause='bucket_cap'").get() as {n:number}).n,65536);
 assert.equal((db.prepare('SELECT count(*) AS n FROM events').get() as {n:number}).n,before+1);
 const ordinals=(db.prepare('SELECT ordinal FROM detail ORDER BY ordinal').all() as {ordinal:number}[]).map(r=>r.ordinal);
 assert.ok(ordinals.slice(0,64).every((n,i)=>n===i+5));assert.ok(!ordinals.includes(69));
 }finally{db?.close();f.cleanup();}
});

test('256 MiB run cap evicts oldest detail across buckets, retaining source envelopes and ingestion positions',async()=>{
 const f=await fixture();let db:Database.Database|undefined;try{await f.seed();const q=await quotaFixture(f,16);db=q.db;
 const before=(db.prepare('SELECT count(*) AS n FROM events').get() as {n:number}).n;
 const oldest=(db.prepare('SELECT min(ordinal) AS n FROM detail').get() as {n:number}).n;
 const next=structuredClone(q.source);next.eventId=id();next.streamId=id();next.fact.id=id();await f.send(next);
 assert.equal((db.prepare('SELECT sum(bytes) AS n FROM detail').get() as {n:number}).n,RETENTION_V1.runBytes);
 assert.equal((db.prepare("SELECT sum(end_byte-start_byte) AS n FROM omissions WHERE cause='run_cap'").get() as {n:number}).n,65536);
 assert.equal((db.prepare('SELECT min(ordinal) AS n FROM detail').get() as {n:number}).n,oldest+1);
 assert.equal((db.prepare('SELECT count(*) AS n FROM events').get() as {n:number}).n,before+1);
 assert.ok(db.prepare('SELECT 1 FROM events WHERE ordinal=?').get(oldest));
 }finally{db?.close();f.cleanup();}
});

test('late replay of an older owner revision cannot roll back counter or run-state projections',async()=>{
 const f=await fixture();try{await f.seed();
 const counter=f.make({kind:'counters',id:id(),revision:1,attemptCount:1,baselineCount:1,stagnationCount:0,policyRef:id()});await f.send(counter);
 const later=f.make({...counter.fact,revision:2,attemptCount:2} as Fact);await f.send(later);
 await f.send({...counter,eventId:id(),streamId:id(),producerId:id()});
 const state=f.make({kind:'run_state',id:id(),revision:1,state:'active',phase:'training',reason:'Running',branch:'runs/synthetic',workDirectoryRef:id()});await f.send(state);
 await f.send(f.make({...state.fact,revision:2,state:'paused',reason:'Scope stop confirmed'} as Fact));await f.send({...state,eventId:id(),streamId:id(),producerId:id()});
 const s=await f.store.inspect(f.runId);const c=s.projections.find(e=>e.fact.kind==='counters')!.fact as Extract<Fact,{kind:'counters'}>;assert.equal(c.attemptCount,2);assert.equal(c.revision,2);
 assert.equal((s.projections.find(e=>e.fact.kind==='run_state')!.fact as Extract<Fact,{kind:'run_state'}>).state,'paused');
 }finally{f.cleanup();}
});

test('a newly discovered credential in the last activity body withholds earlier records in that same read',async()=>{
 const f=await fixture();try{await f.seed();await baseline(f);const secret='later-activity-value';
 await f.send(f.make({kind:'activity',id:id(),revision:1,attemptId:null,actionId:id(),channel:'research',source:'stdout',type:'output',status:'completed',sourceTime:null,detail:secret}));
 const credentialId=id();f.sanitizer.register(credentialId,secret);const snapshot=await f.store.inspect(f.runId);assert.ok(f.revoked.includes(credentialId));assert.ok(snapshot.records.every(r=>r.event===null && r.detail.length===0));assert.deepEqual(snapshot.projections,[]);assert.ok(!JSON.stringify(snapshot).includes(secret));
 }finally{f.cleanup();}
});

test('required attempt identities and tested commits cannot be null at the runtime boundary',async()=>{
 const f=await fixture();try{await f.seed();
 for(const key of ['snapshotId','manifestId','hardwareId','testedCommit','reservationId']) {const attempt=f.attempt();(attempt.fact as unknown as Record<string,unknown>)[key]=null;await assert.rejects(f.send(attempt),{code:'invalid_input'});}
 assert.equal((await f.store.inspect(f.runId)).projections.filter(e=>e.fact.kind==='attempt').length,0);
 }finally{f.cleanup();}
});

test('failed baseline retry and invalid evaluation retain their own identities and do not fabricate selection',async()=>{
 const f=await fixture();try{await f.seed();const failed=f.attempt();await f.send(failed);await f.send(f.outcome(failed.fact.id,'failed'));
 const retry=f.attempt();await f.send(retry);await f.send(f.outcome(retry.fact.id));const invalid=f.evaluation(retry);if(invalid.fact.kind!=='evaluation')throw new Error();invalid.fact.validity='invalid';invalid.fact.eligible=null;invalid.fact.metrics=[{...metric(),value:null,validity:'invalid',reason:'non_finite_measurement'}];await f.send(invalid);
 await f.send(f.make({kind:'decision',id:id(),revision:1,attemptId:retry.fact.id,resultId:invalid.fact.id,comparatorResultId:null,comparatorCommit:null,policyRef:id(),previousDecisionEventId:null,status:'not_applicable',explanation:'Invalid final validation'}));f.reopen();
 const s=await f.store.inspect(f.runId);assert.equal(s.projections.filter(e=>e.fact.kind==='attempt').length,2);assert.equal(s.selectedResultId,null);assert.ok(JSON.stringify(s).includes('non_finite_measurement'));assert.deepEqual(await f.store.agentValidation(f.runId),[]);
 }finally{f.cleanup();}
});

test('a previously bound research database cannot be silently recreated after loss, and assessment storage is private',async()=>{
 const f=await fixture();try{await f.seed();const file=path.join(f.project.location,'.lab','research.sqlite');
 assert.equal(lstatSync(file).mode&0o077,0);assert.equal(lstatSync(path.dirname(file)).mode&0o077,0);
 f.store.close();renameSync(file,`${file}.preserved`);
 assert.throws(()=>new ResearchStore(file,f.project.projectId,f.recording),{code:'capture_failed'});assert.equal(existsSync(file),false);
 assert.throws(()=>new ResearchStore(`${file}.preserved`,id(),f.recording),{code:'conflict'});
 }finally{f.cleanup();}
});
