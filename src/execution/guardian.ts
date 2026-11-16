import { BoundReceipt, ClockReading, ExecutionBounds, Phase, validateReceipt } from './bounds';

// Implemented by a trusted, qualified launcher, never by candidate code. The
// scope covers launcher/ranks/loaders/compilers/inference and detached descendants.
export interface OwnedScope {
  seal(): boolean; // revoke every launch/mutation gate, including future additions
  cancel(phase: Phase): void;
  kill(): void; // entire recorded subtree, never the host/provider
  empty(): boolean | 'unknown';
}
export interface GuardianRecord {
  version: 1; scopeBinding: string; bounds: ReturnType<ExecutionBounds['snapshot']>;
  state: 'armed' | 'terminating' | 'confirmed_stopped' | 'unknown';
  admissionSealed: boolean; automaticPause: boolean; drainIntent: 'none' | 'pause' | 'finish'; trainingCutoff?: { receipt: BoundReceipt; state: 'terminating' | 'confirmed_stopped' | 'unknown'; sealed: boolean; cancellationDeadlineMs: number }; receipt?: BoundReceipt; cancellationDeadlineMs?: number;
  // Reservation owner consumes evidence; this component never releases anything.
  reservation: 'retain' | 'quiescence_evidence_available';
}
export class ExecutionGuardian {
  #record: GuardianRecord;
  #supervisorDeadline: number;
  #hardKillAt?: number;
  #killed = false;
  #trainingKilled = false;
  #trainingKillAt = 0;
  #recoveryCancellationCap = Infinity;
  constructor(private readonly bounds: ExecutionBounds, private readonly scope: OwnedScope,
    private readonly clock: () => ClockReading, private readonly persist: (record: GuardianRecord) => void, scopeBinding: string, private readonly trainingScope?: OwnedScope, restored?: GuardianRecord) {
    if (!/^(?:[0-9]+:[0-9]+|[0-9a-f-]{36})$/.test(scopeBinding)) throw new Error('Execution scope binding is unavailable.');
    const now = clock();
    this.#supervisorDeadline = now.ms + bounds.snapshot().policy.supervisorMs;
    this.#record = { version: 1, scopeBinding, bounds: bounds.snapshot(), state: 'armed', admissionSealed: false, automaticPause: false, drainIntent: 'none', reservation: 'retain' };
    if (restored) {
      if (Object.keys(restored).sort().join() !== ['version','scopeBinding','bounds','state','admissionSealed','automaticPause','drainIntent','reservation', ...(restored.receipt ? ['receipt'] : []), ...(restored.cancellationDeadlineMs !== undefined ? ['cancellationDeadlineMs'] : []), ...(restored.trainingCutoff ? ['trainingCutoff'] : [])].sort().join() || restored.version !== 1 || restored.scopeBinding !== scopeBinding || restored.bounds.bootId !== now.bootId ||
          !['armed', 'terminating', 'confirmed_stopped', 'unknown'].includes(restored.state) ||
          typeof restored.admissionSealed !== 'boolean' || typeof restored.automaticPause !== 'boolean' || !['none','pause','finish'].includes(restored.drainIntent) ||
          !['retain', 'quiescence_evidence_available'].includes(restored.reservation) ||
          (['terminating', 'unknown'].includes(restored.state) && (!restored.receipt || !Number.isFinite(restored.cancellationDeadlineMs)))) throw new Error('Execution recovery requires reconciliation.');
      if (restored.trainingCutoff && (Object.keys(restored.trainingCutoff).sort().join() !== 'cancellationDeadlineMs,receipt,sealed,state' ||
          typeof restored.trainingCutoff.sealed !== 'boolean' || !Number.isFinite(restored.trainingCutoff.cancellationDeadlineMs) ||
          !['terminating','confirmed_stopped','unknown'].includes(restored.trainingCutoff.state))) throw new Error('Execution recovery requires reconciliation.');
      if (restored.receipt) validateReceipt(restored.receipt);
      if (restored.trainingCutoff) validateReceipt(restored.trainingCutoff.receipt);
      if (restored.trainingCutoff) {
        const drain = restored.trainingCutoff;
        if (drain.receipt.reason !== 'training_deadline' || drain.receipt.deadlineMs !== restored.bounds.trainingDeadlineMs ||
            !['compilation','training','periodic_validation'].includes(drain.receipt.phase) || drain.receipt.observedMs < drain.receipt.deadlineMs ||
            drain.cancellationDeadlineMs !== drain.receipt.deadlineMs + bounds.snapshot().policy.cancellationMs ||
            (drain.state === 'confirmed_stopped' && !drain.sealed) ||
            (restored.bounds.trainingCutoff && (drain.state !== 'confirmed_stopped' || JSON.stringify(restored.bounds.trainingCutoff) !== JSON.stringify(drain.receipt)))) throw new Error('Execution recovery requires reconciliation.');
        if (drain.state !== 'confirmed_stopped') this.#recoveryCancellationCap = drain.cancellationDeadlineMs;
      } else if (restored.bounds.trainingCutoff) throw new Error('Execution recovery requires reconciliation.');
      if (restored.receipt && JSON.stringify(restored.receipt) !== JSON.stringify(restored.bounds.receipt)) throw new Error('Execution recovery requires reconciliation.');
      this.#record = structuredClone(restored);
      this.#record.bounds = bounds.snapshot();
      if (restored.cancellationDeadlineMs !== undefined) {
        if (!restored.receipt) throw new Error('Execution recovery requires reconciliation.');
        const policy = bounds.snapshot().policy;
        const receiptCap = Math.min(restored.receipt.deadlineMs, restored.receipt.observedMs) + policy.cancellationMs;
        const trainingCap = ['compilation','training','periodic_validation'].includes(restored.receipt.phase) && restored.bounds.trainingDeadlineMs !== undefined
          ? restored.bounds.trainingDeadlineMs + policy.cancellationMs : Infinity;
        if (restored.cancellationDeadlineMs < 0 || restored.cancellationDeadlineMs > Math.min(receiptCap, trainingCap, this.#recoveryCancellationCap)) throw new Error('Execution recovery requires reconciliation.');
        this.#hardKillAt = restored.cancellationDeadlineMs - bounds.snapshot().policy.cancellationMs / 2;
      }
      if (restored.trainingCutoff) this.#trainingKillAt = restored.trainingCutoff.cancellationDeadlineMs - bounds.snapshot().policy.cancellationMs / 2;
      // A returning guardian never grants launch authority for an old operation.
      if (this.#record.state === 'armed') {
        const expiry = bounds.inspect(now);
        if (!this.#record.trainingCutoff && expiry?.reason === 'training_deadline') {
          this.#recoveryCancellationCap = expiry.deadlineMs + bounds.snapshot().policy.cancellationMs;
        }
        bounds.expire('supervisor_lost', now);
        // Persist the capped whole-scope escalation before observing training
        // emptiness; a crash between those steps must retain the same limit.
        this.terminate(now);
        if (!this.#record.trainingCutoff && expiry?.reason === 'training_deadline') this.drainTraining(expiry, now);
      }
    }
    // Must be durable before the launcher may open a candidate gate.
    try { this.save(); } catch { this.failPersistence(now); }
    this.tick();
  }
  record(): GuardianRecord { return structuredClone(this.#record); }
  private save(): void { this.#record.bounds = this.bounds.snapshot(); this.persist(this.record()); }
  private failPersistence(now: ClockReading): void {
    this.bounds.expire('persistence_failed', now);
    this.terminate(now);
  }
  phase(phase: Phase, validationCallId?: string): number {
    this.tick();
    if (this.#record.state !== 'armed') throw new Error('Execution authority is fenced.');
    if ((this.#record.automaticPause || this.#record.drainIntent !== 'none') && ['preparation','agent','tool','repair'].includes(phase)) throw new Error('Execution authority is draining.');
    if (['compilation', 'training', 'periodic_validation'].includes(phase) && !this.trainingScope) throw new Error('Training containment is unavailable.');
    let value: number;
    try { value = this.bounds.enter(phase, this.clock(), validationCallId); } catch { this.tick(); throw new Error('Execution authority is fenced.'); }
    try { this.save(); } catch { this.failPersistence(this.clock()); throw new Error('Execution authority is fenced.'); }
    return value;
  }
  // The IPC host calls this only for a fresh guardian-issued challenge response.
  supervisorAlive(): void {
    this.tick();
    if (this.#record.state === 'armed') this.#supervisorDeadline = this.clock().ms + this.bounds.snapshot().policy.supervisorMs;
  }
  drain(intent: 'pause' | 'finish', admittedAttempt: boolean): void {
    if (!['pause','finish'].includes(intent)) throw new Error('Invalid drain intent.');
    if (this.#record.state !== 'armed') return;
    if (this.#record.drainIntent !== 'finish') this.#record.drainIntent = intent;
    if (!admittedAttempt) { this.stop('cancelled'); return; }
    try { this.save(); } catch { this.failPersistence(this.clock()); }
  }
  contactExpired(admittedAttempt: boolean): void {
    if (this.#record.automaticPause) return;
    this.#record.automaticPause = true;
    if (!admittedAttempt) { this.bounds.expire('contact_expired', this.clock()); this.terminate(this.clock()); return; }
    try { this.save(); } catch { this.failPersistence(this.clock()); }
  }
  supervisorLost(): void { this.stop('supervisor_lost'); }
  stop(reason: 'cancelled' | 'supervisor_lost'): void {
    if (this.#record.state === 'confirmed_stopped') return;
    const now = this.clock(); this.bounds.inspect(now); this.bounds.expire(reason, now); this.terminate(now);
  }
  // Work completion is not an evaluated experiment outcome. A terminal result
  // committed by another owner is never overwritten by publication/cleanup failure.
  complete(): void {
    this.tick();
    if (this.#record.state !== 'armed') return;
    try {
      this.#record.admissionSealed = this.scope.seal();
      if (!this.#record.admissionSealed || this.scope.empty() !== true) {
        this.bounds.expire('scope_unobservable', this.clock()); this.terminate(this.clock()); return;
      }
      this.#record.state = 'confirmed_stopped'; this.#record.reservation = 'quiescence_evidence_available'; this.save();
    } catch { this.#record.reservation = 'retain'; this.failPersistence(this.clock()); }
  }
  tick(): void {
    if (this.#record.state === 'confirmed_stopped') return;
    const now = this.clock();
    // Nested cutoff enforcement survives global fencing, including restoration
    // of an armed record. A new supervisor-loss receipt cannot replace its clock.
    if (this.#record.trainingCutoff && this.#record.trainingCutoff.state !== 'confirmed_stopped') {
      this.drainTraining(this.#record.trainingCutoff.receipt, now);
    }
    if (this.#record.state === 'armed') {
      const expiry = this.bounds.inspect(now);
      if (now.ms >= this.#supervisorDeadline) this.bounds.expire('supervisor_lost', now, this.#supervisorDeadline);
      if (expiry?.reason === 'training_deadline' && !this.#record.trainingCutoff && !this.bounds.snapshot().receipt) this.drainTraining(expiry, now);
      // A still-draining training deadline must not hide an expired outer cap.
      const snapshot = this.bounds.snapshot();
      const outerCap = Math.min(snapshot.outerDeadlineMs, snapshot.parentDeadlineMs);
      if (this.#record.trainingCutoff && now.ms >= outerCap) {
        this.bounds.expire(snapshot.outerDeadlineMs <= snapshot.parentDeadlineMs ? 'attempt_deadline' : 'parent_deadline', now, outerCap);
      }
      if (this.bounds.snapshot().receipt) this.terminate(now);
      return;
    }
    // Continue inspecting unknown scopes on reconciliation; elapsed time alone
    // never turns uncertainty into stopped or frees a reservation.
    const previousState = this.#record.state;
    try {
      if (this.#record.admissionSealed && this.scope.empty() === true) {
        this.#record.state = 'confirmed_stopped'; this.#record.reservation = 'quiescence_evidence_available'; this.save(); return;
      }
      if (!this.#killed && now.ms >= this.#hardKillAt!) { this.#killed = true; this.scope.kill(); }
    } catch { /* retain unknown effect, never expose platform/raw diagnostics */ }
    if (now.bootId !== this.bounds.snapshot().bootId || now.ms >= this.#record.cancellationDeadlineMs!) this.#record.state = 'unknown';
    if (this.#record.state !== previousState) {
      try { this.save(); } catch { this.#record.state = 'unknown'; this.#record.reservation = 'retain'; }
    }
  }
  private drainTraining(receipt: BoundReceipt, now: ClockReading): void {
    if (!this.trainingScope) { this.bounds.expire('scope_unobservable', now, receipt.deadlineMs); return; }
    const policy = this.bounds.snapshot().policy;
    if (!this.#record.trainingCutoff) {
      let sealed = false;
      try { sealed = this.trainingScope.seal(); } catch { /* no stop proof */ }
      this.#record.trainingCutoff = { receipt, state: 'terminating', sealed, cancellationDeadlineMs: Math.min(now.ms, receipt.deadlineMs) + policy.cancellationMs };
      this.#trainingKillAt = Math.min(now.ms, receipt.deadlineMs) + policy.cancellationMs / 2;
      try { this.trainingScope.cancel(receipt.phase); } catch { /* hard escalation */ }
    }
    const drain = this.#record.trainingCutoff;
    try {
      if (drain.sealed && this.trainingScope.empty() === true) {
        drain.state = 'confirmed_stopped';
        if (this.#record.state === 'armed' && !this.bounds.snapshot().receipt) this.bounds.trainingStopped(receipt, now);
        this.save(); return;
      }
      if (!this.#trainingKilled && now.ms >= this.#trainingKillAt) { this.#trainingKilled = true; this.trainingScope.kill(); }
    } catch { /* retain uncertainty */ }
    if (now.ms >= drain.cancellationDeadlineMs) { drain.state = 'unknown'; this.bounds.expire('scope_unobservable', now); }
    try { this.save(); } catch { this.failPersistence(now); }
  }
  private terminate(now: ClockReading): void {
    if (this.#record.state === 'terminating' || this.#record.state === 'unknown') return;
    const policy = this.bounds.snapshot().policy;
    this.#record.receipt = this.bounds.snapshot().receipt;
    this.#record.state = 'terminating'; this.#record.reservation = 'retain';
    const snapshot = this.bounds.snapshot();
    // A later global receipt cannot grant fresh cancellation time to charged
    // work whose training cutoff was already due before this guardian woke.
    const chargedCap = ['compilation','training','periodic_validation'].includes(snapshot.phase) && snapshot.trainingDeadlineMs !== undefined
      ? snapshot.trainingDeadlineMs + policy.cancellationMs : Infinity;
    const trainingCap = this.#record.trainingCutoff?.state !== 'confirmed_stopped'
      ? this.#record.trainingCutoff?.cancellationDeadlineMs ?? chargedCap : Infinity;
    this.#record.cancellationDeadlineMs = Math.min(Math.min(now.ms, this.#record.receipt!.deadlineMs) + policy.cancellationMs,
      trainingCap, this.#recoveryCancellationCap);
    // Graceful cancellation consumes half the fixed escalation interval.
    this.#hardKillAt = this.#record.cancellationDeadlineMs - policy.cancellationMs / 2;
    try { this.#record.admissionSealed = this.scope.seal(); } catch { this.#record.admissionSealed = false; }
    try { this.scope.cancel(this.#record.receipt!.phase); } catch { /* escalation remains armed */ }
    if (now.ms >= this.#hardKillAt) {
      this.#killed = true; try { this.scope.kill(); } catch { /* unknown until observed */ }
    }
    if (now.ms >= this.#record.cancellationDeadlineMs) this.#record.state = 'unknown';
    try { this.save(); } catch {
      // Lost evidence storage cannot allow unbounded continued execution.
      this.#killed = true;
      try { this.scope.kill(); } catch { /* unknown until independent empty proof */ }
    }
  }
}
