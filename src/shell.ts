// A read-only shell projection, not a run/adapter protocol or persistence schema.
export interface ShellStatus {
  coordinator: 'ready';
  sqliteVersion: string;
}

export interface ShellBridge {
  getStatus(): Promise<ShellStatus>;
}
