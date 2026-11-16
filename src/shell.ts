import type { ConfigurationBridge } from './configuration-bridge';
import type { ImportAction, ImportRecord, ImportSelection, StartImport } from './imports';
import type { CreateProject, ProjectRecord, ProjectReply, WorkspaceProjects } from './projects';
import type { Discovery, Inspection, RunpodCredentials } from './providers/contract';
import type { VastCredentialChoice, VastDiscovery, VastReply } from './providers/vast-contract';

export interface ShellStatus {
  coordinator: 'ready';
  sqliteVersion: string;
}

export interface ShellBridge extends ConfigurationBridge {
  selectImportSource(kind: 'directory' | 'files'): Promise<ImportSelection | null>;
  startImport(projectId: string, input: StartImport): Promise<ProjectReply<ImportRecord[]>>;
  listImports(projectId: string): Promise<ProjectReply<ImportRecord[]>>;
  importAction(projectId: string, importId: string, expectedRevision: number, action: ImportAction): Promise<ProjectReply<ImportRecord[]>>;
  runpodCredentials(): Promise<RunpodCredentials>;
  discoverRunpod(credentialId: string): Promise<Discovery>;
  inspectRunpod(credentialId: string, resourceId: string): Promise<Inspection>;
  openCredentialSettings(): Promise<void>;
  listVastCredentials(): Promise<VastReply<VastCredentialChoice[]>>;
  discoverVast(credentialId: string): Promise<VastReply<VastDiscovery>>;
  openVastSettings(): Promise<void>;
  getStatus(): Promise<ShellStatus>;
  listProjects(): Promise<ProjectReply<WorkspaceProjects>>;
  createProject(input: CreateProject): Promise<ProjectReply<ProjectRecord>>;
  openProject(projectId: string): Promise<ProjectReply<ProjectRecord>>;
  recoverProject(projectId: string): Promise<ProjectReply<ProjectRecord>>;
  revealProjectRepository(projectId: string): Promise<ProjectReply<null>>;
  revealProject(projectId: string): Promise<ProjectReply<null>>;
  copyWorkspaceLocation(): Promise<ProjectReply<null>>;
  copyProjectRepository(projectId: string): Promise<ProjectReply<null>>;
  copyProjectLocation(projectId: string): Promise<ProjectReply<null>>;
}
