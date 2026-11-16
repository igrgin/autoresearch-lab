import { assertId } from '../security/common';
import { ClaudeChoice, ClaudeFailure, validModelId } from './contracts';

export function validateChoice(choice: ClaudeChoice): ClaudeChoice {
  if (!choice || Object.keys(choice).sort().join(',') !== 'credentialId,integration,modelId' || choice.integration !== 'claude' || !validModelId(choice.modelId)) throw new ClaudeFailure('invalid_model');
  assertId(choice.credentialId);
  return { integration: 'claude', credentialId: choice.credentialId, modelId: choice.modelId };
}
