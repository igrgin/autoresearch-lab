import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { app, utilityProcess } from 'electron';
import Database from 'better-sqlite3';
import { ImportPolicyHost, type ImportPolicyReply, type ImportPolicyRequest } from '../src/importer/policy';
import { SafeRecording, type Envelope, type SafeRecord } from '../src/security/recording';
import { PrivateFiles } from '../src/security/private-files';
import { Sanitizer } from '../src/security/sanitizer';
import type { ImportRecord } from '../src/imports';
import type { ProjectRecord } from '../src/projects';

type Reply = { ok: boolean; value?: ProjectRecord | ImportRecord[] };
async function scenario(mode: 'normal' | 'late-grant' | 'dropped-release' | 'denied') {
  const root = path.join(app.getPath('userData'), mode), applicationData = path.join(root, 'app'), source = path.join(root, 'NativePolicyPath23');
  await mkdir(applicationData, { recursive: true }); await mkdir(source); await writeFile(path.join(source, 'data.txt'), 'controlled import bytes\n');
  const matcher = new Sanitizer();
  const recording = new SafeRecording(new PrivateFiles(path.join(root, 'security')), matcher, async () => {}); await recording.initialize();
  const child = utilityProcess.fork(path.join(__dirname, 'import-policy-worker.cjs'), [applicationData]);
  let connected = true, project: ProjectRecord, probes = 0, registered = false, registration: Promise<void> | undefined, delayed: ImportPolicyReply | undefined, heldRelease = false;
  const pending = new Map<string, (reply: Reply) => void>();
  const register = () => registration ||= matcher.registerWhenMutable(randomUUID(), 'NativePolicyPath23').then(() => { registered = true; });
  const initialize = async () => { if (registration) await registration; };
  let releaseSeen = () => {};
  const released = new Promise<void>(resolve => { releaseSeen = resolve; });
  const payloads = () => {
    const db = new Database(path.join(project.location, '.lab', 'imports.sqlite'), { readonly: true });
    try { return db.prepare('SELECT payload FROM imports').all() as { payload: string }[]; } finally { db.close(); }
  };
  const policy = new ImportPolicyHost(async meta => {
    if (mode === 'denied') throw new Error('controlled unavailable authority');
    await initialize();
    const release = matcher.holdMatchingPolicy();
    try { recording.metadataRevision(meta); return release; } catch (error) { release(); throw error; }
  }, reply => {
    if (mode === 'late-grant' && !delayed) { delayed = reply; void register(); }
    else child.postMessage(reply);
  }, { recheck: record => recording.recheck(record), metadataRevision: meta => {
    const revision = recording.metadataRevision(meta);
    if (mode === 'normal' && ++probes === 2) void register();
    return revision;
  } });
  const exited = new Promise<void>(resolve => child.once('exit', () => {
    connected = false; policy.close(); for (const reply of pending.values()) reply({ ok: false }); pending.clear(); resolve();
  }));
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Native import coordinator did not start')), 15_000);
    child.once('message', (message: { coordinator?: string }) => { clearTimeout(timeout); assert.equal(message.coordinator, 'ready'); resolve(); });
  });
  child.on('message', (message: { channel?: string; id: string; kind?: string; value?: SafeRecord; meta?: Envelope; reply?: Reply; importAdmissionId?: string } & Partial<ImportPolicyRequest>) => {
    if (message.channel === 'import_matching') {
      if (message.kind === 'release' && mode === 'dropped-release') { heldRelease = true; void register(); releaseSeen(); return; }
      if (message.kind === 'release' && mode === 'normal' && registration && !heldRelease) {
        assert.equal(registered, false, 'registration must wait for actual writer completion');
        assert.ok(payloads().some(row => row.payload.includes('NativePolicyPath23')), 'real SQLite commit precedes writer release');
        heldRelease = true;
      }
      policy.receive(message as ImportPolicyRequest); return;
    }
    if (message.channel === 'import_metadata_revision') {
      void initialize().then(() => {
        try {
        const revision = recording.metadataRevision(message.meta!);
        child.postMessage({ channel: message.channel, id: message.id, ok: true, revision });
        } catch { child.postMessage({ channel: message.channel, id: message.id, ok: false }); }
      });
      return;
    }
    if (message.channel === 'research_security') {
      void initialize().then(() => recording.recheck(message.value!)).then(record => child.postMessage({ channel: message.channel, id: message.id, ok: true, record }), () => child.postMessage({ channel: message.channel, id: message.id, ok: false })); return;
    }
    if (message.importAdmissionId) { child.postMessage({ importAdmissionId: message.importAdmissionId, allowed: true }); return; }
    if (message.reply) { pending.get(message.id)?.(message.reply); pending.delete(message.id); }
  });
  const request = (request: unknown) => new Promise<Reply>((resolve, reject) => {
    const id = randomUUID(); const timer = setTimeout(() => reject(new Error('Native import request did not finish')), 35_000);
    pending.set(id, reply => { clearTimeout(timer); resolve(reply); }); child.postMessage({ id, request });
  });
  try {
    await ready;
    const operationId = randomUUID(); const created = await request({ kind: 'create', operationId, input: { requestId: operationId, name: 'Native import ownership', folderName: 'ownership' } });
    assert.equal(created.ok, true); project = created.value as ProjectRecord;
    const starting = request({ kind: 'imports:start', operationId: randomUUID(), projectId: project.projectId, sourcePaths: [source], destinationName: 'data', mode: 'copy' });
    if (mode === 'dropped-release') {
      await released; await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(heldRelease, true); assert.equal(registered, false); assert.equal(payloads().length, 1);
      child.kill(); await exited; await registration; assert.equal(registered, true);
    }
    const start = await starting;
    if (mode === 'late-grant') {
      assert.equal(start.ok, false); assert.ok(delayed); await registration; assert.equal(registered, true);
      child.postMessage(delayed); // A grant delivered after expiry cannot revive INSERT.
      const listed = await request({ kind: 'imports:list', operationId: randomUUID(), projectId: project.projectId });
      assert.equal(listed.ok, true); assert.deepEqual(listed.value, []); assert.equal(payloads().length, 0);
    } else if (mode === 'dropped-release') {
      assert.equal(start.ok, false, 'confirmed utility exit leaves caller with an uncertain interrupted write');
    } else if (mode === 'denied') { assert.equal(start.ok, false); assert.equal(payloads().length, 0); }
    else {
      assert.equal(start.ok, false); await registration; assert.equal(registered, true); assert.equal(heldRelease, true);
      const listed = await request({ kind: 'imports:list', operationId: randomUUID(), projectId: project.projectId });
      assert.equal(listed.ok, false); assert.equal(JSON.stringify(listed).includes('NativePolicyPath23'), false);
    }
    assert.equal(await readFile(path.join(source, 'data.txt'), 'utf8'), 'controlled import bytes\n');
    console.log(`Native import matching ownership ${mode}: passed; actual coordinator, SQLite and source preservation.`);
  } finally { if (connected) child.kill(); await exited; }
}
void app.whenReady().then(async () => {
  for (const mode of ['normal', 'late-grant', 'dropped-release', 'denied'] as const) await scenario(mode);
  app.exit(0);
}).catch(error => { console.error('Controlled native import matching regression failed:', error); app.exit(1); });
