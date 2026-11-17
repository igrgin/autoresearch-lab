import type Database from 'better-sqlite3';
import { chmodSync, closeSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openStore } from '../catalog/storage';
import { assertId, POLICY_REVISION, SecurityError } from '../security/common';
import type { SafeValue } from '../security/sanitizer';
import type { SafeRecord, MemoryAdmission } from '../security/recording';
import type { ResearchAdmission } from './security-port';
import { CAPTURE_PATHS, type CapturePath } from '../security/recording';
import { validateReceipt } from './receipts';
import { RETENTION_V1, type Fact, type Owner, type ResearchEvent, OWNERS, validateEvent } from './contracts';

const sql = `
CREATE TABLE binding (project_id TEXT PRIMARY KEY);
CREATE TABLE events (
 ordinal INTEGER PRIMARY KEY, event_id TEXT NOT NULL, run_id TEXT NOT NULL,
 producer_id TEXT NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL,
 fingerprint TEXT NOT NULL UNIQUE, source TEXT NOT NULL, received_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', reason TEXT
);
CREATE INDEX events_identity ON events(event_id);
CREATE INDEX events_stream ON events(producer_id,stream_id,sequence);
CREATE TABLE projections (kind TEXT NOT NULL, id TEXT NOT NULL, run_id TEXT NOT NULL, revision INTEGER NOT NULL,
 event_id TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY(kind,id));
CREATE TABLE cursors (producer_id TEXT NOT NULL, stream_id TEXT NOT NULL, sequence INTEGER NOT NULL, PRIMARY KEY(producer_id,stream_id));
CREATE TABLE detail (ordinal INTEGER NOT NULL, part INTEGER NOT NULL, run_id TEXT NOT NULL, bucket TEXT NOT NULL,
 start_byte INTEGER NOT NULL, end_byte INTEGER NOT NULL, body TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(ordinal,part));
CREATE TABLE omissions (ordinal INTEGER NOT NULL, cause TEXT NOT NULL, start_byte INTEGER NOT NULL, end_byte INTEGER NOT NULL,
 policy_version INTEGER NOT NULL, PRIMARY KEY(ordinal,cause,start_byte,end_byte));
CREATE TABLE detail_retrievals (ordinal INTEGER NOT NULL, digest TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(ordinal,digest));
CREATE TABLE policies (run_id TEXT PRIMARY KEY, policy TEXT NOT NULL);
CREATE TABLE faults (run_id TEXT PRIMARY KEY, reason TEXT NOT NULL);
CREATE TABLE capture_recoveries (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, evidence_id TEXT NOT NULL, recovered_at TEXT NOT NULL);
`;
// Append-only migration: replica capture receipts never occupy a producer's
// event identity or advance its source cursor. Existing source bytes stay intact.
const captureFailuresSql = `
CREATE TABLE capture_failures (
 reference TEXT PRIMARY KEY, run_id TEXT NOT NULL, event_id TEXT NOT NULL,
 first_at TEXT NOT NULL, last_at TEXT NOT NULL, failures INTEGER NOT NULL,
 recovered_ordinal INTEGER
);
`;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a<b?-1:a>b?1:0).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
interface Stored { ordinal: number; event_id: string; run_id: string; producer_id: string; stream_id: string; sequence: number;
 fingerprint: string; source: string; received_at: string; status: string; reason: string | null }
interface Source { event: ResearchEvent; admission: SafeRecord; owner: Owner; detailDigest: string | null; detailBytes: number | null; detailOmission: string | null }
export type Checkpoint = 'before_event' | 'after_event' | 'after_projection' | 'after_cursor' | 'after_commit';
export interface IngestionReceipt { ordinal: number | null; duplicate: boolean; captureFailed?: boolean; status: string; reason: string | null; cursor: number }

