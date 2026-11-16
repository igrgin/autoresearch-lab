const { fork } = require('node:child_process');
const path = require('node:path');
const child = fork(path.join(__dirname, 'guardian-fixture.cjs'), [process.argv[2]], {
  detached: true, env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});
process.once('message', input => child.send(input));
child.on('message', message => {
  if (message.kind === 'participants') process.send?.(message);
  if (message.kind === 'armed') {
    process.send?.({ kind: 'guardian', pid: child.pid });
    if (process.argv[3] === 'hang') { while (true) { /* simulated hung supervisor */ } }
    else process.exit(0); // guardian must survive IPC/parent loss
  }
});
