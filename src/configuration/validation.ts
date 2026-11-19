import { CHOICE_KEYS, type ChoiceOverrides } from '../configuration';
import { Sanitizer } from '../security/sanitizer';

// Never silently redact a semantic setting and save a different choice. Reject it.
export function assertSafeConfiguration(value: unknown, sanitizer: Sanitizer): void {
  if (sanitizer.filter(value).redacted) throw new Error('Unsafe configuration content.');
}
export function validateOverrides(value: unknown): ChoiceOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !CHOICE_KEYS.includes(key as typeof CHOICE_KEYS[number]))) throw new Error();
  const input = value as ChoiceOverrides;
  const result: ChoiceOverrides = {};
  for (const key of CHOICE_KEYS) {
    if (!Object.hasOwn(input, key)) continue;
    const item = input[key];
    if (key === 'agent') {
      const agent = item as ChoiceOverrides['agent'];
      if (agent !== null && (!agent || typeof agent !== 'object' || Array.isArray(agent) ||
          Object.keys(agent).sort().join(',') !== 'integration,model' || !['codex', 'claude'].includes(agent.integration) ||
          (agent.model !== null && (typeof agent.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(agent.model))))) throw new Error();
      result.agent = agent === null ? null : { integration: agent!.integration, model: agent!.model };
    } else if (key === 'trainingDurationSeconds') {
      if (item !== null && (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0)) throw new Error();
      result.trainingDurationSeconds = item as number | null;
    } else {
      if (item !== null && (typeof item !== 'string' || !item.trim() || item.length > 2000 || Array.from(item).some(char => (char.charCodeAt(0) < 32 && char !== '\n' && char !== '\t') || char.charCodeAt(0) === 127))) throw new Error();
      result.objective = item as string | null;
    }
  }
  assertSafeConfiguration(result, new Sanitizer());
  return result;
}
