import { constants, closeSync, fstatSync, statfsSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BoundError, ClockReading } from './bounds';
import type { OwnedScope } from './guardian';

export function linuxBootClock(): ClockReading {
  if (process.platform !== 'linux') throw new BoundError('unsupported_capability');
  // /proc/uptime uses the same suspend-inclusive elapsed clock as CLOCK_BOOTTIME.
  // UTC and process-relative hrtime cannot authorize work after a kernel reboot.
  const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const ms = Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]) * 1000;
  if (!/^[0-9a-f-]{36}$/.test(bootId) || !Number.isFinite(ms)) throw new BoundError('unsupported_capability');
  return { bootId, ms };
}

// The remote launcher supplies an already contained subtree and a separate
// trusted gate. It must qualify namespaces, cgroup non-escape, devices, and the
// namespace-init parent-death path before invoking this port. This is not an
// arbitrary-command launcher or a substitute for the #54 sandbox preflight.
export class CgroupScope implements OwnedScope {
  #directory: number; #closed = false;
  constructor(delegatedRoot: string, scopeId: string, private readonly sealAdmission: () => boolean,
    private readonly cancelPhase: OwnedScope['cancel']) {
    if (process.platform !== 'linux' || !/^[0-9a-f-]{36}$/.test(scopeId)) throw new BoundError('unsupported_capability');
    let directory: number | undefined;
    try {
      const root = realpathSync(delegatedRoot);
      if (root !== path.resolve(delegatedRoot) || !root.startsWith('/sys/fs/cgroup/') || root === '/sys/fs/cgroup') throw new Error();
      const scope = path.join(root, scopeId);
      if (realpathSync(scope) !== scope) throw new Error();
      directory = openSync(scope, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      if (Number(statfsSync(`/proc/self/fd/${directory}`).type) !== 0x63677270 || !fstatSync(directory).isDirectory()) throw new Error();
      // Hold the inode, not a recyclable path or PID. Never fall back to process
      // groups: setsid/double forks must remain within the same cgroup subtree.
      this.#directory = directory;
      this.read('cgroup.events');
      const kill = this.open('cgroup.kill', constants.O_WRONLY); closeSync(kill);
    } catch {
      if (directory !== undefined) closeSync(directory);
      throw new BoundError('unsupported_capability');
    }
  }
  private open(name: 'cgroup.events' | 'cgroup.kill', flags: number): number {
    if (this.#closed) throw new BoundError('conflict');
    return openSync(`/proc/self/fd/${this.#directory}/${name}`, flags | constants.O_NOFOLLOW);
  }
  private read(name: 'cgroup.events'): string {
    const file = this.open(name, constants.O_RDONLY);
    try { return readFileSync(file, 'utf8'); } finally { closeSync(file); }
  }
  binding(): string { const info = fstatSync(this.#directory, { bigint: true }); return `${info.dev}:${info.ino}`; }
  seal(): boolean { return this.sealAdmission(); }
  cancel(phase: Parameters<OwnedScope['cancel']>[0]): void { this.cancelPhase(phase); }
  kill(): void {
    const file = this.open('cgroup.kill', constants.O_WRONLY);
    try { writeFileSync(file, '1'); } finally { closeSync(file); }
  }
  empty(): boolean | 'unknown' {
    try {
      const value = this.read('cgroup.events').match(/^populated ([01])$/m)?.[1];
      return value === '0' ? true : value === '1' ? false : 'unknown';
    } catch { return 'unknown'; }
  }
  close(): void { if (!this.#closed) { this.#closed = true; closeSync(this.#directory); } }
}
