import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { app, utilityProcess } from 'electron';
import Database from 'better-sqlite3';
import { CredentialService } from '../src/security/credentials';
import { PrivateFiles } from '../src/security/private-files';
import { SafeRecording } from '../src/security/recording';
import { Sanitizer } from '../src/security/sanitizer';
import { newId } from '../src/security/common';
import { SelectionClient } from '../src/claude/selection-client';
import { ownClaudePublication } from '../src/claude/publication';
import type { SelectionCommand, SelectionValue } from '../src/claude/store';
import type { ClaudeReply } from '../src/claude/contracts';
void app.whenReady().then(async () => {
  for (const kind of ['save','save_run'] as const) for (const mode of ['normal','barrier','exit']) {
    const directory = path.join(app.getPath('userData'), `${kind}-${mode}`); await mkdir(directory, { recursive: true });
    const matcher = new Sanitizer(), key = randomBytes(32);
    const credentials = new CredentialService(new PrivateFiles(path.join(directory, 'vault')), {
      available: async () => true,
      encrypt: async value => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]); },
      decrypt: async value => { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0,12)); cipher.setAuthTag(value.subarray(-16)); return Buffer.concat([cipher.update(value.subarray(12,-16)),cipher.final()]).toString(); },
    }, matcher); await credentials.initialize();
    const recording = new SafeRecording(new PrivateFiles(path.join(directory, 'records')), matcher, id => credentials.revoke(id)); await recording.initialize();
    const child = utilityProcess.fork(path.join(__dirname, 'claude-publication-worker.cjs'), [directory, mode]); let exited = false;
    const client = new SelectionClient(message => child.postMessage(message), undefined, mode === 'normal' ? 5000 : 100,
      command => ownClaudePublication(matcher, recording, command));
    let queue!: () => void, commit!: () => void;
    const queued = new Promise<void>(resolve => { queue = resolve; }); const committed = new Promise<void>(resolve => { commit = resolve; });
    child.on('message', (message: {id?: string; reply?: ClaudeReply<SelectionValue>; queued?: boolean; committed?: boolean; ok?: boolean}) => {
      if (message.queued) queue(); if (message.committed) { assert.equal(message.ok,true); commit(); }
      if (message.id && message.reply) client.receive(message.id,message.reply);
    });
    const closed = new Promise<void>(resolve => child.once('exit', () => { exited = true; client.unavailable(); resolve(); }));
    let registration: Promise<unknown> | undefined;
    try {
      await new Promise<void>((resolve,reject) => { const timer=setTimeout(()=>reject(new Error('Controlled utility bootstrap failed')),10000);child.once('message', (message:{ready?:boolean})=>{clearTimeout(timer);assert.equal(message.ready,true);resolve();}); });
      const modelId='claude-publication-fixture',choice={integration:'claude' as const,credentialId:newId(),modelId};
      const command:SelectionCommand=kind==='save'?{kind,requestId:newId(),choice,expectedRevision:0,observedAt:new Date().toISOString()}:
        {kind,snapshot:{...choice,recordKind:'run_agent_configuration',schemaVersion:1,owner:'run_configuration',projectId:newId(),runId:newId(),snapshotId:newId(),createdAt:new Date().toISOString(),catalogObservedAt:new Date().toISOString()}};
      const saving=client.request(command); const outcome=saving.then(value=>({ok:true as const,value}),error=>({ok:false as const,error})); await queued;
      let started!:()=>void, changed=false;const entered=new Promise<void>(resolve=>{started=resolve;});const original=matcher.registerWhenMutable.bind(matcher);
      matcher.registerWhenMutable=async(id,value)=>{started();await original(id,value);changed=true;};
      registration=credentials.register('model_download',newId(),'Concurrent metadata fixture',modelId);await entered;await new Promise(resolve=>setImmediate(resolve));assert.equal(changed,false);
      if(mode!=='normal'){const failed=await outcome;assert.ok(!failed.ok);assert.equal(failed.error.effect,'unknown');assert.equal(changed,false);}
      await writeFile(path.join(directory,'commit-gate'),'go');await committed;
      if(mode==='exit'){assert.equal(changed,false);child.kill();await closed;}else{await outcome;}
      await registration;assert.equal(changed,true);
      const db=new Database(path.join(directory,'agent-settings.sqlite'),{readonly:true});
      try{const table=kind==='save'?'agent_selection':'run_agent_inputs';const rows=db.prepare(`SELECT body FROM ${table}`).all() as {body:string}[];assert.equal(rows.length,1);assert.ok(rows[0].body.includes(modelId));if(kind==='save')assert.equal((db.prepare('SELECT count(*) AS n FROM save_requests').get() as {n:number}).n,1);}
      finally{db.close();}
    } finally { if(!exited)child.kill();await closed;await registration; }
  }
  console.log('Claude native main/utility publication: 6 passed; matching blocked through commit, timeout/FIFO barrier and confirmed exit.');app.exit(0);
}).catch(()=>{console.error('Controlled Claude publication regression failed.');app.exit(1);});
