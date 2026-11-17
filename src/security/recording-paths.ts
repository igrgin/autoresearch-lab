export const CAPTURE_PATHS = ['prompt', 'assistant', 'command', 'argv', 'cwd', 'stdout', 'stderr', 'tool_arguments', 'tool_result',
  'vendor_error', 'stack', 'file_name', 'file_content', 'diff', 'git_message', 'attachment', 'summary', 'metric', 'model_metadata', 'log', 'provider_projection'] as const;
export type CapturePath = typeof CAPTURE_PATHS[number] | 'auth' | 'headers' | 'credential_file' | 'environment' | 'raw_provider' | 'raw_sdk' | 'native_history';
