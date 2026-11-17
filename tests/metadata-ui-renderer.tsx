import React from 'react';
import { createRoot } from 'react-dom/client';
import { Compute } from '../src/renderer/compute';
import { VastCompute } from '../src/renderer/vast-compute';
import { CodexSettings, RunAgentSettings } from '../src/renderer/codex-settings';
import { ClaudeSettingsPanel } from '../src/renderer/claude-settings';
import { DatasetImportPanel } from '../src/renderer/dataset-imports';
const mode = new URLSearchParams(location.search).get('mode');
const projectId = '00000000-0000-4000-8000-000000000001';
const mount = () => createRoot(document.getElementById('root')!).render(mode === 'runpod' ? <Compute /> : mode === 'vast' ? <VastCompute /> : mode === 'codex' ? <CodexSettings /> : mode === 'codex-run' ? <RunAgentSettings /> : mode === 'claude' ? <ClaudeSettingsPanel /> : mode === 'claude-run' ? <ClaudeSettingsPanel runConfiguration /> : <DatasetImportPanel projectId={projectId} />);

void (window.lab.metadataReady?.() ?? Promise.resolve()).finally(mount);
