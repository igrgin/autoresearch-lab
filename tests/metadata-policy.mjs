import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

export function metadataPolicyTests({ require, build, fixture, newId, claude = false }) {
  test('metadata reply barrier rejects stale, untagged and backwards replies without retrying a mutation', async () => {
    const { MetadataPolicy, metadataReply } = require(path.join(build, 'src/security/metadata-policy.js'));
    const policy = new MetadataPolicy(); let revision = 0, calls = 0;
    const read = async () => revision;
    assert.deepEqual(await policy.receive(async () => metadataReply({ ok: true }, revision), read), { ok: true });
    await assert.rejects(policy.receive(async () => { calls++; revision++; return metadataReply({ value: 'older body' }, 0); }, read));
    assert.equal(calls, 1, 'uncertain writes are never retried');
    await assert.rejects(policy.receive(async () => ({ value: 'untagged' }), read));
    revision = 0;
    await assert.rejects(policy.receive(async () => metadataReply({ value: 'backwards' }, 0), read));
  });
  test('rejected responses synchronize matching and retain the original error without retry', async () => {
    const { MetadataPolicy } = require(path.join(build, 'src/security/metadata-policy.js'));
    const policy = new MetadataPolicy(); let revision = 0, calls = 0, invalidations = 0;
    policy.subscribe(() => { invalidations++; });
    const failure = new Error('original uncertain operation diagnostic');
    await assert.rejects(policy.receive(async () => { calls++; revision++; throw failure; }, async () => revision), error => error === failure);
    assert.equal(invalidations, 1); assert.equal(calls, 1); assert.equal(policy.revision(), 1);
  });
  test('unavailable post-reply authority clears caches for success and rejection', async () => {
    const { MetadataPolicy, metadataReply } = require(path.join(build, 'src/security/metadata-policy.js'));
    for (const rejected of [false, true]) {
      const policy = new MetadataPolicy(); let reads = 0, calls = 0, invalidations = 0;
      policy.subscribe(() => { invalidations++; });
      const failure = new Error('original operation error');
      await assert.rejects(policy.receive(async () => { calls++; if (rejected) throw failure; return metadataReply({ ok: true }, 0); }, async () => { if (++reads > 1) throw new Error('lost barrier'); return 0; }), error => !rejected || error === failure);
      assert.equal(invalidations, 1); assert.equal(calls, 1);
    }
  });
  test('all metadata listeners are invalidated even when another view throws', () => {
    const { MetadataPolicy } = require(path.join(build, 'src/security/metadata-policy.js'));
    const policy = new MetadataPolicy(); let observed = 0;
    policy.subscribe(() => { throw new Error('controlled broken view'); });
    policy.subscribe(() => { observed++; });
    policy.observe(1); assert.equal(observed, 1); assert.equal(policy.current(), 1);
    policy.observe(1); assert.equal(observed, 1, 'duplicate notification is harmless');
  });
  test('failed durable capture releases matching ownership while retaining the capture fence', async () => {
    const f = await fixture(), eventId = newId();
    const original = f.recordFiles.write.bind(f.recordFiles);
    f.recordFiles.write = async (name, bytes) => { if (name === `${eventId}.json`) throw new Error('controlled write failure'); return original(name, bytes); };
    const meta = { projectId: newId(), runId: newId(), actionId: newId(), operationId: newId(), eventId, producerId: newId(), streamId: newId(), sequence: 0, source: 'model_metadata', kind: 'activity', status: 'completed' };
    await assert.rejects(f.recording.capture(meta, { modelId: 'controlled-model' }));
    await Promise.race([f.credentials.register('model_download', newId(), 'After failed capture', 'synthetic-later-access'), new Promise((_, reject) => setTimeout(() => reject(new Error('matching ownership leaked')), 1000))]);
    assert.throws(() => f.recording.assertCanAct(meta), 'the run capture fence remains effective');
  });
  for (const stage of ['replacement_admission', 'tombstone_write']) test(`correction owns matching policy through ${stage}`, async () => {
    const f = await fixture(), canary = 'correction-family-policy-fixture';
    const meta = { projectId: newId(), runId: newId(), actionId: newId(), operationId: newId(), eventId: newId(), producerId: newId(), streamId: newId(), sequence: 0, source: 'model_metadata', kind: 'activity', status: 'completed' };
    await f.recording.capture(meta, { modelId: 'original-model' });
    await f.recording.incident(meta, { recordIds: [meta.eventId], sessionIds: [], reach: 'prevented', destinations: ['application'], reason: 'unsafe_capture' });
    const replacement = { ...meta, eventId: newId(), sequence: 1 };
    let enter, resume;
    const entered = new Promise(resolve => { enter = resolve; });
    const gate = new Promise(resolve => { resume = resolve; });
    const originalRead = f.recordFiles.read.bind(f.recordFiles);
    f.recordFiles.read = async name => { const bytes = await originalRead(name); if (stage === 'replacement_admission' && name === `${replacement.eventId}.json`) { enter(); await gate; } return bytes; };
    const originalWrite = f.recordFiles.write.bind(f.recordFiles);
    f.recordFiles.write = async (name, bytes) => { if (stage === 'tombstone_write' && name === `${meta.eventId}.json`) { enter(); await gate; } return originalWrite(name, bytes); };
    const correction = f.recording.correct(meta.eventId, replacement, { modelId: canary });
    await entered;
    const registration = f.credentials.register('model_download', newId(), 'Correction matching material', canary);
    await Promise.race([registration, new Promise(resolve => setTimeout(resolve, 30))]);
    const recognizedBeforeWrite = f.sanitizer.text(canary).changed;
    resume(); const corrected = await correction; await registration;
    const bytes = await readFile(path.join(f.directory, 'records', `${replacement.eventId}.json`));
    assert.equal(recognizedBeforeWrite && bytes.includes(Buffer.from(canary)), false, 'recognized value must not be published by correction');
    assert.equal(corrected.supersedes, meta.eventId);
    assert.equal((await f.recording.read(replacement.eventId)).coverage, 'omitted');
  });
  for (const failingWrite of ['replacement', 'tombstone']) test(`correction ${failingWrite} failure releases matching ownership`, async () => {
    const f = await fixture();
    const meta = { projectId: newId(), runId: newId(), actionId: newId(), operationId: newId(), eventId: newId(), producerId: newId(), streamId: newId(), sequence: 0, source: 'model_metadata', kind: 'activity', status: 'completed' };
    await f.recording.capture(meta, { modelId: 'original-model' });
    await f.recording.incident(meta, { recordIds: [meta.eventId], sessionIds: [], reach: 'prevented', destinations: ['application'], reason: 'unsafe_capture' });
    const replacement = { ...meta, eventId: newId(), sequence: 1 }, write = f.recordFiles.write.bind(f.recordFiles);
    f.recordFiles.write = (name, bytes) => name === `${failingWrite === 'replacement' ? replacement.eventId : meta.eventId}.json` ? Promise.reject(new Error('controlled correction write failure')) : write(name, bytes);
    await assert.rejects(f.recording.correct(meta.eventId, replacement, { modelId: 'clean-correction' }));
    await Promise.race([f.credentials.register('model_download', newId(), 'After correction failure', 'synthetic-correction-later-key'), new Promise((_, reject) => setTimeout(() => reject(new Error('correction ownership leaked')), 1000))]);
    assert.equal((await f.recording.read(meta.eventId)).coverage, 'omitted');
  });
  for (const consumer of ['direct', 'stream', 'recorded_operation', ...(claude ? ['claude_catalog'] : [])]) {
    test(`current matching ownership spans ${consumer} admission and durable file publication`, async () => {
      const f = await fixture(), canary = 'claude-family-capture-20261116';
      const { CaptureStream } = require(path.join(build, 'src/security/recording.js'));
      const { bindRecordedOperation } = require(path.join(build, 'src/security/operations.js'));
      const scope = { projectId: newId(), runId: newId(), actionId: newId(), operationId: newId() };
      const meta = { ...scope, eventId: newId(), producerId: newId(), streamId: newId(), sequence: 0, source: 'model_metadata', kind: 'activity', status: 'completed' };
      let enter, resume, filename;
      const entered = new Promise(resolve => { enter = resolve; });
      const gate = new Promise(resolve => { resume = resolve; });
      const originalRead = f.recordFiles.read.bind(f.recordFiles);
      f.recordFiles.read = async name => {
        const bytes = await originalRead(name);
        if (/^[a-f0-9-]{36}\.json$/.test(name)) { filename = name; enter(); await gate; }
        return bytes;
      };
      const entry = await f.credentials.register(consumer === 'claude_catalog' ? 'anthropic' : 'model_download', newId(), 'Controlled access', 'synthetic-initial-worker-access');
      let capture;
      if (consumer === 'stream') {
        const stream = new CaptureStream(f.recording, meta, 'json');
        stream.push(Buffer.from(JSON.stringify({ modelId: canary }))); capture = stream.finish();
      } else if (consumer === 'recorded_operation') {
        capture = bindRecordedOperation(f.credentials, f.recording, { component: 'model_fetcher', credentialId: entry.id, accountId: entry.accountId, purpose: 'model_fetch', scope }, meta, async () => ({ modelId: canary })).execute(scope);
      } else if (consumer === 'claude_catalog') {
        const { ClaudeHost } = require(path.join(build, 'src/claude/host.js'));
        const host = new ClaudeHost(f.credentials, f.recording, async () => {}, async input => ({ catalog: {
          credentialId: input.credentialId, observedAt: new Date().toISOString(), complete: true, source: 'anthropic_models+sdk_supportedModels', sdkVersion: '0.3.323', models: [{ id: canary, lifecycle: 'active' }],
        } }), async () => null, async () => true);
        capture = host.discover(entry.id);
      } else capture = f.recording.capture(meta, { modelId: canary });
      await entered;
      const registration = f.credentials.register('model_download', newId(), 'Later matching material', canary);
      // The real writer is paused; a completed registration here would make its
      // admitted bytes stale. Bounded observation, then always release the writer.
      await Promise.race([registration, new Promise(resolve => setTimeout(resolve, 30))]);
      const recognizedBeforeWrite = f.sanitizer.text(canary).changed; // Actual matching authority, not vault acknowledgement timing.
      resume(); await capture; await registration;
      const bytes = await readFile(path.join(f.directory, 'records', filename));
      assert.equal(recognizedBeforeWrite && bytes.includes(Buffer.from(canary)), false,
        'a value recognized before publication must not reach the activity file');
      const retained = await f.recording.read(filename.slice(0, -5));
      assert.equal(retained.coverage, 'omitted', 'later recognition still quarantines the historical record on reuse');
    });
  }
}
