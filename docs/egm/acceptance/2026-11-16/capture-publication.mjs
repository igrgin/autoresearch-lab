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
  const matcher=new Sanitizer(), key=randomBytes(32);
  const credentials=new CredentialService(new PrivateFiles(path.join(directory,'vault')),{
    available:async()=>true,
    encrypt:async text=>{const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()]);},
    decrypt:async bytes=>{const c=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));c.setAuthTag(bytes.subarray(-16));return Buffer.concat([c.update(bytes.subarray(12,-16)),c.final()]).toString();},
  },matcher);await credentials.initialize();
  const files=new PrivateFiles(path.join(directory,'records'));const recording=new SafeRecording(files,matcher,id=>credentials.revoke(id));await recording.initialize();
  const id=randomUUID(),canary='ConcurrentCaptureFamilyValue';let started;const entered=new Promise(resolve=>{started=resolve;});
  const read=files.read.bind(files);files.read=async name=>{const bytes=await read(name);if(name===`${id}.json`){started();await gate;}return bytes;};
  const meta={projectId:randomUUID(),runId:randomUUID(),actionId:randomUUID(),operationId:randomUUID(),eventId:id,producerId:randomUUID(),streamId:randomUUID(),sequence:0,source:'model_metadata',kind:'activity',status:'completed'};
  const capture=recording.capture(meta,{modelId:canary});await entered;
  let recognized=false;const registration=credentials.register('model_download',randomUUID(),'Controlled family verification',canary).then(()=>{recognized=true;});
  let timer;await Promise.race([registration,new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);clearTimeout(timer);
  const recognizedBeforeWrite=recognized;resume();await capture;await registration;
  const bytes=await readFile(path.join(directory,'records',`${id}.json`));
  const result={consumer:'SafeRecording.capture',head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),recognizedBeforeWrite,rawSyntheticValuePersisted:bytes.includes(Buffer.from(canary)),beforeReadTimeQuarantine:true,expected:'registered matching material must not be newly persisted after admission becomes stale',qualification:'real shared credential service, AES-encrypted synthetic vault and actual PrivateFiles write; no live services'};
  await writeFile(path.join(root,'docs/egm/goldfish_reviews/2026-11-16-open-prs/family-verification/capture-publication.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  assert.equal(recognizedBeforeWrite && result.rawSyntheticValuePersisted,false,'shared capture persisted a value recognized before its write');
} finally {resume();await rm(directory,{recursive:true,force:true});}
