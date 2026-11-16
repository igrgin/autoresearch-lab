import type { ConfigurationDraft, ConfigurationReply, ConfigurationSnapshot, DefaultsRecord, SaveConfiguration, UpdateDefaults } from './configuration';
export interface ConfigurationBridge {
  getGlobalDefaults(): Promise<ConfigurationReply<DefaultsRecord>>;
  updateGlobalDefaults(input: UpdateDefaults): Promise<ConfigurationReply<DefaultsRecord>>;
  getProjectDefaults(projectId: string): Promise<ConfigurationReply<DefaultsRecord>>;
  updateProjectDefaults(projectId: string, input: UpdateDefaults): Promise<ConfigurationReply<DefaultsRecord>>;
  prepareConfiguration(projectId: string): Promise<ConfigurationReply<ConfigurationDraft>>;
  saveConfiguration(input: SaveConfiguration): Promise<ConfigurationReply<ConfigurationSnapshot>>;
  listConfigurations(projectId: string): Promise<ConfigurationReply<ConfigurationSnapshot[]>>;
  getConfiguration(projectId: string, snapshotId: string): Promise<ConfigurationReply<ConfigurationSnapshot>>;
}