// Only the coordinator owns instances. Logical owners receive an in-process port;
// neither the renderer nor an adapter gets SQL, paths, or an arbitrary owner field.
export class ResearchStore {
  private readonly db: Database.Database;
  // Capture-policy faults fence new work per run; a storage fault fences every write.
  private storageFailed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly queuedDetail = new Map<string,number>();
  constructor(filename: string, readonly projectId: string, private readonly recording: ResearchAdmission,
    private readonly checkpoint: (stage: Checkpoint) => void = () => {}) {
    assertId(projectId);
    const directory = lstatSync(path.dirname(filename));
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.()) throw new SecurityError('capture_failed');
    chmodSync(path.dirname(filename),0o700);
    const marker=`${filename}.identity.json`;
    const expected=JSON.stringify({schemaVersion:1,projectId});
    let bound=false;
    try {
      const info=lstatSync(marker);
      if(!info.isFile() || info.isSymbolicLink() || info.uid!==process.getuid?.() || readFileSync(marker,'utf8')!==expected) throw new SecurityError('conflict');
      bound=true;
    } catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}

    for (const name of [filename,`${filename}-wal`,`${filename}-shm`,`${filename}-journal`]) {
      try {
        const info = lstatSync(name);
        if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.()) throw new SecurityError('capture_failed');
        if(name===filename && bound && info.size===0)throw new SecurityError('capture_failed');
        chmodSync(name,0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (name===filename && bound) throw new SecurityError('capture_failed'); // openStore privately creates a genuinely new file.
      }
    }
    this.db = openStore(filename, sql, [captureFailuresSql]);
    try {
      const binding = this.db.prepare('SELECT project_id FROM binding').get() as { project_id: string } | undefined;
      if (binding && binding.project_id !== projectId) throw new SecurityError('conflict');
      if (!binding) this.db.prepare('INSERT INTO binding VALUES (?)').run(projectId);
      if(!bound){const fd=openSync(marker,'wx',0o600);try{writeFileSync(fd,expected);fsyncSync(fd);}finally{closeSync(fd);}}
      const fd=openSync(path.dirname(filename),'r');try{fsyncSync(fd);}finally{closeSync(fd);}
    } catch (error) { this.db.close(); throw error; }
  }
  close(): void { this.db.close(); }
  recoverCapture(runId: string, proof: { id: string; evidenceId: string; effectsReconciled: boolean; boundaryVerified: boolean; explicitResume: boolean }): void {
    assertId(runId); assertId(proof.id); assertId(proof.evidenceId);
    if (!proof.effectsReconciled || !proof.boundaryVerified || !proof.explicitResume) throw new SecurityError('permission_denied');
    try {
      this.db.transaction(() => {
        this.db.prepare('INSERT OR IGNORE INTO capture_recoveries VALUES (?,?,?,?)').run(proof.id,runId,proof.evidenceId,new Date().toISOString());
        this.db.prepare('DELETE FROM faults WHERE run_id=?').run(runId);
      })();
      this.storageFailed=false;
    } catch { this.storageFailed=true; throw new SecurityError('capture_failed'); }
  }
  bind(owner: Owner) { return { ingest: (event: ResearchEvent) => this.ingest(owner, event),
    receipt: (event: ResearchEvent) => this.ingest(owner,event,true) }; }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(work); this.tail = pending.catch(() => undefined); return pending;
  }
  private async ingest(owner: Owner, input: ResearchEvent, essential = false): Promise<IngestionReceipt> {
    // Validate the raw receipt before queue omission can remove an invalid body.
    if (essential) validateReceipt(input,owner);
    // Clone immediately; an async caller cannot change pinned facts during admission.
    const rawBytes = input.fact.kind === 'activity' && typeof input.fact.detail === 'string' ? Buffer.byteLength(input.fact.detail) : 0;
    const queued = this.queuedDetail.get(input.runId) ?? 0;
    const overflow = rawBytes + queued > RETENTION_V1.queueBytes;
    const event = structuredClone(overflow && input.fact.kind === 'activity' ? { ...input, fact: { ...input.fact, detail: null } } : input);
    if (!Object.hasOwn(OWNERS,event.fact.kind)) { const original=event.fact; event.fact={kind:'unsupported',id:event.eventId,revision:1,schemaVersion:1,originalKind:String(original.kind),payload:original as unknown as SafeValue}; }
    const heldBytes = overflow ? 0 : rawBytes;
    this.queuedDetail.set(event.runId,queued+heldBytes);
    return this.serial(() => this.recording.withMatchingPolicy(async recording => {
      if (this.storageFailed) throw new SecurityError('capture_failed');
      validateEvent(event, owner);
      if (event.projectId !== this.projectId) throw new SecurityError('permission_denied');
      if (['attempt','candidate','action'].includes(event.fact.kind) && this.db.prepare('SELECT 1 FROM faults WHERE run_id=?').get(event.runId)) throw new SecurityError('capture_failed');
      if (essential) this.assertReceipt(owner,event);
      const fact = event.fact;
      if (essential && fact.kind==='activity') return this.captureFailure(owner,event,recording);
      const meta = { projectId: event.projectId, runId: event.runId, actionId: event.actionId, operationId: event.operationId,
        eventId: event.eventId, producerId: event.producerId, streamId: event.streamId, sequence: event.sequence,
        kind: 'execution_outcome' as const, source: 'log' as const, status: 'completed' as const };
      // Metadata and semantic identity must survive admission unchanged. Free text
      // can be redacted; a redacted required ref is never silently substituted.
      let detail: string | null = null;
      let detailOmitted = false;
      let detailCoverage: SafeRecord['coverage'] = 'complete';
      let detailOmission: string | null = overflow?'queue_overflow':null;
      if (fact.kind === 'activity' && !essential) {
        const source=fact.source as CapturePath;
        if (![...CAPTURE_PATHS,'auth','headers','credential_file','environment','raw_provider','raw_sdk','native_history'].includes(source)) throw new SecurityError('invalid_input');
        let admitted: SafeRecord;
        try { admitted = await this.admit(recording, { ...meta, source, kind: fact.channel === 'assessment' ? 'test_assessment' : 'activity' }, fact.detail); }
        catch { if(this.storageFailed) throw new SecurityError('capture_failed'); admitted={contractVersion:{major:1,minor:0},policyRevision:POLICY_REVISION,envelope:meta,body:null,coverage:'omitted',omission:'filter_unavailable'}; }
        if (admitted.omission==='filter_unavailable') {
          return this.captureFailure(owner,event,recording);
        }
        detail = typeof admitted.body === 'string' ? admitted.body : null;
        detailOmitted = admitted.coverage === 'omitted'; detailCoverage=admitted.coverage;detailOmission=admitted.omission??detailOmission;
        fact.detail = null;
      }
      const admission = essential ? await recording.admitReceipt(owner,event) : await this.admit(recording, meta, event);
      if (admission.coverage === 'omitted') { this.captureFault(event.runId,'unsafe_essential_record'); throw new SecurityError('capture_failed'); }
      const safeEvent = admission.body as unknown as ResearchEvent;
      validateEvent(safeEvent, owner);
      if (canonical({ ...safeEvent, fact: undefined }) !== canonical({ ...event, fact: undefined })) throw new SecurityError('capture_failed');
      // These fields carry immutable identity, rather than displayable prose.
      const identity = (f: Fact) => Object.fromEntries(Object.entries(f).filter(([k]) =>
        k==='gpuIds' || k.endsWith('Id') || k.endsWith('Ref') || k.endsWith('Commit') || ['id','kind','revision','digest','treeDigest'].includes(k)));
      if ((safeEvent.fact.kind==='evaluation' || safeEvent.fact.kind==='assessment') && (fact.kind==='evaluation' || fact.kind==='assessment') && canonical(safeEvent.fact.metrics.map(m=>({...m,reason:null})))!==canonical(fact.metrics.map(m=>({...m,reason:null})))) throw new SecurityError('capture_failed');
      if (canonical(identity(safeEvent.fact)) !== canonical(identity(fact))) throw new SecurityError('capture_failed');
      const source: Source = { event: safeEvent, admission: { ...admission, coverage:detailCoverage==='redacted'?'redacted':admission.coverage, body: null }, owner,
        detailOmission, detailDigest: detail === null ? null : createHash('sha256').update(detail).digest('hex'), detailBytes: detail === null ? null : Buffer.byteLength(detail) };
      const sourceJson = canonical(source);
      const fingerprint = createHash('sha256').update(sourceJson).digest('hex');
      try {
        const receipt = this.db.transaction(() => {
          const ingestSource = () => {
            const existing = this.db.prepare('SELECT * FROM events WHERE fingerprint=?').get(fingerprint) as Stored | undefined;
            if (existing) return this.receipt(existing.ordinal, true);
            // Admission metadata describes this replica's capture path, not a new
            // producer fact. Switching to/from the fixed receipt route on replay
            // must retain the original source record and ingestion ordinal.
            if (fact.kind!=='activity') {
              const captured=this.db.prepare('SELECT * FROM events WHERE event_id=?').all(event.eventId) as Stored[];
              if (captured.length===1 && canonical((JSON.parse(captured[0].source) as Source).event)===canonical(safeEvent)) return this.receipt(captured[0].ordinal,true);
            }
            const retrieved=this.db.prepare('SELECT e.ordinal FROM detail_retrievals d JOIN events e ON e.ordinal=d.ordinal WHERE e.event_id=? AND d.digest=?').get(event.eventId,source.detailDigest) as {ordinal:number}|undefined;
            if(retrieved) { const previous=this.db.prepare('SELECT source FROM events WHERE ordinal=?').get(retrieved.ordinal) as {source:string}; if(canonical((JSON.parse(previous.source) as Source).event)===canonical(safeEvent)) return this.receipt(retrieved.ordinal,true); }
            if (fact.kind === 'activity') {
              const captured = this.db.prepare('SELECT * FROM events WHERE event_id=?').all(event.eventId) as Stored[];
              const earlier = captured.length===1 ? JSON.parse(captured[0].source) as Source : undefined;
              // Detail availability is local collection state, not a new producer
              // fact. Queue pressure may omit an unchanged replay after the first
              // copy was captured. Keep its original ordinal and admitted detail.
              if (earlier && canonical(earlier.event)===canonical(safeEvent) &&
                  (source.detailDigest===null || source.detailDigest===earlier.detailDigest)) {
                return this.receipt(captured[0].ordinal,true);
              }
              if (earlier && earlier.detailDigest===null && canonical(earlier.event)===canonical(safeEvent) && detail!==null && !this.db.prepare('SELECT 1 FROM detail_retrievals WHERE ordinal=?').get(captured[0].ordinal)) {
                this.db.prepare('INSERT OR IGNORE INTO detail_retrievals VALUES (?,?,?)').run(captured[0].ordinal,source.detailDigest,new Date().toISOString());
                this.retain(captured[0].ordinal,event.runId,fact.attemptId??'setup',detail);
                return this.receipt(captured[0].ordinal,true);
              }
            }
            this.checkpoint('before_event');
            const ordinal = Number(this.db.prepare('INSERT INTO events(event_id,run_id,producer_id,stream_id,sequence,fingerprint,source,received_at) VALUES (?,?,?,?,?,?,?,?)')
              .run(event.eventId,event.runId,event.producerId,event.streamId,event.sequence,fingerprint,sourceJson,new Date().toISOString()).lastInsertRowid);
            if (fact.kind === 'run') this.db.prepare('INSERT OR IGNORE INTO policies VALUES (?,?)').run(event.runId,canonical(RETENTION_V1));
            if (fact.kind === 'activity') {
              if (detailOmitted) this.omit(ordinal,'redaction_omission',0,0);
              if (overflow) this.omit(ordinal,'queue_overflow',0,rawBytes);
              if (detail !== null) this.retain(ordinal,event.runId,fact.attemptId ?? 'setup',detail);
            }
            this.checkpoint('after_event');
            this.rebuild(); this.checkpoint('after_projection');
            this.cursors(); this.checkpoint('after_cursor');
            return this.receipt(ordinal,false);
          };
          const result=ingestSource();
          if (result.status==='applied') this.db.prepare('UPDATE capture_failures SET recovered_ordinal=? WHERE run_id=? AND event_id=?').run(result.ordinal,event.runId,event.eventId);
          return result;
        })();
        this.checkpoint('after_commit');
        return receipt;
      } catch {
        // Never forward a SQLite/vendor error that might contain source text.
        this.storageFailed = true;
        try { this.db.prepare('INSERT OR REPLACE INTO faults VALUES (?,?)').run(event.runId,'required_capture_failed_unknown_range'); } catch { /* The current fault remains exposed in memory. */ }
        throw new SecurityError('capture_failed','unknown');
      }
    })).finally(() => this.queuedDetail.set(event.runId,Math.max(0,(this.queuedDetail.get(event.runId)??heldBytes)-heldBytes)));
  }
  private async admit(recording: MemoryAdmission, meta: SafeRecord['envelope'], raw: unknown): Promise<SafeRecord> {
    try { return await recording.admit(meta,raw); }
    catch { this.captureFault(meta.runId,'safe_admission_unavailable'); throw new SecurityError('capture_failed'); }
  }
  private async captureFailure(owner: Owner, event: ResearchEvent, recording: MemoryAdmission): Promise<IngestionReceipt> {
    if (event.fact.kind!=='activity') throw new SecurityError('invalid_input');
    // Validate only fixed fields, even when the full sanitizer is broken/fenced.
    // The omission describes this replica, never a replacement producer fact.
    const receipt={...event,fact:{...event.fact,type:'omitted',status:'unavailable',sourceTime:null,detail:null}};
    this.assertReceipt(owner,receipt);
    const admitted=await recording.admitReceipt(owner,receipt);
    if (admitted.coverage==='omitted' || canonical(admitted.body)!==canonical(receipt)) throw new SecurityError('capture_failed');
    const f=receipt.fact;
    const reference=canonical({eventId:event.eventId,producerId:event.producerId,streamId:event.streamId,sequence:event.sequence,
      projectId:event.projectId,runId:event.runId,operationId:event.operationId,actionId:event.actionId,
      activityId:f.id,attemptId:f.attemptId,channel:f.channel,source:f.source});
    try {
      return this.db.transaction(() => {
        this.captureFault(event.runId,'safe_admission_unavailable');
        const now=new Date().toISOString();
        this.db.prepare(`INSERT INTO capture_failures VALUES (?,?,?,?,?,1,NULL)
          ON CONFLICT(reference) DO UPDATE SET last_at=excluded.last_at,failures=failures+1,recovered_ordinal=NULL`)
          .run(reference,event.runId,event.eventId,now,now);
        const rows=this.db.prepare('SELECT * FROM events WHERE event_id=?').all(event.eventId) as Stored[];
        // Return the original position as a reference, without asserting that
        // unadmitted replay bytes are equivalent or changing any projection.
        if (rows.length===1) return {...this.receipt(rows[0].ordinal,false),captureFailed:true,status:'pending',reason:'capture_unavailable'};
        const cursor=this.db.prepare('SELECT sequence FROM cursors WHERE producer_id=? AND stream_id=?').get(event.producerId,event.streamId) as {sequence:number}|undefined;
        return {ordinal:null,duplicate:false,captureFailed:true,status:'pending',reason:'capture_unavailable',cursor:cursor?.sequence??-1};
      })();
    } catch { this.storageFailed=true; throw new SecurityError('capture_failed','unknown'); }
  }
  private captureFault(runId: string, reason: string): void {
    try { this.db.prepare('INSERT OR IGNORE INTO faults VALUES (?,?)').run(runId,reason); }
    catch { this.storageFailed=true; throw new SecurityError('capture_failed'); }
  }
  private assertReceipt(owner: Owner, event: ResearchEvent): void {
    validateReceipt(event,owner);
    const fault=this.db.prepare('SELECT reason FROM faults WHERE run_id=?').get(event.runId) as {reason:string}|undefined;
    if (fault?.reason==='required_capture_failed_unknown_range') throw new SecurityError('capture_failed');
    const admitted=this.db.prepare("SELECT source FROM projections WHERE run_id=? AND kind IN ('attempt','action')").all(event.runId) as {source:string}[];
    const f=event.fact;
    const known=admitted.some(row=>{
      const e=JSON.parse(row.source) as ResearchEvent;
      if (f.kind==='outcome') return e.fact.kind==='attempt' && e.fact.id===f.attemptId;
      if (f.kind==='activity') return f.attemptId ? e.fact.kind==='attempt' && e.fact.id===f.attemptId : e.fact.kind==='action' && e.fact.id===f.actionId;
      return event.causedBy.includes(e.eventId);
    });
    if (!known) throw new SecurityError('permission_denied');
  }
  private receipt(ordinal: number, duplicate: boolean): IngestionReceipt {
    const row = this.db.prepare('SELECT * FROM events WHERE ordinal=?').get(ordinal) as Stored;
    const cursor = this.db.prepare('SELECT sequence FROM cursors WHERE producer_id=? AND stream_id=?').get(row.producer_id,row.stream_id) as { sequence: number } | undefined;
    return { ordinal, duplicate, status: row.status, reason: row.reason, cursor: cursor?.sequence ?? -1 };
  }
  private rows(): Stored[] { return this.db.prepare('SELECT * FROM events ORDER BY ordinal').all() as Stored[]; }
  private cursors() {
    this.db.exec('DELETE FROM cursors');
    const streams = new Map<string, Stored[]>();
    for (const row of this.rows()) {
      const key = `${row.producer_id}/${row.stream_id}`; const rows = streams.get(key) ?? []; rows.push(row); streams.set(key, rows);
    }
    for (const rows of streams.values()) {
      let cursor = -1;
      for (const sequence of [...new Set(rows.map(r => r.sequence))].sort((a,b) => a-b)) {
        if (sequence !== cursor+1 || rows.filter(r => r.sequence === sequence).length !== 1) break;
        cursor = sequence;
      }
      this.db.prepare('INSERT INTO cursors VALUES (?,?,?)').run(rows[0].producer_id,rows[0].stream_id,cursor);
    }
  }
  private rebuild() {
    this.db.exec('DELETE FROM projections');
    const rows = this.rows();
    const parsed = new Map(rows.map(r => [r.ordinal, JSON.parse(r.source) as Source]));
    const reasons = new Map<number,string>();
    const applied = new Set<number>();
    const byEvent=new Map<string,Stored[]>(), byPosition=new Map<string,Stored[]>(), byEntity=new Map<string,Stored[]>();
    const byLogical=new Map<string,Stored[]>(), byOutcome=new Map<string,Stored[]>(), bySelection=new Map<string,Stored[]>(), byRun=new Map<string,Stored[]>();
    const add=(index:Map<string,Stored[]>,key:string,row:Stored)=>{const group=index.get(key)??[];group.push(row);index.set(key,group);};
    const position=(r:Stored,sequence=r.sequence)=>`${r.producer_id}/${r.stream_id}/${sequence}`;
    for(const row of rows) {
      const source=parsed.get(row.ordinal)!;const f=source.event.fact;
      if(f.kind==='unsupported')reasons.set(row.ordinal,'unsupported_critical_kind');
      if(source.event.contractVersion.major!==1)reasons.set(row.ordinal,'incompatible_version');
      add(byEvent,row.event_id,row);add(byPosition,position(row),row);add(byEntity,`${f.kind}/${f.id}`,row);
      if(f.kind==='run')add(byRun,row.run_id,row);
      if(['run','run_state','counters'].includes(f.kind))add(byLogical,`${row.run_id}/${f.kind}`,row);
      if((f.kind==='decision'||f.kind==='evaluation'))add(byLogical,`${row.run_id}/${f.kind}/${f.attemptId}`,row);
      if(f.kind==='outcome')add(byOutcome,`${row.run_id}/${f.attemptId}`,row);
      if(f.kind==='decision' && ['kept','baseline_established'].includes(f.status))add(bySelection,`${row.run_id}/${f.comparatorResultId}`,row);
    }
    const mark=(group:Stored[],reason:string)=>{for(const row of group)reasons.set(row.ordinal,reason);};
    for(const group of byEntity.values()) {
      const revisions=new Map<number,Set<string>>();
      for(const row of group){const f=parsed.get(row.ordinal)!.event.fact;const values=revisions.get(f.revision)??new Set<string>();values.add(canonical(f));revisions.set(f.revision,values);}
      if(new Set(group.map(r=>r.run_id)).size>1 || [...revisions.values()].some(v=>v.size>1))mark(group,'record_identity_conflict');
    }
    // Completion extends pending evidence only. Validate against source history,
    // independent of receipt order, so late/replayed revisions cannot unfreeze it.
    for (const group of byEntity.values()) for (const row of group) {
      const e=parsed.get(row.ordinal)!.event, f=e.fact;
      if (f.kind!=='evaluation' || f.revision===1) continue;
      const previous=group.filter(r=>parsed.get(r.ordinal)!.event.fact.revision===f.revision-1);
      const p=previous.length ? parsed.get(previous[0].ordinal)!.event.fact : undefined;
      if (!p) continue; // A missing earlier revision remains a causal gap.
      if (p.kind!=='evaluation' || p.validity!=='pending' || f.validity==='pending' ||
          ['attemptId','testedCommit','checkpointId','evaluationContextRef'].some(k=>p[k as 'attemptId']!==f[k as 'attemptId']) ||
          !previous.some(r=>e.causedBy.includes(r.event_id)) ||
          (f.validity==='invalid' && f.eligible!==null)) reasons.set(row.ordinal,'evaluation_revision_conflict');
    }
    for(const group of byLogical.values())if(new Set(group.map(r=>parsed.get(r.ordinal)!.event.fact.id)).size>1)mark(group,'logical_identity_conflict');
    for(const group of byOutcome.values())if(new Set(group.map(r=>canonical(parsed.get(r.ordinal)!.event.fact))).size>1)mark(group,'outcome_conflict');
    for(const group of bySelection.values())if(new Set(group.map(r=>parsed.get(r.ordinal)!.event.fact.id)).size>1)mark(group,'selection_fork');
    for(const group of [...byEvent.values(),...byPosition.values()])if(group.length>1)mark(group,'event_identity_conflict');
    const projected=new Map<string,ResearchEvent>();
    const find=(kind:Fact['kind'],id:string|null,run:string)=>{const event=projected.get(`${kind}/${id}`);return event?.runId===run?event.fact:undefined;};
    const selected = new Map<string,string>();
    let progress = true;
    while (progress) {
      progress = false;
      for (const row of rows) {
        if (applied.has(row.ordinal) || reasons.has(row.ordinal)) continue;
        const e = parsed.get(row.ordinal)!.event; const f = e.fact;
        const prerequisite = byPosition.get(position(row,row.sequence-1))?.[0];
        if ((row.sequence > 0 && (!prerequisite || !applied.has(prerequisite.ordinal))) || e.causedBy.some(id => !byEvent.get(id)?.some(r=>applied.has(r.ordinal)))) continue;
        const run = byRun.get(row.run_id)?.find(r=>applied.has(r.ordinal));
        if (f.kind !== 'run' && !run) continue;
        const runFact = run ? parsed.get(run.ordinal)!.event.fact as Extract<Fact,{kind:'run'}> : undefined;
        const prior = find(f.kind,f.id,row.run_id);
        if ((prior && prior.revision === f.revision && canonical(prior) === canonical(f))) { applied.add(row.ordinal); progress=true; continue; }
        if (prior && prior.revision>f.revision) { applied.add(row.ordinal); progress=true; continue; }
        if (f.revision > 1 && (!prior || prior.revision !== f.revision-1)) continue;
        if (prior && f.kind==='artifact' && prior.kind==='artifact' && (prior.attemptId!==f.attemptId || prior.checkpointId!==f.checkpointId)) { reasons.set(row.ordinal,'artifact_identity_conflict'); continue; }
        if (prior && f.kind==='control' && prior.kind==='control' && prior.command!==f.command) { reasons.set(row.ordinal,'control_identity_conflict'); continue; }
        const attempt = 'attemptId' in f && f.attemptId ? find('attempt',f.attemptId,row.run_id) as Extract<Fact,{kind:'attempt'}> | undefined : undefined;
        if ('attemptId' in f && f.attemptId && !attempt) continue;
        if (f.kind === 'run' && f.id !== e.runId) { reasons.set(row.ordinal,'run_identity_mismatch'); continue; }
        if (f.kind === 'inputs' && (f.snapshotId !== runFact!.snapshotId || ['dataRef','splitsRef','initializationRef','evaluationContextRef','environmentRef'].some(k => f[k as 'dataRef'] !== runFact!.settings[k as 'dataRef']))) { reasons.set(row.ordinal,'input_identity_mismatch'); continue; }
        if (f.kind === 'candidate' && !find('evaluation',f.comparatorResultId,row.run_id)) continue;
        if (f.kind === 'attempt') {
          const input = find('inputs',f.manifestId,row.run_id) as Extract<Fact,{kind:'inputs'}> | undefined;
          const hardware = find('hardware',f.hardwareId,row.run_id) as Extract<Fact,{kind:'hardware'}> | undefined;
          const candidate = f.candidateId ? find('candidate',f.candidateId,row.run_id) as Extract<Fact,{kind:'candidate'}> | undefined : null;
          if (!input || !hardware || (f.candidateId && !candidate)) continue;
          if (f.snapshotId !== runFact!.snapshotId || input.snapshotId !== f.snapshotId || hardware.reservationId !== f.reservationId ||
            (candidate && candidate.testedCommit !== f.testedCommit) || (!candidate && f.testedCommit !== runFact!.settings.codeSourceCommit)) { reasons.set(row.ordinal,'attempt_identity_mismatch'); continue; }
        }
        if (f.kind === 'evaluation' && (f.testedCommit !== attempt!.testedCommit || f.evaluationContextRef !== runFact!.settings.evaluationContextRef)) { reasons.set(row.ordinal,'result_identity_mismatch'); continue; }
        if (f.kind === 'assessment') {
          const result = find('evaluation',f.evaluationId,row.run_id) as Extract<Fact,{kind:'evaluation'}> | undefined;
          if (!result) continue;
          if (result.attemptId !== f.attemptId || result.checkpointId !== f.checkpointId) { reasons.set(row.ordinal,'assessment_identity_mismatch'); continue; }
        }
        if (f.kind === 'decision') {
          if (prior) {
            const previous = f.previousDecisionEventId?byEvent.get(f.previousDecisionEventId)?.find(r=>applied.has(r.ordinal)):undefined;
            const p = prior as Extract<Fact,{kind:'decision'}>;
            if (!previous || parsed.get(previous.ordinal)!.event.fact.kind!=='decision' || parsed.get(previous.ordinal)!.event.fact.revision!==f.revision-1 || parsed.get(previous.ordinal)!.event.fact.id !== f.id || p.status !== 'pending' ||
              p.attemptId !== f.attemptId || p.comparatorResultId !== f.comparatorResultId || p.comparatorCommit !== f.comparatorCommit ||
              (p.resultId !== null && p.resultId !== f.resultId) || p.policyRef !== f.policyRef) { reasons.set(row.ordinal,'decision_revision_conflict'); continue; }
          } else if (f.previousDecisionEventId !== null) continue;
          if (['kept','discarded','baseline_established'].includes(f.status)) {
            const result = find('evaluation',f.resultId,row.run_id) as Extract<Fact,{kind:'evaluation'}> | undefined;
            const outcomes = (byOutcome.get(`${row.run_id}/${f.attemptId}`)??[]).filter(r=>applied.has(r.ordinal));
            if (!result || !outcomes.length) continue;
            if (result.attemptId !== f.attemptId || result.validity !== 'valid' ||
              (parsed.get(outcomes[0].ordinal)!.event.fact as Extract<Fact,{kind:'outcome'}>).status !== 'completed' ||
              (f.status !== 'discarded' && result.eligible !== true)) { reasons.set(row.ordinal,'decision_evidence_conflict'); continue; }
            const candidate = attempt!.candidateId ? find('candidate',attempt!.candidateId,row.run_id) as Extract<Fact,{kind:'candidate'}> : null;
            if (candidate) {
              const comparator = find('evaluation',f.comparatorResultId,row.run_id) as Extract<Fact,{kind:'evaluation'}> | undefined;
              if (!comparator) continue;
              if (f.status === 'baseline_established' || candidate.comparatorResultId !== f.comparatorResultId ||
                comparator.testedCommit !== f.comparatorCommit || candidate.acceptedBaseCommit !== f.comparatorCommit) { reasons.set(row.ordinal,'comparator_conflict'); continue; }
              if (selected.get(row.run_id) !== f.comparatorResultId) continue;
            } else if (f.status !== 'baseline_established' || f.comparatorResultId !== null || f.comparatorCommit !== null) { reasons.set(row.ordinal,'baseline_decision_conflict'); continue; }
            if (f.status !== 'discarded') selected.set(row.run_id,result.id);
          }
        }
        this.db.prepare('INSERT OR REPLACE INTO projections VALUES (?,?,?,?,?,?)').run(f.kind,f.id,row.run_id,f.revision,e.eventId,canonical(e));
        projected.set(`${f.kind}/${f.id}`,e);
        applied.add(row.ordinal); progress=true;
      }
    }
    for (const row of rows) this.db.prepare('UPDATE events SET status=?,reason=? WHERE ordinal=?')
      .run(applied.has(row.ordinal) ? 'applied' : reasons.has(row.ordinal) ? 'conflict' : 'pending',reasons.get(row.ordinal) ?? (applied.has(row.ordinal) ? null : 'causal_or_reference_gap'),row.ordinal);
  }
  private omit(ordinal: number, cause: string, from: number, to: number) {
    const adjacent = this.db.prepare('SELECT start_byte,end_byte FROM omissions WHERE ordinal=? AND cause=? AND start_byte<=? AND end_byte>=?').all(ordinal,cause,to,from) as { start_byte:number; end_byte:number }[];
    for (const gap of adjacent) {
      this.db.prepare('DELETE FROM omissions WHERE ordinal=? AND cause=? AND start_byte=? AND end_byte=?').run(ordinal,cause,gap.start_byte,gap.end_byte);
      from=Math.min(from,gap.start_byte); to=Math.max(to,gap.end_byte);
    }
    this.db.prepare('INSERT OR IGNORE INTO omissions VALUES (?,?,?,?,1)').run(ordinal,cause,from,to);
  }
  private retain(ordinal: number, run: string, bucket: string, text: string) {
    const bytes=Buffer.from(text); const size=bytes.length;
    const ranges = size > RETENTION_V1.bodyBytes ? [[0,RETENTION_V1.bodyHeadBytes],[size-RETENTION_V1.bodyHeadBytes,size]] : [[0,size]];
    let part=0; let last=0;
    for (const [a,b] of ranges) {
      const [from,to,body]=utf8Slice(bytes,a,b);
      if (from>last) this.omit(ordinal,'body_cap',last,from);
      if (to>from) this.db.prepare('INSERT INTO detail VALUES (?,?,?,?,?,?,?,?)').run(ordinal,part++,run,bucket,from,to,body,to-from);
      last=to;
    }
    if (last<size) this.omit(ordinal,'body_cap',last,size);
    type Chunk = { ordinal:number; part:number; start_byte:number; end_byte:number; body:string; bytes:number };
    const chunks=this.db.prepare('SELECT * FROM detail WHERE run_id=? AND bucket=? ORDER BY ordinal,start_byte').all(run,bucket) as Chunk[];
    const total=chunks.reduce((n,c)=>n+c.bytes,0);
    if (total>RETENTION_V1.bucketBytes) {
      let position=0;
      for (const c of chunks) {
        const start=position; const end=start+c.bytes; position=end;
        const keep: number[][]=[];
        if (start<RETENTION_V1.bucketHeadBytes) keep.push([0,Math.min(c.bytes,RETENTION_V1.bucketHeadBytes-start)]);
        if (end>total-(RETENTION_V1.bucketBytes-RETENTION_V1.bucketHeadBytes)) keep.push([Math.max(0,total-(RETENTION_V1.bucketBytes-RETENTION_V1.bucketHeadBytes)-start),c.bytes]);
        if (keep.length===1 && keep[0][0]===0 && keep[0][1]===c.bytes) continue;
        this.db.prepare('DELETE FROM detail WHERE ordinal=? AND part=?').run(c.ordinal,c.part);
        let previous=0; let index=c.part;
        for (const [a,b] of keep) {
          const [from,to,body]=utf8Slice(Buffer.from(c.body),a,b);
          if (from>previous) this.omit(c.ordinal,'bucket_cap',c.start_byte+previous,c.start_byte+from);
          // A chunk can intersect both keep ranges. Reuse its deleted key once,
          // then allocate above every still-owned part, including its original tail.
          if (to>from) {
            this.db.prepare('INSERT INTO detail VALUES (?,?,?,?,?,?,?,?)').run(c.ordinal,index,run,bucket,c.start_byte+from,c.start_byte+to,body,to-from);
            index=(this.db.prepare('SELECT max(part)+1 AS next FROM detail WHERE ordinal=?').get(c.ordinal) as {next:number}).next;
          }
          previous=to;
        }
        if (previous<c.bytes) this.omit(c.ordinal,'bucket_cap',c.start_byte+previous,c.end_byte);
      }
    }
    let runTotal=(this.db.prepare('SELECT coalesce(sum(bytes),0) AS bytes FROM detail WHERE run_id=?').get(run) as {bytes:number}).bytes;
    if (runTotal>RETENTION_V1.runBytes) for (const c of this.db.prepare('SELECT * FROM detail WHERE run_id=? ORDER BY ordinal,start_byte').all(run) as Chunk[]) {
      if (runTotal<=RETENTION_V1.runBytes) break;
      this.db.prepare('DELETE FROM detail WHERE ordinal=? AND part=?').run(c.ordinal,c.part);
      this.omit(c.ordinal,'run_cap',c.start_byte,c.end_byte); runTotal-=c.bytes;
    }
  }
  async inspect(runId: string) { return this.serial(()=>this.inspectSnapshot(runId)); }
  private async inspectSnapshot(runId: string) {
    assertId(runId);
    const rows=this.rows();
    const records: { ordinal:number; event:ResearchEvent | null; status:string; reason:string|null; receivedAt:string; coverage:SafeRecord['coverage']; detailOmission:string|null; omissions:unknown[]; retrievals:unknown[]; detail:unknown[] }[]=[];
    for (const row of rows.filter(r=>r.run_id===runId)) {
      const source=JSON.parse(row.source) as Source;
      const admitted=await this.recording.recheck({ ...source.admission,body:source.event as unknown as SafeRecord['body'] });
      const detail=[];let coverage=admitted.coverage;
      if (admitted.coverage!=='omitted') for (const chunk of this.db.prepare('SELECT start_byte,end_byte,body FROM detail WHERE ordinal=? ORDER BY start_byte').all(row.ordinal) as {start_byte:number;end_byte:number;body:string}[]) {
        const checked=await this.recording.recheck({ ...source.admission,body:chunk.body });
        if (checked.coverage==='omitted') coverage='omitted';
        if (checked.coverage!=='omitted') detail.push({from:chunk.start_byte,to:chunk.end_byte,text:checked.body});
      }
      records.push({ ordinal:row.ordinal,event:admitted.body as unknown as ResearchEvent|null,status:row.status,reason:row.reason,
        receivedAt:row.received_at,coverage,detailOmission:source.detailOmission,
        retrievals:this.db.prepare('SELECT received_at AS receivedAt FROM detail_retrievals WHERE ordinal=?').all(row.ordinal),
        omissions:this.db.prepare('SELECT cause,start_byte AS byteFrom,end_byte AS byteTo,policy_version AS policyVersion FROM omissions WHERE ordinal=? ORDER BY start_byte').all(row.ordinal).map(g => { const gap=g as {cause:string;byteFrom:number;byteTo:number;policyVersion:number}; const unknown=gap.cause==='redaction_omission'; return {...gap,byteFrom:unknown?null:gap.byteFrom,byteTo:unknown?null:gap.byteTo,droppedBytes:unknown?null:gap.byteTo-gap.byteFrom,droppedEvents:null,recovery:gap.cause==='queue_overflow'?(this.db.prepare('SELECT 1 FROM detail_retrievals WHERE ordinal=?').get(row.ordinal)?'recovered':'pending'):'permanently_unavailable',lastSuccessfulAt:null}; }),detail });
    }
    // The event log exposes original receipt order; projections do not treat it as
    // execution order. Gaps are derived from source sequences, never clock silence.
    const streams=new Map<string,number[]>();
    for (const row of rows.filter(r=>r.run_id===runId)) { const key=`${row.producer_id}/${row.stream_id}`; streams.set(key,[...(streams.get(key)??[]),row.sequence]); }
    for(const key of streams.keys())streams.set(key,[]);
    for(const row of rows){const values=streams.get(`${row.producer_id}/${row.stream_id}`);if(values)values.push(row.sequence);}
    const gaps: {stream:string;from:number;to:number}[]=[];
    for (const [stream,values] of streams) { let expected=0; for (const value of [...new Set(values)].sort((a,b)=>a-b)) { if(value>expected) gaps.push({stream,from:expected,to:value-1}); expected=value+1; } }
    const projections=[];const safeEvents=new Map(records.filter(r=>r.event && r.status==='applied').map(r=>[r.event!.eventId,r]));
    for (const row of this.db.prepare('SELECT event_id,source FROM projections WHERE run_id=? ORDER BY kind,id').all(runId) as {event_id:string;source:string}[]) {
      const record=safeEvents.get(row.event_id);
      if (record?.event) projections.push(JSON.parse(row.source) as ResearchEvent);
    }
    // Suppress the complete run projection after any quarantine discovered during
    // this read; do not return earlier-read descendants from a contaminated run.
    let selectedResultId: string | null = null;
    const decisions=projections.map(e=>e.fact).filter((f): f is Extract<Fact,{kind:'decision'}>=>f.kind==='decision' && ['kept','baseline_established'].includes(f.status));
    const visited=new Set<string>();
    for (;;) { const next=decisions.find(d=>d.comparatorResultId===selectedResultId && !visited.has(d.id)); if(!next) break; visited.add(next.id); selectedResultId=next.resultId; }
    const captureFailures=(this.db.prepare('SELECT * FROM capture_failures WHERE run_id=? ORDER BY first_at,reference').all(runId) as
      {reference:string;first_at:string;last_at:string;failures:number;recovered_ordinal:number|null}[]).map(row=>({
        reference:JSON.parse(row.reference) as Record<string,SafeValue>,cause:'filter_unavailable' as const,
        firstAt:row.first_at,lastAt:row.last_at,count:row.failures,byteFrom:null,byteTo:null,droppedBytes:null,droppedEvents:null,
        recovery:row.recovered_ordinal===null?'pending' as const:'recovered' as const,recoveredOrdinal:row.recovered_ordinal}));
    const quarantined=records.some(r=>r.coverage==='omitted');
    return { projectId:this.projectId,runId,snapshotOrdinal:records.at(-1)?.ordinal??0,retentionPolicy:RETENTION_V1,records:quarantined ? records.map(r=>({...r,event:null,detail:[]})) : records,
      projections:quarantined?[]:projections,selectedResultId:quarantined?null:selectedResultId,gaps,
      requiresReconciliation:quarantined || records.some(r=>r.status!=='applied'),
      captureFailures,
      captureRecoveries:this.db.prepare('SELECT id,evidence_id AS evidenceId,recovered_at AS recoveredAt FROM capture_recoveries WHERE run_id=?').all(runId),
      captureBlocked:this.storageFailed || !!this.db.prepare('SELECT 1 FROM faults WHERE run_id=?').get(runId) };
  }
  async agentValidation(runId: string) {
    // Only an explicit typed validation projection is offered. Generic settings,
    // activity, errors, assessments and arbitrary summaries never reach agents.
    const snapshot=await this.inspect(runId);
    await this.recording.admit({projectId:this.projectId,runId,actionId:runId,operationId:runId,eventId:runId,producerId:runId,streamId:runId,sequence:0,kind:'activity',source:'log',status:'completed'},null);
    if (snapshot.requiresReconciliation || snapshot.captureBlocked) return [];
    return snapshot.projections.flatMap(e => e.fact.kind==='evaluation' && e.fact.validity==='valid' && snapshot.projections.some(o=>o.fact.kind==='outcome' && o.fact.status==='completed' && e.fact.kind==='evaluation' && o.fact.attemptId===e.fact.attemptId) ?
      e.fact.metrics.filter(m=>m.split==='validation' && m.validity==='valid').map(m=>({ evaluationId:e.fact.id,metricId:m.metricId,split:'validation' as const,value:m.value })) : []);
  }
}
function utf8Slice(bytes: Buffer, start: number, end: number): [number,number,string] {
  while (start<end && (bytes[start]&0xc0)===0x80) start++;
  while (end>start && end<bytes.length && (bytes[end]&0xc0)===0x80) end--;
  return [start,end,bytes.subarray(start,end).toString('utf8')];
}
