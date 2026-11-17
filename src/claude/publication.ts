import type { Sanitizer } from '../security/sanitizer';
import type { SafeRecording } from '../security/recording';
import { ClaudeFailure } from './contracts';
import type { SelectionCommand } from './store';
import { projectMetadata } from './host';

// One synchronous admission and ownership acquisition; the transport releases
// only after a durable reply, ordered writer barrier or confirmed utility exit.
export function ownClaudePublication(matcher: Sanitizer, recording: SafeRecording, command: SelectionCommand): () => void {
  const release = matcher.holdMatchingPolicy();
  try { recording.admitProviderProjection(projectMetadata(command)); return release; }
  catch { release(); throw new ClaudeFailure('capture_failed'); }
}
