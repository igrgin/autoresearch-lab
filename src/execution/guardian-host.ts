import { randomUUID } from 'node:crypto';
import { ClockReading, ContactAuthority, Phase } from './bounds';
import { ExecutionGuardian } from './guardian';

// Private IPC with the authenticated supervisor, never exposed to a renderer or
// candidate. A responsive socket does not renew controller contact automatically.
export function serveGuardian(guardian: ExecutionGuardian, clock: () => ClockReading, epoch: number, admittedAttempt = false): void {
  const contact = new ContactAuthority(epoch, clock().bootId, clock().ms);
  let challenge = ''; let challengeDeadline = 0; let contactChallenge = contact.challenge(clock());
  let lastChallenge = -Infinity; let contactLatched = false; let busy = false;
  const send = (value: unknown) => { if (process.connected) process.send?.(value, () => undefined); };
  const checkContact = () => {
    if (!contact.allowed(clock()) && !contactLatched) {
      contactLatched = true; guardian.contactExpired(admittedAttempt); send({ kind: 'automatic_pause', reason: 'contact_expired' });
    }
  };
  const timer = setInterval(() => {
    guardian.tick();
    checkContact();
    const now = clock();
    if (now.ms - lastChallenge >= 5_000) {
      lastChallenge = now.ms; challenge = randomUUID(); challengeDeadline = now.ms + 5_000;
      if (contact.allowed(now)) contactChallenge = contact.challenge(now);
      send({ kind: 'challenge', supervisorChallenge: challenge, contactChallenge });
    }
    if (guardian.record().state === 'confirmed_stopped') { send({ kind: 'stopped', record: guardian.record() }); clearInterval(timer); process.disconnect?.(); }
  }, 20);
  process.on('disconnect', () => guardian.supervisorLost());
  process.on('message', (raw: unknown) => {
    if (busy || !raw || typeof raw !== 'object' || JSON.stringify(raw).length > 4096) { guardian.supervisorLost(); return; }
    busy = true;
    try {
      guardian.tick(); checkContact();
      const message = raw as { kind?: string; requestId?: string; phase?: Phase; validationCallId?: string; intent?: 'pause' | 'finish'; challenge?: string; epoch?: number; sequence?: number };
      switch (message.kind) {
        case 'supervisor_alive':
          if (message.challenge !== challenge || !challenge || clock().ms >= challengeDeadline) throw new Error();
          challenge = ''; guardian.supervisorAlive(); break;
        case 'renew_contact': contact.renew(message.epoch!, message.sequence!, clock()); break;
        case 'phase':
          if (Object.keys(message).some(key => !['kind','phase','validationCallId','requestId'].includes(key))) throw new Error();
          guardian.phase(message.phase!, message.validationCallId); break;
        case 'drain': guardian.drain(message.intent!, admittedAttempt); break;
        case 'cancel': guardian.stop('cancelled'); break;
        case 'complete': guardian.complete(); break;
        case 'inspect': break; // no time/authority renewal
        default: throw new Error();
      }
      send({ kind: 'receipt', request: message.kind, requestId: message.requestId, record: guardian.record(), admissionAllowed: contact.allowed(clock()) && guardian.record().state === 'armed' && guardian.record().drainIntent === 'none' && !guardian.record().automaticPause });
    } catch { send({ kind: 'rejected', requestId: (raw as { requestId?: string }).requestId, code: 'conflict' }); }
    finally { busy = false; }
  });
  send({ kind: 'armed', record: guardian.record() });
}
