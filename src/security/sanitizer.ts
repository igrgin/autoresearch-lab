import { POLICY_REVISION, REDACTED } from './common';

export type SafeValue = null | boolean | number | string | SafeValue[] | { [key: string]: SafeValue };
export type Omission = 'excluded_source' | 'unsupported_encoding' | 'incomplete_record' | 'size_limit' | 'invalid_schema' | 'filter_unavailable' | 'opaque_attachment';
export interface Filtered { body: SafeValue; redacted: boolean; credentialIds: string[] }
const credentialField = /(?:authorization|authentication|cookie|password|passphrase|secret|token|api[_-]?key|private[_-]?key|credential|challenge|otp|recovery[_-]?code|signed[_-]?url)/i;
export const MAX_CAPTURE_BYTES = 4 * 1024 * 1024; // admission bound; #86 retention cuts follow admission

export class OmitBody extends Error {
  constructor(readonly reason: Omission) { super('Activity detail was withheld.'); }
}
export class Sanitizer {
  readonly policyRevision = POLICY_REVISION;
  #values = new Map<string, string[]>();
  register(id: string, value: string): void {
    if (!value || Buffer.byteLength(value) > 64 * 1024) throw new OmitBody('invalid_schema');
    const json = JSON.stringify(value).slice(1, -1);
    const escaped = value.split('').map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
    const url = encodeURIComponent(value);
    this.#values.set(id, [...new Set([value, json, escaped, escaped.toUpperCase().replaceAll('\\U', '\\u'), url,
      url.replace(/%[A-F0-9]{2}/g, p => p.toLowerCase()), encodeURIComponent(url)])].sort((a,b) => b.length-a.length));
  }
  forget(id: string): void { this.#values.delete(id); }
  text(value: string): { value: string; changed: boolean; credentialIds: string[] } {
    let result = value;
    const credentialIds = new Set<string>();
    for (const [id, variants] of this.#values) for (const secret of variants) {
      if (result.includes(secret)) { credentialIds.add(id); result = result.split(secret).join(REDACTED); }
    }
    result = result
      .replace(/-----BEGIN (?:[A-Z0-9 ]*PRIVATE KEY)-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, REDACTED)
      .replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|hf_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, REDACTED)
      .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.%-]+/gi, REDACTED)
      .replace(/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`)
      .replace(/([?&](?:[^\s=&#]*(?:token|key|secret|password|signature|sig|credential|auth)[^\s=&#]*)=)[^\s&#]*/gi, `$1${REDACTED}`)
      .replace(/((?:--)?(?:api[_-]?key|password|token|secret|authorization)\s*(?:=|:|\s)\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, `$1${REDACTED}`);
    return { value: result, changed: result !== value, credentialIds: [...credentialIds] };
  }
  filter(input: unknown): Filtered {
    let bytes = 0; let nodes = 0; let redacted = false;
    const seen = new Set<object>();
    const credentialIds = new Set<string>();
    const visit = (value: unknown, depth: number): SafeValue => {
      if (++nodes > 100_000 || depth > 32) throw new OmitBody('size_limit');
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        bytes += Buffer.byteLength(value);
        if (bytes > MAX_CAPTURE_BYTES || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new OmitBody('unsupported_encoding');
        const clean = this.text(value); redacted ||= clean.changed; for (const id of clean.credentialIds) credentialIds.add(id); return clean.value;
      }
      if (!value || typeof value !== 'object' || seen.has(value)) throw new OmitBody('invalid_schema');
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null && !Array.isArray(value)) throw new OmitBody('invalid_schema');
      seen.add(value);
      const result: { [key: string]: SafeValue } = Object.create(null);
      const array: SafeValue[] = [];
      for (const key of Reflect.ownKeys(value)) {
        if (Array.isArray(value) && key === 'length') continue;
        if (typeof key !== 'string') throw new OmitBody('invalid_schema');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new OmitBody('invalid_schema');
        const safeKey = visit(key, depth + 1) as string;
        const clean = credentialField.test(key) ? (redacted = true, REDACTED) : visit(descriptor.value, depth + 1);
        if (Array.isArray(value)) {
          if (key !== String(array.length)) throw new OmitBody('invalid_schema');
          array.push(clean);
        } else {
          if (Object.hasOwn(result, safeKey)) throw new OmitBody('invalid_schema');
          result[safeKey] = clean;
        }
      }
      seen.delete(value); return Array.isArray(value) ? array : result;
    };
    const body = visit(input, 0);
    return { body, redacted, credentialIds: [...credentialIds] };
  }
}
