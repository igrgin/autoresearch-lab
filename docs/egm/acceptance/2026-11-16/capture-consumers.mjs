import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const root=process.cwd(), directory=await mkdtemp(path.join(os.tmpdir(),'lab-family-capture-')); const build=path.join(directory,'build');
let resume;const gate=new Promise(resolve=>{resume=resolve;});
try {
  execFileSync(path.join(root,'node_modules/.bin/tsc'),['--noEmit','false','--rootDir','.', '--outDir',build],{cwd:root,stdio:'pipe'});
  const require=createRequire(import.meta.url);
  const {PrivateFiles}=require(path.join(build,'src/security/private-files.js'));
  const {Sanitizer}=require(path.join(build,'src/security/sanitizer.js'));
  const {CredentialService}=require(path.join(build,'src/security/credentials.js'));
  const {SafeRecording}=require(path.join(build,'src/security/recording.js'));
  const results=[]; for (const consumer of ['direct','stream','recorded_operation','claude_catalog']) {
  const base=path.join(directory,consumer); const matcher=new Sanitizer(), key=randomBytes(32);
  const credentials=new CredentialService(new PrivateFiles(path.join(base,'vault')),{
    available:async()=>true,
    encrypt:async text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()]);},
    decrypt:async bytes=>{const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(-16));return Buffer.concat([c.update(bytes.subarray(12,-16)),c.final()]).toString();},
  },matcher);await credentials.initialize();
  const files=new PrivateFiles(path.join(base,'records'));const recording=new SafeRecording(files,matcher,id=>credentials.revoke(id));await recording.initialize();
  const id=randomUUID(),canary='claude-family-capture-20261116';let target=id;let localResume;const localGate=new Promise(resolve=>{localResume=resolve;});let started;const entered=new Promise(resolve=>{started=resolve;});
  const read=files.read.bind(files);files.read=async name=>{const bytes=await read(name);if(/^[0-9a-f-]{36}\.json$/.test(name)){target=name.slice(0,-5);started();await localGate;}return bytes;};
  const meta={projectId:randomUUID(),runId:randomUUID(),actionId:randomUUID(),operationId:randomUUID(),eventId:id,producerId:randomUUID(),streamId:randomUUID(),sequence:0,source:'model_metadata',kind:'activity',status:'completed'};

  const entry=await credentials.register(consumer==='claude_catalog'?'anthropic':'model_download',randomUUID(),'Initial fixture access','synthetic-initial-capture-worker-access');
  let capture;
  if(consumer==='stream'){const {CaptureStream}=require(path.join(build,'src/security/recording.js'));const stream=new CaptureStream(recording,meta,'json');stream.push(Buffer.from(JSON.stringify({modelId:canary})));capture=stream.finish();}
  else if(consumer==='claude_catalog'){
    const {ClaudeHost}=require(path.join(build,'src/claude/host.js'));
    const host=new ClaudeHost(credentials,recording,async()=>{},async input=>({catalog:{credentialId:input.credentialId,observedAt:new Date().toISOString(),complete:true,source:'anthropic_models+sdk_supportedModels',sdkVersion:'0.3.323',models:[{id:canary,lifecycle:'active'}]}}),async()=>null,async()=>true);
    capture=host.discover(entry.id);
  }else if(consumer==='recorded_operation'){
    const {bindRecordedOperation}=require(path.join(build,'src/security/operations.js'));
    capture=bindRecordedOperation(credentials,recording,{component:'model_fetcher',credentialId:entry.id,accountId:entry.accountId,purpose:'model_fetch',scope:meta},meta,async()=>({modelId:canary})).execute(meta);
  }else capture=recording.capture(meta,{modelId:canary});
  await entered;

  let recognized=false;const registration=credentials.register('model_download',randomUUID(),'Controlled family verification',canary).then(()=>{recognized=true;});
  let timer;await Promise.race([registration,new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);clearTimeout(timer);
  const recognizedBeforeWrite=recognized;localResume();await capture;await registration;
  const bytes=await readFile(path.join(base,'records',`${target}.json`));
  const result={consumer,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),recognizedBeforeWrite,rawSyntheticValuePersisted:bytes.includes(Buffer.from(canary)),beforeReadTimeQuarantine:true,expected:'registered matching material must not be newly persisted after admission becomes stale',qualification:'real shared credential service, AES-encrypted synthetic vault and actual PrivateFiles write; no live services'};
  results.push(result); console.log(JSON.stringify(result));
  }
  await writeFile(path.join(root,'docs/egm/goldfish_reviews/2026-11-16-open-prs/family-verification/capture-consumers.json'),JSON.stringify(results,null,2)+'\n');
  assert.equal(results.some(r=>r.recognizedBeforeWrite&&r.rawSyntheticValuePersisted),false,'direct capture consumers persisted newly recognized values');

} finally {resume();await rm(directory,{recursive:true,force:true});}
