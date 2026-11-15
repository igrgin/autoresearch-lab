import { randomUUID } from 'node:crypto';

export const POLICY_REVISION = 'credential-admission/1';
export const REDACTED = '[REDACTED:credential]';
export type SecurityCode = 'permission_denied' | 'authentication_required' | 'capture_failed' | 'invalid_input' | 'conflict';
export class SecurityError extends Error {
  readonly retry = 'after_reconcile';
  constructor(readonly code: SecurityCode, readonly effect: 'none' | 'partial' | 'unknown' = 'none') {
    super({ permission_denied: 'This component is not authorized for the operation.',
      authentication_required: 'Unlock or replace the credential in trusted settings.',
      capture_failed: 'Safe recording is unavailable. Reconcile before resuming.',
      invalid_input: 'The security request is invalid.', conflict: 'The record identity is already in use.' }[code]);
    this.name = 'SecurityError';
  }
}
export const newId = (): string => randomUUID();
export function assertId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new SecurityError('invalid_input');
  }
}
export interface Scope { projectId: string; runId: string; actionId: string; operationId: string }
export function validateScope(scope: Scope): Scope {
  for (const key of ['projectId', 'runId', 'actionId', 'operationId'] as const) assertId(scope[key]);
  return { projectId: scope.projectId, runId: scope.runId, actionId: scope.actionId, operationId: scope.operationId };
}
export function sameScope(a: Scope, b: Scope): boolean {
  return a.projectId === b.projectId && a.runId === b.runId && a.actionId === b.actionId && a.operationId === b.operationId;
}
