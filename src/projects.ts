// Renderer-safe project catalog projections. Storage and Electron types stay private.
export interface ProjectRecord {
  recordKind: 'project';
  schemaVersion: 1;
  owner: 'project_catalog';
  revision: number;
  projectId: string;
  name: string;
  location: string;
  repository: string;
  taskRef: null; // Task/data preparation is owned by its later implementation slice.
  createdAt: string;
}

export interface ProjectEntry {
  project: ProjectRecord;
  availability: 'ready' | 'incomplete' | 'unavailable';
  problem?: string;
}

export interface WorkspaceProjects {
  projectsFolder: string;
  projects: ProjectEntry[];
}

export interface CreateProject {
  requestId: string;
  name: string;
  folderName: string;
}

export interface ProjectError {
  code: 'invalid_input' | 'conflict' | 'not_found' | 'permission_denied' | 'unavailable' | 'incompatible_version' | 'internal' | 'idempotency_conflict';
  origin: 'project_catalog' | 'dataset_import';
  operationId: string;
  message: string;
  effect: 'none' | 'partial' | 'unknown';
  retry: 'never' | 'after_reconcile' | 'same_key';
}

export type ProjectReply<T> = { ok: true; value: T } | { ok: false; error: ProjectError };

export type ProjectRequest =
  | { kind: 'list'; operationId: string }
  | { kind: 'create'; operationId: string; input: CreateProject }
  | { kind: 'open'; operationId: string; projectId: string }
  | { kind: 'recover'; operationId: string; projectId: string };
