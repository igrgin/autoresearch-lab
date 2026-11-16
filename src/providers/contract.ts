// Provider-owned read projections. No credential values, live handles, reservations or
// execution facts belong in this contract. Account IDs are access metadata only.
export interface ResourceIdentity { provider: 'runpod'; resourceId: string }
export interface ProviderCapability {
  name: 'discovery' | 'direct_ssh' | 'gpu_inventory' | 'execution';
  version: 1;
  availability: 'available' | 'unavailable' | 'unknown';
  reason: 'read_verified' | 'not_inspected' | 'endpoint_reported_unverified' | 'endpoint_not_reported' | 'remote_preflight_required';
  observedAt: string;
  scope: 'account' | 'resource';
  integration: 'runpod-rest-v2';
}
export interface ProviderInstance {
  recordKind: 'provider_instance';
  schemaVersion: 1;
  owner: 'provider_adapter';
  identity: ResourceIdentity;
  accountId: string;
  reportedState: string;
  receivedAt: string; // Local receipt time; the API supplies no source sample time.
  source: 'runpod-rest-v2';
  allocation: { gpuType: string; gpuCount: number; systemRamGb: number | null; vcpuCount: number | null } | null;
  cudaVersion: string | null;
  capabilities: ProviderCapability[];
}
export type ProviderErrorCode = 'authentication_required' | 'permission_denied' | 'not_found' | 'rate_limited' |
  'unavailable' | 'deadline_exceeded' | 'invalid_response' | 'invalid_input' | 'capture_failed';
export interface ProviderError {
  code: ProviderErrorCode;
  origin: 'runpod_adapter';
  operationId: string;
  message: string;
  effect: 'none';
  retry: 'never' | 'same_key';
  retryAt?: string;
}
export interface Discovery {
  contractVersion: { major: 1; minor: 0 };
  operationId: string;
  accountId: string | null;
  receivedAt: string;
  complete: boolean;
  pages: number;
  items: ProviderInstance[];
  capabilities: ProviderCapability[];
  error?: ProviderError;
}
export type Inspection = { ok: true; instance: ProviderInstance } | { ok: false; error: ProviderError };
export interface RunpodCredential { id: string; label: string }
export type RunpodCredentials = { ok: true; credentials: RunpodCredential[] } | { ok: false; message: string };
