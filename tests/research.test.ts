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

test('queue pressure on an unchanged activity replay preserves its ordinal, detail and dependent projections',async()=>{
 for(const restart of [false,true]) {
  const f=await fixture();try {
   await f.seed();await baseline(f);
   const activity=()=>f.make({kind:'activity',id:id(),revision:1,attemptId:null,actionId:id(),channel:'research',source:'stdout',type:'output',status:'completed',sourceTime:null,detail:'q-'.repeat(1.5*1024*1024)});
   const original=activity();const first=await f.send(original);
   const before=await f.store.inspect(f.runId);const detail=before.records.find(r=>r.event?.eventId===original.eventId)!.detail;
   assert.equal((await f.store.agentValidation(f.runId)).length,1);
   if(restart)f.reopen();
   const [,replay]=await Promise.all([f.send(activity()),f.send(original)]);
   assert.equal(replay.duplicate,true);assert.equal(replay.ordinal,first.ordinal);
   if(original.fact.kind!=='activity')assert.fail();
   const dependent=f.make({...original.fact,id:id(),detail:null},{producerId:original.producerId,streamId:original.streamId,sequence:1,causedBy:[original.eventId]});
   assert.equal((await f.send(dependent)).status,'applied');
   const after=await f.store.inspect(f.runId);const rows=after.records.filter(r=>r.event?.eventId===original.eventId);
   assert.equal(rows.length,1);assert.equal(rows[0].status,'applied');assert.deepEqual(rows[0].detail,detail);
   assert.equal(after.requiresReconciliation,false);assert.equal((await f.store.agentValidation(f.runId)).length,1);
   assert.equal((await f.send(original)).ordinal,first.ordinal);
   // Available contradictory detail still represents a real identity conflict.
   const changed=structuredClone(original);
   if(changed.fact.kind!=='activity')assert.fail();changed.fact.detail='Contradictory producer output';
   assert.equal((await f.send(changed)).duplicate,false);
   assert.equal((await f.store.inspect(f.runId)).requiresReconciliation,true);
  }finally{f.cleanup();}
 }
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

test('diff-prefixed URL userinfo is removed before inspect and SQLite retention', async () => {
 const f=await fixture();try {await f.seed();
 const raw='+https://unregistered-user:ordinary-fixture-value@example.invalid/model';
 const e=f.make({kind:'activity',id:id(),revision:1,attemptId:null,actionId:id(),channel:'research',source:'diff',type:'patch',status:'completed',sourceTime:null,detail:raw});await f.send(e);
 const inspected=JSON.stringify(await f.store.inspect(f.runId));
 for(const forbidden of ['unregistered-user','ordinary-fixture-value']) {
  assert.equal(inspected.includes(forbidden),false);
  for(const name of readdirSync(path.join(f.project.location,'.lab')).filter(n=>n.startsWith('research.sqlite')))assert.equal(readFileSync(path.join(f.project.location,'.lab',name)).includes(Buffer.from(forbidden)),false);
 }
 }finally{f.cleanup();}
});

test('actual unknown fact preserves admitted original identity and evidence, with exact replay and changed-source conflict', async () => {
 const f=await fixture();try {await f.seed();const sensitive='synthetic-future-evidence-value';f.sanitizer.register(id(),sensitive);
 const original={kind:'future.terminal',id:id(),revision:7,schemaVersion:4,status:'completed',evidenceId:id(),description:`Source evidence ${sensitive}`};
 const e=f.make({kind:'unsupported',id:id(),revision:1,originalKind:'unused',payload:null});e.fact=original as unknown as Fact;
 const port=()=>f.store.bind('execution');const receipt=await port().ingest(e);assert.equal(receipt.duplicate,false);f.reopen();
 const state=await f.store.inspect(f.runId);const retained=state.records.find(row=>row.event?.eventId===e.eventId)!.event!.fact;
 assert.equal(retained.kind,'unsupported');if(retained.kind!=='unsupported')assert.fail();
 const payload=retained.payload as Record<string,unknown>;assert.equal(payload.id,original.id);assert.equal(payload.revision,7);assert.equal(payload.schemaVersion,4);assert.equal(payload.evidenceId,original.evidenceId);assert.equal(payload.status,'completed');assert.equal(JSON.stringify(state).includes(sensitive),false);
 assert.equal((await port().ingest(e)).duplicate,true);
 const altered={...e,fact:{...original,status:'failed'} as unknown as Fact};assert.equal((await port().ingest(altered)).duplicate,false);
 const after=await f.store.inspect(f.runId);assert.equal(after.records.filter(row=>row.event?.eventId===e.eventId).length,2);assert.ok(after.records.some(row=>row.reason==='event_identity_conflict'));assert.equal(after.projections.some(row=>row.fact.kind==='unsupported'),false);
 }finally{f.cleanup();}
});

// PR115-R3-F01: one original oversized head crosses both bucket keep ranges.
test('R3 quota split at H-1 preserves an oversized body without part collisions',async()=>{
 const f=await fixture();let db:Database.Database|undefined;try {await f.seed();
 const oversized=f.make({kind:'activity',id:id(),revision:1,attemptId:null,actionId:id(),channel:'research',source:'stdout',type:'output',status:'completed',sourceTime:null,detail:'A'.repeat(32768)+'M'.repeat(36864)+'Z'.repeat(32768)});
 await f.send(oversized);const q=await quotaFixture(f,1);db=q.db;
 const chunks=db.prepare('SELECT * FROM detail ORDER BY ordinal').all() as {ordinal:number;bytes:number}[];
 const H=RETENTION_V1.bucketHeadBytes,B=RETENTION_V1.bucketBytes;
 // Put the oversized head at H-1; its original part 1 remains owned by it.
 const before=chunks[63],target=chunks[64],last=chunks.at(-1)!;
 // Use the source metadata of the genuinely admitted oversized body for this
 // replica event, keeping the fixture's distinct transport/entity identities.
 const admitted=JSON.parse((db.prepare('SELECT source FROM events WHERE event_id=?').get(oversized.eventId) as {source:string}).source);
 const targetSource=JSON.parse((db.prepare('SELECT source FROM events WHERE ordinal=?').get(target.ordinal) as {source:string}).source);
 targetSource.detailBytes=admitted.detailBytes;targetSource.detailDigest=admitted.detailDigest;
 const serialized=JSON.stringify(targetSource);db.prepare('UPDATE events SET source=?,fingerprint=? WHERE ordinal=?').run(serialized,createHash('sha256').update(serialized).digest('hex'),target.ordinal);

 db.prepare('UPDATE detail SET end_byte=65535,bytes=65535,body=? WHERE ordinal=?').run('x'.repeat(65535),before.ordinal);
 db.prepare('DELETE FROM detail WHERE ordinal=?').run(target.ordinal);
 db.prepare('INSERT INTO detail VALUES (?,0,?,?,0,32768,?,32768)').run(target.ordinal,f.runId,'setup','A'.repeat(32768));
 db.prepare('INSERT INTO detail VALUES (?,1,?,?,69632,102400,?,32768)').run(target.ordinal,f.runId,'setup','Z'.repeat(32768));
 db.prepare('INSERT INTO omissions VALUES (?,?,?,?,1)').run(target.ordinal,'body_cap',32768,69632);
 db.prepare('UPDATE detail SET end_byte=65537,bytes=65537,body=? WHERE ordinal=?').run('x'.repeat(65537),last.ordinal);
 assert.equal((db.prepare('SELECT sum(bytes) AS n FROM detail').get() as {n:number}).n,B);
 const next=structuredClone(q.source);next.eventId=id();next.streamId=id();next.fact.id=id();if(next.fact.kind!=='activity')assert.fail();next.fact.detail='!';
 assert.equal((await f.send(next)).status,'applied');
 assert.equal((db.prepare('SELECT sum(bytes) AS n FROM detail').get() as {n:number}).n,B);
 const retained=db.prepare('SELECT start_byte,end_byte,body FROM detail WHERE ordinal=? ORDER BY start_byte').all(target.ordinal);
 assert.deepEqual(retained,[{start_byte:0,end_byte:1,body:'A'},{start_byte:2,end_byte:32768,body:'A'.repeat(32766)},{start_byte:69632,end_byte:102400,body:'Z'.repeat(32768)}]);
 assert.deepEqual(db.prepare('SELECT cause,start_byte,end_byte FROM omissions WHERE ordinal=? ORDER BY start_byte').all(target.ordinal),[{cause:'bucket_cap',start_byte:1,end_byte:2},{cause:'body_cap',start_byte:32768,end_byte:69632}]);
 assert.equal(H-1,63*65536+65535);f.reopen();const s=await f.store.inspect(f.runId);assert.equal(s.captureBlocked,false);assert.ok(s.records.some(r=>r.event?.eventId===next.eventId));
 const body=s.records.find(r=>r.ordinal===target.ordinal)!;assert.deepEqual(body.detail,retained.map(r=>{const c=r as {start_byte:number;end_byte:number;body:string};return {from:c.start_byte,to:c.end_byte,text:c.body};}));
 }finally{db?.close();f.cleanup();}
});

test('R3 sanitizer failure retains an independent safe capture receipt for an admitted attempt',async()=>{
 const f=await fixture();try {await f.seed();const a=f.attempt();await f.send(a);
 const filter=f.sanitizer.filter.bind(f.sanitizer);f.sanitizer.filter=()=>{throw new Error('private-R3-filter-diagnostic');};
 const e=f.make({kind:'activity',id:id(),revision:1,attemptId:a.fact.id,actionId:a.actionId,channel:'research',source:'stdout',type:'untrusted-prose',status:'untrusted-status',sourceTime:null,detail:'private-R3-output'});
 const failed=await f.send(e);assert.equal(failed.captureFailed,true);assert.equal(failed.ordinal,null);f.sanitizer.filter=filter;f.reopen();
 const s=await f.store.inspect(f.runId);assert.equal(s.records.some(r=>r.event?.eventId===e.eventId),false);
 const row=s.captureFailures.find(r=>r.reference.eventId===e.eventId)!;assert.ok(row);assert.equal(row.cause,'filter_unavailable');
 assert.equal(row.droppedBytes,null);assert.equal(row.recovery,'pending');assert.equal(s.captureBlocked,true);
 await assert.rejects(f.send(f.attempt()),{code:'capture_failed'});
 }finally{f.cleanup();}
});

test('R3 pending evaluation survives restart and completes under its original identity',async()=>{
 for(const validity of ['valid','invalid'] as const) {
  const f=await fixture();try {await f.seed();const a=f.attempt();await f.send(a);const result=f.evaluation(a);if(result.fact.kind!=='evaluation')assert.fail();
  const pending=f.make({...result.fact,validity:'pending',eligible:null,metrics:[],explanation:'Awaiting final evidence'});await f.send(pending);f.reopen();
  const final=f.make({...result.fact,id:pending.fact.id,revision:2,validity,eligible:validity==='valid'?true:null,metrics:validity==='valid'?result.fact.metrics:[{...result.fact.metrics[0],value:null,validity:'invalid',reason:'incomplete_coverage'}]},{contractVersion:{major:1,minor:1},causedBy:[pending.eventId]});
  assert.equal((await f.send(final)).status,'applied');const o=f.outcome(a.fact.id);await f.send(o);
  const d=f.make({kind:'decision',id:id(),revision:1,attemptId:a.fact.id,resultId:pending.fact.id,comparatorResultId:null,comparatorCommit:null,policyRef:id(),previousDecisionEventId:null,status:validity==='valid'?'baseline_established':'not_applicable',explanation:'Final evidence settled'},{causedBy:[o.eventId,final.eventId]});await f.send(d);f.reopen();
  for(const e of [pending,final,o,d])assert.equal((await f.send(e)).duplicate,true);
  const s=await f.store.inspect(f.runId);assert.equal(s.selectedResultId,validity==='valid'?pending.fact.id:null);assert.equal(s.projections.filter(e=>e.fact.kind==='evaluation').length,1);assert.equal(s.records.filter(r=>r.event?.fact.kind==='evaluation').length,2);
  if(final.fact.kind!=='evaluation')assert.fail();
  const contradiction=f.make({...final.fact,revision:3,explanation:'Contradictory completed result'},{contractVersion:{major:1,minor:1},causedBy:[final.eventId]});assert.equal((await f.send(contradiction)).status,'conflict');
  assert.ok((await f.store.inspect(f.runId)).records.some(r=>r.reason==='evaluation_revision_conflict'));
  }finally{f.cleanup();}
 }
});

test('R3 fixed safety receipts survive the sanitizer fence, restart and replay without admitting work or prose',async()=>{
 const f=await fixture();try {await f.seed();const a=f.attempt();await f.send(a);
 const filter=f.sanitizer.filter.bind(f.sanitizer);f.sanitizer.filter=()=>{throw new Error('private-R3-filter-diagnostic');};
 const omitted=f.make({kind:'activity',id:id(),revision:1,attemptId:a.fact.id,actionId:a.actionId,channel:'research',source:'stdout',type:'private-R3-type',status:'private-R3-status',sourceTime:null,detail:'private-R3-output'});
 const omission=await f.send(omitted);
 const stop=f.make({kind:'control',id:id(),revision:1,command:'stop',disposition:'applied',supersededBy:null,explanation:'safe_control_receipt'},{causedBy:[a.eventId]});
 const outcome=f.outcome(a.fact.id,'interrupted');if(outcome.fact.kind!=='outcome')assert.fail();outcome.fact.explanation='safe_terminal_receipt';outcome.causedBy=[a.eventId,stop.eventId];
 const receipt=(e:ResearchEvent,owner:Parameters<typeof f.store.bind>[0])=>f.store.bind(owner).receipt(e);
 const reply=await handleResearch(f.catalog,f.recording,{kind:'receipt',owner:'coordinator',event:stop});assert.equal(reply.ok,true);
 assert.equal((await receipt(outcome,'execution')).status,'applied');
 await assert.rejects(f.send(f.attempt()),{code:'capture_failed'});
 await assert.rejects(receipt(f.make({...stop.fact,command:'resume'} as Fact,{causedBy:[a.eventId]}),'coordinator'),{code:'invalid_input'});
 await assert.rejects(receipt(f.make({...outcome.fact,explanation:'private-R3-prose'}),'execution'),{code:'invalid_input'});
 await assert.rejects(receipt(outcome,'agent'),{code:'invalid_input'});
 const unknown=f.make({...outcome.fact,id:id(),attemptId:id()});await assert.rejects(receipt(unknown,'execution'),{code:'permission_denied'});
 await assert.rejects(receipt(f.attempt(),'execution'),{code:'invalid_input'});
 await assert.rejects(receipt(f.make({...omitted.fact,type:'omitted',status:'unavailable',detail:'x'.repeat(RETENTION_V1.queueBytes+1)} as Fact),'agent'),{code:'invalid_input'});
 // Reopen both the private security authority and project DB; restoring the
 // filter cannot clear its persisted new-work fence.
 f.sanitizer.filter=filter;await f.restartSecurity();f.reopen();
 for(const [e,owner] of [[stop,'coordinator'],[outcome,'execution']] as const)assert.equal((await receipt(e,owner)).duplicate,true);
 assert.equal((await f.send(omitted)).ordinal,omission.ordinal);
 await assert.rejects(f.send(f.attempt()),{code:'capture_failed'});
 assert.throws(()=>f.recording.assertCanAct(a),{code:'capture_failed'});
 const s=await f.store.inspect(f.runId);assert.equal(s.captureBlocked,true);assert.equal(s.records.filter(r=>r.event?.fact.kind==='outcome').length,1);assert.equal(s.records.filter(r=>r.event?.fact.kind==='control').length,1);
 assert.ok(s.projections.some(e=>e.fact.kind==='outcome' && e.fact.status==='interrupted' && e.fact.attemptId===a.fact.id));
 const row=s.captureFailures.find(r=>r.reference.eventId===omitted.eventId)!;assert.ok(row);assert.equal(row.cause,'filter_unavailable');assert.equal(row.droppedBytes,null);assert.equal(row.count,2);assert.equal(omission.ordinal,null);
 for(const text of [JSON.stringify(s),...readdirSync(path.join(f.project.location,'.lab')).filter(n=>n.startsWith('research.sqlite')).map(n=>readFileSync(path.join(f.project.location,'.lab',n)).toString())])for(const forbidden of ['private-R3-prose','private-R3-filter-diagnostic','private-R3-output','private-R3-type','private-R3-status'])assert.equal(text.includes(forbidden),false);
 // The security service independently validates this route as well as the store.
 await assert.rejects(f.recording.admitReceipt('execution',f.make({...outcome.fact,explanation:'untrusted'})),{code:'invalid_input'});
 }finally{f.cleanup();}
});

test('R3 essential receipts fail closed on a failed transaction, including after restart',async()=>{
 const f=await fixture();try {await f.seed();const a=f.attempt();await f.send(a);
 const file=path.join(f.project.location,'.lab','receipt-failure.sqlite');let fail=false;
 const store=new ResearchStore(file,f.project.projectId,f.recording,stage=>{if(fail && stage==='after_event')throw new Error('private-write-fault');});
 for(const e of [f.run,f.inputs,f.hardware,a])await store.bind(({run:'configuration',inputs:'preparation',hardware:'execution',attempt:'execution'} as const)[e.fact.kind as 'run'|'inputs'|'hardware'|'attempt']).ingest(e);
 const outcome=f.outcome(a.fact.id,'interrupted');if(outcome.fact.kind!=='outcome')assert.fail();outcome.fact.explanation='safe_terminal_receipt';fail=true;
 await assert.rejects(store.bind('execution').receipt(outcome),{code:'capture_failed'});store.close();
 const reopened=new ResearchStore(file,f.project.projectId,f.recording);try {
 await assert.rejects(reopened.bind('execution').receipt(outcome),{code:'capture_failed'});
 const s=await reopened.inspect(f.runId);assert.equal(s.captureBlocked,true);assert.equal(s.records.filter(r=>r.event?.fact.kind==='outcome').length,0);
 }finally{reopened.close();}
 }finally{f.cleanup();}
});

test('R3 evaluation completion rejects changed joins, missing provenance and edits to legacy final results',async()=>{
 for(const change of ['attemptId','testedCommit','checkpointId','evaluationContextRef','causation','legacy_version','already_final'] as const) {
  const f=await fixture();try {await f.seed();const a=f.attempt();await f.send(a);const initial=f.evaluation(a);if(initial.fact.kind!=='evaluation')assert.fail();
  if(change!=='already_final'){initial.fact.validity='pending';initial.fact.eligible=null;initial.fact.metrics=[];}
  await f.send(initial);f.reopen();
  const final=f.evaluation(a);if(final.fact.kind!=='evaluation')assert.fail();final.fact.id=initial.fact.id;final.fact.checkpointId=initial.fact.checkpointId;final.fact.revision=2;final.contractVersion.minor=1;final.causedBy=[initial.eventId];
  if(change==='causation')final.causedBy=[];
  else if(change==='legacy_version')final.contractVersion.minor=0;
  else if(change!=='already_final')final.fact[change]=change==='testedCommit'?'f'.repeat(40):id();
  if(change==='legacy_version')await assert.rejects(f.send(final),{code:'invalid_input'});
  else assert.equal((await f.send(final)).status,'conflict');
  const s=await f.store.inspect(f.runId);const evaluation=s.projections.find(e=>e.fact.kind==='evaluation')!;assert.equal(evaluation.fact.revision,1);assert.equal(evaluation.fact.id,initial.fact.id);
  }finally{f.cleanup();}
 }
});

test('R3 delayed pending evidence unlocks final evaluation and a consistent backup restores original sources',async()=>{
 const f=await fixture();try {await f.seed();const a=f.attempt();await f.send(a);const final=f.evaluation(a);if(final.fact.kind!=='evaluation')assert.fail();
 const pending=f.make({...final.fact,validity:'pending',eligible:null,metrics:[],explanation:'Awaiting evidence'});final.fact.id=pending.fact.id;final.fact.revision=2;final.contractVersion.minor=1;final.causedBy=[pending.eventId];
 assert.equal((await f.send(final)).status,'pending');f.reopen();
 assert.equal((await f.send(pending)).status,'applied');assert.equal((await f.store.inspect(f.runId)).projections.find(e=>e.fact.kind==='evaluation')!.fact.revision,2);
 const file=path.join(f.project.location,'.lab','research.sqlite'),backup=path.join(f.project.location,'.lab','consistent-backup.sqlite');
 const db=new Database(file);const sources=db.prepare('SELECT source FROM events ORDER BY ordinal').all();const migrations=db.prepare('SELECT * FROM schema_migrations').all();await db.backup(backup);db.close();
 f.reopen();const reopened=new Database(file);assert.deepEqual(reopened.prepare('SELECT * FROM schema_migrations').all(),migrations);assert.deepEqual(reopened.prepare('SELECT source FROM events ORDER BY ordinal').all(),sources);reopened.close();
 const restored=new ResearchStore(backup,f.project.projectId,f.recording);try {
 assert.equal((await restored.inspect(f.runId)).projections.find(e=>e.fact.kind==='evaluation')!.fact.revision,2);
 assert.equal((await restored.bind('evaluation').ingest(final)).duplicate,true);
 }finally{restored.close();}
 const restoredDb=new Database(backup);assert.deepEqual(restoredDb.prepare('SELECT source FROM events ORDER BY ordinal').all(),sources);assert.equal(restoredDb.pragma('integrity_check',{simple:true}),'ok');restoredDb.close();
 }finally{f.cleanup();}
});

test('R3 fixed receipt and ordinary admission replay one producer identity without rewriting source evidence',async()=>{
 for(const receiptFirst of [false,true]) {
 const f=await fixture();try {await f.seed();const a=f.attempt();await f.send(a);
 const stop=f.make({kind:'control',id:id(),revision:1,command:'stop',disposition:'applied',supersededBy:null,explanation:'safe_control_receipt'},{causedBy:[a.eventId]});
 const outcome=f.outcome(a.fact.id,'interrupted');if(outcome.fact.kind!=='outcome')assert.fail();outcome.fact.explanation='safe_terminal_receipt';
 const events=[[stop,'coordinator'],[outcome,'execution']] as const;
 const send=(e:ResearchEvent,owner:Parameters<typeof f.store.bind>[0],essential:boolean)=>essential?f.store.bind(owner).receipt(e):f.store.bind(owner).ingest(e);
 const ordinals=[];for(const [e,owner] of events)ordinals.push((await send(e,owner,receiptFirst)).ordinal);
 const db=new Database(path.join(f.project.location,'.lab','research.sqlite'));const sources=db.prepare('SELECT source FROM events ORDER BY ordinal').all();db.close();f.reopen();
 for(const [index,[e,owner]] of events.entries()){const replay=await send(e,owner,!receiptFirst);assert.equal(replay.duplicate,true);assert.equal(replay.ordinal,ordinals[index]);}
 const after=new Database(path.join(f.project.location,'.lab','research.sqlite'));assert.deepEqual(after.prepare('SELECT source FROM events ORDER BY ordinal').all(),sources);after.close();
 assert.equal((await f.store.inspect(f.runId)).requiresReconciliation,false);
 }finally{f.cleanup();}
 }
});

// PR115-F01: mutate matching authority in the exact gap after detail admission.
test('R4 matching registration between detail and event admission cannot reach SQL or WAL',async()=>{
 const f=await fixture();let db:Database.Database|undefined;try {
  await f.seed();const a=f.attempt();await f.send(a);
  const secret='synthetic-R4-intervening-credential';const admit=f.recording.admit.bind(f.recording);let intervened=false;
  f.recording.admit=async(meta,raw)=>{
   const record=await admit(meta,raw);
   if(typeof raw==='string' && raw.includes(secret) && !intervened){intervened=true;f.sanitizer.register(id(),secret);}
   return record;
  };
  const e=f.make({kind:'activity',id:id(),revision:1,attemptId:a.fact.id,actionId:a.actionId,channel:'research',source:'stdout',type:'output',status:'completed',sourceTime:null,detail:`before ${secret} after`});
  await f.send(e);assert.equal(intervened,true);
  // Inspect native storage before inspect()/recheck can quarantine anything.
  db=new Database(path.join(f.project.location,'.lab','research.sqlite'));
  assert.ok(!(db.prepare('SELECT body FROM detail').all() as {body:string}[]).some(r=>r.body.includes(secret)),'stale admitted detail persisted to SQLite');
  for(const name of readdirSync(path.join(f.project.location,'.lab')).filter(n=>n.startsWith('research.sqlite')))assert.ok(!readFileSync(path.join(f.project.location,'.lab',name)).includes(Buffer.from(secret)),`credential in ${name}`);
 }finally{db?.close();f.cleanup();}
});

test('R4 unhealthy activity replay preserves source ordinal and dependent projections across restart',async()=>{
 for(const restart of [false,true]){
  const f=await fixture();let db:Database.Database|undefined;try{
   await f.seed();const a=f.attempt();await f.send(a);
   const e=f.make({kind:'activity',id:id(),revision:1,attemptId:a.fact.id,actionId:a.actionId,channel:'research',source:'stdout',type:'output',status:'completed',sourceTime:null,detail:'healthy original output'});
   const first=await f.send(e);
   const dependent=f.make({kind:'sample',id:id(),revision:1,attemptId:a.fact.id,metric:metric('training'),phase:'training',step:1,sourceTime:null},{producerId:e.producerId,streamId:e.streamId,sequence:1,causedBy:[e.eventId]});
   assert.equal((await f.send(dependent)).status,'applied');if(restart)f.reopen();
   const filter=f.sanitizer.filter.bind(f.sanitizer);f.sanitizer.filter=()=>{throw new Error('private-R4-filter-failure');};
   await f.send(e);f.sanitizer.filter=filter;f.reopen();
   db=new Database(path.join(f.project.location,'.lab','research.sqlite'));
   const rows=db.prepare('SELECT ordinal,status,reason FROM events WHERE event_id=?').all(e.eventId);
   assert.deepEqual(rows,[{ordinal:first.ordinal,status:'applied',reason:null}],'collector failure created conflicting producer evidence');
   assert.equal((db.prepare('SELECT status FROM events WHERE event_id=?').get(dependent.eventId) as {status:string}).status,'applied');
   const s=await f.store.inspect(f.runId);assert.equal(s.records.filter(r=>r.event?.eventId===e.eventId).length,1);
   assert.ok(s.projections.some(p=>p.eventId===dependent.eventId));assert.equal(s.captureBlocked,true);
   const failure=s.captureFailures.find(r=>r.reference.eventId===e.eventId)!;assert.ok(failure);assert.equal(failure.recovery,'pending');assert.equal(failure.droppedBytes,null);
   await f.restartSecurity();f.reopen();assert.equal((await f.store.inspect(f.runId)).captureFailures.length,1);
   // Boundary recovery enables a genuine replay; its successful admission, not
   // restoring the filter alone, reconciles the independent collection receipt.
   const state=await f.recording.incident({...e},{recordIds:[],sessionIds:[],reach:'prevented',destinations:['application'],reason:'unsafe_capture'});
   await f.recording.recover(state.incidentId,{replacementVerified:true,boundaryVerified:true,effectsReconciled:true,containmentComplete:true,explicitResume:true,freshSessionId:id()});
   f.store.recoverCapture(f.runId,{id:id(),evidenceId:id(),effectsReconciled:true,boundaryVerified:true,explicitResume:true});
   assert.equal((await f.send(e)).ordinal,first.ordinal);
   const recovered=await f.store.inspect(f.runId);assert.equal(recovered.captureFailures[0].recovery,'recovered');assert.ok(recovered.projections.some(p=>p.eventId===dependent.eventId));
   const changed=structuredClone(e);if(changed.fact.kind!=='activity')assert.fail();changed.fact.detail='genuinely different producer output';
   assert.equal((await f.send(changed)).status,'conflict');
  }finally{db?.close();f.cleanup();}
 }
});

test('R4 research v1 upgrades with a consistent backup and rejects future schemas without reset',async()=>{
 const f=await fixture();let db:Database.Database|undefined;try{
  await f.seed();const file=path.join(f.project.location,'.lab','legacy-research.sqlite');
  const initial=new ResearchStore(file,f.project.projectId,f.recording);await initial.bind('configuration').ingest(f.run);initial.close();
  // Reconstruct the exact previous schema in a controlled store: v1 SQL/checksum
  // and source rows stay unchanged, with only the appended migration removed.
  db=new Database(file);db.exec('DROP TABLE capture_failures; DELETE FROM schema_migrations WHERE version=2; PRAGMA user_version=1');db.close();db=undefined;
  const upgraded=new ResearchStore(file,f.project.projectId,f.recording);
  assert.equal((await upgraded.inspect(f.runId)).records.length,1);upgraded.close();
  const backups=readdirSync(path.dirname(file)).filter(n=>n.startsWith('legacy-research.sqlite.before-v2-'));assert.equal(backups.length,1);
  db=new Database(path.join(path.dirname(file),backups[0]));assert.equal(db.pragma('user_version',{simple:true}),1);assert.equal((db.prepare('SELECT count(*) AS n FROM events').get() as {n:number}).n,1);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
  db=new Database(file);assert.equal(db.pragma('user_version',{simple:true}),2);db.prepare('INSERT INTO schema_migrations VALUES (3,?)').run('future-schema');db.pragma('user_version=3');db.close();db=undefined;
  assert.throws(()=>new ResearchStore(file,f.project.projectId,f.recording),/Unsupported database schema/);
  db=new Database(file);assert.equal(db.pragma('user_version',{simple:true}),3);assert.equal((db.prepare('SELECT count(*) AS n FROM events').get() as {n:number}).n,1);
 }finally{db?.close();f.cleanup();}
});

test('R4 local authority covers every SQLite checkpoint and releases after transaction rollback',async()=>{
 const f=await fixture();try{
  const stages:Checkpoint[]=[];const file=path.join(f.project.location,'.lab','owned-write.sqlite');let fail=false;
  const store=new ResearchStore(file,f.project.projectId,f.recording,stage=>{
   stages.push(stage);assert.throws(()=>f.sanitizer.register(id(),'synthetic-local-commit-boundary'),{reason:'filter_unavailable'});
   if(fail && stage==='after_event')throw new Error('private-rollback-fixture');
  });
  try{
   assert.equal((await store.bind('configuration').ingest(f.run)).status,'applied');
   assert.deepEqual(stages,['before_event','after_event','after_projection','after_cursor','after_commit']);
   f.sanitizer.register(id(),'synthetic-after-success');fail=true;
   await assert.rejects(store.bind('preparation').ingest(f.inputs),{code:'capture_failed'});
   f.sanitizer.register(id(),'synthetic-after-rollback');
   const db=new Database(file);try{assert.equal((db.prepare('SELECT count(*) AS n FROM events').get() as {n:number}).n,1);}finally{db.close();}
  }finally{store.close();}
 }finally{f.cleanup();}
});
