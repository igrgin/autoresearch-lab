// Provider facts only. Discovery never grants a reservation or proves execution readiness.
export type Reported<T> = { availability: 'available'; value: T } |
  { availability: 'unavailable'; reason: 'not_reported' | 'invalid' | 'unverified_units' | 'requires_remote_check' };
export interface VastInstance {
  provider: 'vast'; resourceId: string; canonicalKey: string; accountId: string;
  actualState: Reported<string>; intendedState: Reported<string>; contractState: Reported<string>;
  nextContractState: Reported<string>; label: Reported<string>;
  hardware: { gpuCount: Reported<number>; gpuModel: Reported<string>; gpuMemory: Reported<number>;
    effectiveCpuCores: Reported<number>; diskGb: Reported<number> };
  capabilities: { discovery: 'available'; remoteAccess: 'unknown'; gpuInventory: 'unknown'; execution: 'unknown' };
  source: 'vast_rest_v1' | 'vast_rest_v0'; receivedAt: string; sourceTime: null;
}
export type VastFailure = 'invalid_credentials' | 'insufficient_scope' | 'two_factor_required' | 'session_expired' |
  'authentication_required' | 'unavailable' | 'rate_limited' | 'deadline_exceeded' | 'invalid_response' | 'unsafe_response' | 'not_found';
export interface VastError {
  code: 'authentication_required' | 'permission_denied' | 'unavailable' | 'rate_limited' | 'deadline_exceeded' | 'not_found';
  reason: VastFailure; origin: 'vast_adapter'; operationId: string; message: string; effect: 'none'; retry: 'never' | 'same_key';
}
export type VastReply<T> = { ok: true; value: T } | { ok: false; error: VastError };
export interface VastDiscovery {
  contractVersion: { major: 1; minor: 0 }; operationId: string; accountId: string;
  complete: true; instances: VastInstance[]; receivedAt: string;
}
export interface VastCredentialChoice { id: string; label: string }
