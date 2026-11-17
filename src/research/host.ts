import type { ProjectCatalog } from '../catalog/catalog';
import type { ResearchAdmission } from './security-port';
import type { Owner, ResearchEvent } from './contracts';
import { assertId } from '../security/common';

export type ResearchRequest =
  | { kind: 'ingest'; owner: Owner; event: ResearchEvent }
  | { kind: 'receipt'; owner: Owner; event: ResearchEvent }
  | { kind: 'inspect' | 'agent_validation'; projectId: string; runId: string };
// Private host port: main/coordinator callers only. No renderer write endpoint.
export async function handleResearch(catalog: ProjectCatalog, admission: ResearchAdmission, request: ResearchRequest) {
  try {
    const projectId=(request.kind==='ingest'||request.kind==='receipt')?request.event.projectId:request.projectId;
    assertId(projectId);
    const store=catalog.research(projectId,admission);
    if (request.kind==='ingest') return {ok:true,value:await store.bind(request.owner).ingest(request.event)};
    if (request.kind==='receipt') return {ok:true,value:await store.bind(request.owner).receipt(request.event)};
    assertId(request.runId);
    if (request.kind==='inspect') return {ok:true,value:await store.inspect(request.runId)};
    if (request.kind==='agent_validation') return {ok:true,value:await store.agentValidation(request.runId)};
    throw new Error();
  } catch { return {ok:false,error:{code:'capture_failed',message:'Research history is unavailable. Reconcile storage and evidence before starting more work.',effect:'unknown',retry:'after_reconcile'}}; }
}
