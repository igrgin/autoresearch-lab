// Controlled test fixture only: descendants announce themselves before work and
// create no more processes afterwards. This is not a production containment port.
const { fork } = require('node:child_process');
process.on('SIGTERM', () => {});
if (process.argv[2] === 'root') {
  const child = fork(__filename, ['detached'], { detached: true, env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  child.on('message', value => process.send?.(value));
  child.unref();
}
if (process.argv[2] === 'detached') {
  const grandchild = fork(__filename, ['grandchild'], { detached: true, env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  grandchild.on('message', value => process.send?.(value));
  grandchild.unref();
}
process.send?.({ pid: process.pid, role: process.argv[2] });
setInterval(() => {}, 1000);
