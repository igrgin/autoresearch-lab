import { assertId, SecurityError } from './common';
import type { RecordKind } from './recording';
import type { SafeValue } from './sanitizer';

// A second boundary beyond secret sanitation. The context owner (#66) must authorize
// input records; raw transcripts, summaries, test assessments and arbitrary maps fail here.
export function contextBody(kind: RecordKind, body: SafeValue): SafeValue {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SecurityError('permission_denied');
  const exact = (keys: string[]) => {
    if (Object.keys(body).length !== keys.length || !keys.every(key => Object.hasOwn(body, key))) throw new SecurityError('permission_denied');
  };
  const text = (key: string) => { if (typeof body[key] !== 'string') throw new SecurityError('permission_denied'); };
  switch (kind) {
    case 'task': exact(['instruction']); text('instruction'); break;
    case 'code': exact(['path', 'content']); text('path'); text('content'); break;
    case 'validation':
      exact(['evaluationId', 'metricId', 'split', 'value']); assertId(body.evaluationId); assertId(body.metricId);
      if (body.split !== 'validation' || typeof body.value !== 'number' || !Number.isFinite(body.value)) throw new SecurityError('permission_denied');
      break;
    case 'constraint':
      exact(['constraintId', 'evidenceId', 'satisfied']); assertId(body.constraintId); assertId(body.evidenceId);
      if (typeof body.satisfied !== 'boolean') throw new SecurityError('permission_denied');
      break;
    case 'acceptance':
      exact(['decisionId', 'resultId', 'status', 'explanation']); assertId(body.decisionId); assertId(body.resultId); text('explanation');
      if (body.status !== 'kept' && body.status !== 'discarded') throw new SecurityError('permission_denied');
      break;
    default: throw new SecurityError('permission_denied');
  }
  return body;
}
