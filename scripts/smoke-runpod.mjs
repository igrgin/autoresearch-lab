import assert from 'node:assert/strict';

export async function smokeRunpod(application, page) {
  // Intercept the actual main-process HTTPS transport, leaving scoped vault access,
  // adapter parsing/admission, sender checks, preload and UI intact. No live requests.
  await application.evaluate(async () => {
    const https = process.getBuiltinModule('node:https');
    const { EventEmitter } = process.getBuiltinModule('node:events');
    const { PassThrough } = process.getBuiltinModule('node:stream');
    globalThis.runpodCalls = [];
    globalThis.runpodMode = 'full';
    globalThis.originalRunpodRequest = https.request;
    https.request = (url, options, callback) => {
      if (url.origin !== 'https://api.runpod.io' || options.method !== 'GET' || options.agent !== false || options.rejectUnauthorized !== true || options.headers.authorization !== 'Bearer synthetic-replacement-integration-check') throw new Error('Unexpected provider transport');
      // Retain route/method only, never headers or the entered synthetic key.
      globalThis.runpodCalls.push(url.pathname + url.search);
      const request = new EventEmitter();
      request.end = () => {
        queueMicrotask(() => {
          const response = new PassThrough();
          response.statusCode = 200; response.headers = { 'content-type': 'application/json' };
          let body;
          const pod = id => ({ id, status: 'RUNNING', gpu: { id: 'NVIDIA RTX 4090', count: 1, memory: 64, vcpuCount: 8 },
            cudaVersion: null, env: { secret: 'synthetic-replacement-integration-check' }, args: 'synthetic-replacement-integration-check' });
          if (globalThis.runpodMode === 'invalid') { response.statusCode = 401; body = { error: 'synthetic-replacement-integration-check' }; }
          else if (url.pathname === '/v2/account') body = { id: 'smoke_account', email: 'unretained@example.invalid' };
          else if (url.pathname === '/v2/pods/smoke_pod_1') body = { ...pod('smoke_pod_1'), status: 'EXITED', ssh: { direct: null } };
          else if (url.pathname !== '/v2/pods') { response.statusCode = 404; body = {}; }
          else if (globalThis.runpodMode === 'empty') body = { pods: [], pagination: { nextCursor: null, hasNextPage: false } };
          else if (url.search) {
            if (globalThis.runpodMode === 'partial') { response.statusCode = 403; body = { secret: 'synthetic-replacement-integration-check' }; }
            else body = { pods: [pod('smoke_pod_2')], pagination: { nextCursor: null, hasNextPage: false } };
          } else body = { pods: [pod('smoke_pod_1')], pagination: { nextCursor: 'smoke_next', hasNextPage: true } };
          callback(response); response.end(JSON.stringify(body));
        });
      };
      return request;
    };
  });
  try {
    await page.getByRole('button', { name: 'Compute', exact: true }).click();
    await page.getByRole('button', { name: 'Connect and discover', exact: true }).waitFor();
    const opening = application.waitForEvent('window');
    await page.getByRole('button', { name: 'Credential settings', exact: true }).click();
    const settings = await opening;
    await settings.getByRole('heading', { name: 'Credential settings', exact: true }).waitFor();
    await settings.close();
    assert.equal(await page.getByLabel('Runpod credential').locator('option').count(), 1);
    await page.getByRole('button', { name: 'Connect and discover', exact: true }).click();
    await page.getByRole('heading', { name: 'Pod smoke_pod_2', exact: true }).waitFor();
    assert.equal(await page.getByText('SSH and execution: unverified.', { exact: false }).count(), 2);
    assert.deepEqual(await application.evaluate(() => globalThis.runpodCalls), ['/v2/account', '/v2/pods', '/v2/pods?cursor=smoke_next']);
    await page.getByRole('button', { name: 'Refresh details for smoke_pod_1', exact: true }).click();
    const detail = page.getByRole('region', { name: 'Pod detail' });
    await detail.getByText(/Reported state: EXITED/).waitFor();
    await detail.getByText('No direct SSH endpoint reported in this detail response.', { exact: true }).waitFor();
    await application.evaluate(() => { globalThis.runpodMode = 'partial'; });
    await page.getByRole('button', { name: 'Refresh Pods', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Runpod access denied.' }).waitFor();
    await page.getByText(/Showing the last complete discovery/).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Pod smoke_pod_2', exact: true }).count(), 1);
    assert.equal(await page.getByRole('heading', { name: 'No running GPU Pods', exact: true }).count(), 0);
    await application.evaluate(() => { globalThis.runpodMode = 'invalid'; });
    await page.getByRole('button', { name: 'Refresh Pods', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Runpod authentication failed.' }).waitFor();
    assert.ok(!(await page.locator('body').innerText()).includes('synthetic-replacement-integration-check'));
    await application.evaluate(() => { globalThis.runpodMode = 'empty'; });
    await page.getByRole('button', { name: 'Refresh Pods', exact: true }).click();
    await page.getByRole('heading', { name: 'No running GPU Pods', exact: true }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Autoresearch Lab').setContentSize(760, 650));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Autoresearch Lab').setContentSize(1180, 780));
  } finally {
    await application.evaluate(async () => { process.getBuiltinModule('node:https').request = globalThis.originalRunpodRequest; });
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
  }
}
