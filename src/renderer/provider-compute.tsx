import React, { useState } from 'react';
import { Compute } from './compute';
import { VastCompute } from './vast-compute';

export function ProviderCompute() {
  const [provider, setProvider] = useState<'runpod' | 'vast'>('runpod');
  return <>
    <div role="tablist" aria-label="Compute provider">
      <button role="tab" aria-selected={provider === 'runpod'} onClick={() => setProvider('runpod')}>Runpod</button>
      <button role="tab" aria-selected={provider === 'vast'} onClick={() => setProvider('vast')}>Vast.ai</button>
    </div>
    {provider === 'runpod' ? <Compute /> : <VastCompute />}
  </>;
}
