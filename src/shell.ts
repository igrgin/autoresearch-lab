import type { CreateProject, ProjectRecord, ProjectReply, WorkspaceProjects } from './projects';

export interface ShellStatus {
  coordinator: 'ready';
  sqliteVersion: string;
}

export interface ShellBridge {
  getStatus(): Promise<ShellStatus>;
  listProjects(): Promise<ProjectReply<WorkspaceProjects>>;
  createProject(input: CreateProject): Promise<ProjectReply<ProjectRecord>>;
  openProject(projectId: string): Promise<ProjectReply<ProjectRecord>>;
  recoverProject(projectId: string): Promise<ProjectReply<ProjectRecord>>;
}
