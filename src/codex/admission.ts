import type { Sanitizer } from '../security/sanitizer';
import { CodexFailure } from './errors';

// References are non-redeemable IDs, but their values still receive full policy
// admission. Rename only the contract's credential-designated metadata keys.
function projection(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projection);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key === 'credentialRef' ? 'accessRef' : key === 'credentials' ? 'accessOptions' : key, projection(item)]));
  return value;
}
export function admitCodexValue<T>(matcher: Sanitizer, value: T): T {
  try {
    const body = projection(value); const clean = matcher.filter(body);
    if (clean.redacted || JSON.stringify(clean.body) !== JSON.stringify(body)) throw new Error();
    return value;
  } catch { throw new CodexFailure('capture_failed'); }
}
