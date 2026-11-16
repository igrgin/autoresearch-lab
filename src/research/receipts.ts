import { SecurityError } from '../security/common';
import { CAPTURE_PATHS } from '../security/recording-paths';
import { validateEvent, type Owner, type ResearchEvent } from './contracts';

// A private owner port for receipts of already-admitted work. These fixed codes
// carry no prose, raw diagnostics, agent output, or permission to launch/Resume.
export function validateReceipt(event: ResearchEvent, owner: Owner): void {
  validateEvent(event,owner);
  const f=event.fact;
  if (event.contractVersion.major!==1) throw new SecurityError('invalid_input');
  if (f.kind==='control' && f.command!=='resume' && f.explanation==='safe_control_receipt') return;
  if (f.kind==='outcome' && f.explanation==='safe_terminal_receipt') return;
  if (f.kind==='activity' && [...CAPTURE_PATHS,'auth','headers','credential_file','environment','raw_provider','raw_sdk','native_history'].includes(f.source) &&
      f.type==='omitted' && f.status==='unavailable' && f.sourceTime===null && f.detail===null) return;
  throw new SecurityError('invalid_input');
}
