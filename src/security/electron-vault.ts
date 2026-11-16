import { app, safeStorage } from 'electron';
import path from 'node:path';
import { CredentialService } from './credentials';
import { SecurityError } from './common';
import { PrivateFiles } from './private-files';
import { SafeRecording } from './recording';
import { Sanitizer } from './sanitizer';

export function createSecurityHost() {
  const matcher = new Sanitizer();
  const credentials = new CredentialService(new PrivateFiles(path.join(app.getPath('userData'), 'private-credentials')), {
    available: async () => process.platform === 'darwin' && await safeStorage.isAsyncEncryptionAvailable(),
    encrypt: value => safeStorage.encryptStringAsync(value),
    decrypt: async value => {
      const decrypted = await safeStorage.decryptStringAsync(value);
      if (typeof decrypted.result !== 'string') throw new SecurityError('authentication_required');
      return decrypted.result;
    },
  }, matcher);
  const recording = new SafeRecording(new PrivateFiles(path.join(app.getPath('userData'), 'admitted-records')), matcher, id => credentials.revoke(id));
  let initialized: Promise<void> | undefined;
  return {
    credentials, recording, sanitizer: matcher,
    assertSafeConfiguration: (value: unknown) => {
      if (matcher.filter(value).redacted) throw new SecurityError('invalid_input');
    },
    // Trusted import metadata admission only; never return the matched value or
    // alter a filesystem name. Caller initializes current/remediation matching.
    checkImportNames: (names: unknown): boolean => Array.isArray(names) && names.length <= 10001 &&
      names.every(name => typeof name === 'string' && name.length <= 4096 && !matcher.text(name).changed),
    // No recording/access until all current + remediation matching material has been loaded.
    initialize: () => {
      initialized ??= credentials.initialize().then(() => recording.initialize()).catch(() => {
        throw new SecurityError('authentication_required');
      }).finally(() => { initialized = undefined; });
      return initialized;
    },
  };
}
