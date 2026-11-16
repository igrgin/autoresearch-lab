import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { newId, SecurityError } from './common';

// Hosts supply an app-private directory, never a project or model workspace.
export class PrivateFiles {
  constructor(private readonly directory: string) {}
  async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.()) throw new SecurityError('permission_denied');
    await chmod(this.directory, 0o700);
  }
  private file(name: string): string {
    if (!/^[a-z0-9.-]+$/.test(name)) throw new SecurityError('invalid_input');
    return path.join(this.directory, name);
  }
  async read(name: string): Promise<Buffer | undefined> {
    let handle;
    try {
      handle = await open(this.file(name), constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) || info.size > 16 * 1024 * 1024) {
        throw new SecurityError('permission_denied');
      }
      return await handle.readFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new SecurityError('capture_failed');
    } finally { await handle?.close(); }
  }
  async write(name: string, bytes: Buffer | string): Promise<void> {
    const temporary = this.file(`${newId()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close(); handle = undefined;
      await rename(temporary, this.file(name));
      const directory = await open(this.directory, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { throw new SecurityError('capture_failed'); }
    finally { await handle?.close(); await unlink(temporary).catch(() => undefined); }
  }
  async names(): Promise<string[]> { return readdir(this.directory); }
}
