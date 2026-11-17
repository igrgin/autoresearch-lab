import assert from 'node:assert/strict';

// Actual packaged utility message port, using a separate synthetic profile.
// No credentials, provider traffic, or remote execution is involved.
export async function checkPackagedReservations(application) {
  const result = await application.evaluate(async ({ app, utilityProcess }) => {
    const path = process.getBuiltinModule('node:path');
    const { randomUUID } = process.getBuiltinModule('node:crypto');
    const root = path.join(app.getPath('userData'), 'reservation-port-fixture');
    const executable = path.join(app.getAppPath(), '.webpack/main/coordinator.cjs');
    let worker;
    const results = [];
    function message(send) {
      return new Promise((resolve, reject) => {
        const onExit = () => { clearTimeout(timer); reject(new Error('Reservation utility exited.')); };
        const timer = setTimeout(() => { worker.removeListener('exit', onExit); reject(new Error('Reservation utility timed out.')); }, 15_000);
        worker.once('exit', onExit);
        worker.once('message', (value) => { clearTimeout(timer); worker.removeListener('exit', onExit); resolve(value); });
        send?.();
      });
    }
    async function start() {
      worker = utilityProcess.fork(executable, [root], { serviceName: 'Synthetic reservation qualification' });
      const ready = await message();
      if (ready.coordinator !== 'ready') throw new Error('Reservation utility startup failed.');
    }
    async function stop() {
      const exited = new Promise(resolve => worker.once('exit', resolve));
      worker.kill(); await exited; worker = null;
    }
    async function request(request) {
      const id = randomUUID();
      const result = await message(() => worker.postMessage({ id, request }));
      if (result.id !== id) throw new Error('Reservation reply identity mismatch.');
      return result.reply;
    }
    function acquire(projectId, provider, instanceId) {
      const operationId = randomUUID();
      return { kind: 'compute.acquire', operationId, input: { operationId, reservationId: randomUUID(), projectId, runId: randomUUID(),
        authorityId: randomUUID(), episodeId: randomUUID(), scopeId: randomUUID(), allocation: { provider, instanceId, incarnationId: 'fixture-incarnation',
          accountId: 'fixture-alias', identityStatus: 'verified', gpuIds: [{ uuid: 'GPU-11111111-1111-1111-1111-111111111111', ordinal: 0 }] } } };
    }
    try {
      await start();
      const projects = [];
      for (const name of ['first', 'second']) {
        const operationId = randomUUID();
        const created = await request({ kind: 'create', operationId, input: { requestId: operationId, name, folderName: name } });
        if (!created.ok) throw new Error('Synthetic project creation failed.');
        projects.push(created.value.projectId);
      }
      for (const provider of ['runpod', 'vast']) {
        const first = acquire(projects[0], provider, provider === 'runpod' ? 'fixture-pod' : '1234');
        const grant = await request(first);
        const second = acquire(projects[1], provider, first.input.allocation.instanceId);
        second.input.allocation.accountId = 'fixture-other-alias';
        second.input.allocation.gpuIds[0] = { uuid: 'GPU-22222222-2222-2222-2222-222222222222', ordinal: 1 };
        const conflict = await request(second);
        const stopping = await request({ kind: 'compute.stopping', operationId: randomUUID(), reservationId: first.input.reservationId, expectedRevision: 1 });
        const noProof = await request({ kind: 'compute.release', operationId: randomUUID(), reservationId: first.input.reservationId, expectedRevision: 2, releaseId: randomUUID() });
        results.push({ provider, granted: grant.ok, conflict: conflict.error?.code, stopping: stopping.value?.state, release: noProof.error?.code });
      }
      await stop(); await start();
      const saved = await request({ kind: 'compute.list', operationId: randomUUID() });
      return { results, restartStates: saved.value?.map(r => r.state), owners: saved.value?.map(r => r.owner) };
    } finally { if (worker) await stop(); }
  });
  assert.deepEqual(result.results, ['runpod', 'vast'].map(provider => ({ provider, granted: true, conflict: 'conflict', stopping: 'stopping_unknown', release: 'unavailable' })));
  assert.deepEqual(result.restartStates, ['stopping_unknown', 'stopping_unknown']);
  assert.deepEqual(result.owners, ['reservation_coordinator', 'reservation_coordinator']);
}
