// Preparation-owned, renderer-safe byte-import contract. No dataset payloads or
// source paths cross this projection. Semantic task/split readiness is separate.
export interface ImportRecord {
  recordKind: 'dataset_import';
  schemaVersion: 1;
  owner: 'project_preparation';
  importId: string;
  operationId: string;
  projectId: string;
  revision: number;
  mode: 'copy' | 'move';
  destination: string;
  state: 'inventorying' | 'copying' | 'verifying' | 'publishing' | 'partial' | 'complete' | 'cleanup_pending' | 'cleaning' | 'discarded';
  totalBytes: number;
  completedBytes: number;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  remainingSourceFiles: number;
  bytesUsable: boolean;
  researchReadiness: 'not_prepared';
  preparationRef: string | null;
  problem: string | null;
}
export interface ImportSelection { selectionId: string; fileCount: number; directory: boolean }
export interface StartImport { requestId: string; selectionId: string; destinationName: string; mode: 'copy' | 'move' }
export type ImportAction = 'retry' | 'cancel' | 'discard' | 'retry_cleanup';
export type ImportRequest =
  | { kind: 'imports:list'; operationId: string; projectId: string }
  | { kind: 'imports:start'; operationId: string; projectId: string; sourcePaths: string[]; destinationName: string; mode: 'copy' | 'move' }
  | { kind: 'imports:action'; operationId: string; projectId: string; importId: string; expectedRevision: number; action: ImportAction };
