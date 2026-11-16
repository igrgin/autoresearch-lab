const { fork } = require('node:child_process');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
process.once('message', input => {
  const build = process.argv[2] || input.build;
  const { ExecutionBounds } = require(path.join(build, 'src/execution/bounds.js'));
  const { ExecutionGuardian } = require(path.join(build, 'src/execution/guardian.js'));
  const { serveGuardian } = require(path.join(build, 'src/execution/guardian-host.js'));
  const { guardianJournal } = require(path.join(build, 'src/execution/journal.js'));
  const journal = guardianJournal(input.directory, input.operationId, input.scopeId, input.identity);
  const pids = [];
  const root = fork(path.join(__dirname, 'participant.cjs'), ['root'], { detached: true, env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  root.on('message', value => {
    pids.push(value.pid);
    if (pids.length !== 3) return;
    const scope = {
      seal: () => journal.seal(),
      cancel: () => { for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* exited */ } } },
      kill: () => { for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* exited */ } } },
      empty: () => pids.every(pid => { try { process.kill(pid, 0); return false; } catch { return true; } }),
    };
    let offset = 0;
    if (input.testClock) process.on('message', message => { if (message.kind === 'test_advance') offset = message.ms; });
    const clock = () => ({ bootId: 'controlled-fixture', ms: performance.now() + offset });
    const bounds = new ExecutionBounds(input.policy, clock());
    const guardian = new ExecutionGuardian(bounds, scope, clock, journal.save, '0:1', scope);
    if (input.phase) guardian.phase(input.phase, input.validationCallId);
    process.send?.({ kind: 'participants', pids });
    serveGuardian(guardian, clock, 1, true);
  });
});
