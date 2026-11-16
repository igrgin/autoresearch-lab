import { randomUUID as id } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SafeRecording } from '../src/security/recording';
import { Sanitizer } from '../src/security/sanitizer';
import { PrivateFiles } from '../src/security/private-files';
import { ProjectCatalog } from '../src/catalog/catalog';
import type { ProjectRecord } from '../src/projects';
import { OWNERS, type Fact, type Metric, type ResearchEvent } from '../src/research/contracts';
import type { ResearchStore } from '../src/research/store';

export const commit='a'.repeat(40); export const treeDigest=`sha256:${'b'.repeat(64)}`;
type FactInput<T=Fact> = T extends Fact ? Omit<T,'schemaVersion'> : never;
export function event(projectId:string,runId:string,fact:FactInput,overrides:Partial<ResearchEvent>={}):ResearchEvent {
  return { contractVersion:{major:1,minor:0},eventId:id(),producerId:id(),streamId:id(),sequence:0,
    projectId,runId,operationId:id(),actionId:id(),observedAt:null,causedBy:[],fact:{...fact,schemaVersion:1},...overrides };
}
export function metric(split:Metric['split']='validation',value=.8):Metric {
  return {metricId:id(),definitionRef:id(),split,unit:'fraction',direction:'maximize',value,validity:'valid',reason:null};
}
export async function fixture() {
  const root=mkdtempSync(path.join(os.tmpdir(),'lab-research-'));
  const sanitizer=new Sanitizer();const revoked:string[]=[];
  let recording=new SafeRecording(new PrivateFiles(path.join(root,'security')),sanitizer,async id=>{revoked.push(id);}); await recording.initialize();
  let catalog=new ProjectCatalog(root);
  const requestId=id(); const reply=catalog.handle({kind:'create',operationId:requestId,input:{requestId,name:'Research',folderName:'research'}});
  if(!reply.ok) throw new Error(reply.error.message);
  const project=reply.value as ProjectRecord; const runId=id();
  let store=catalog.research(project.projectId,recording);
  const make=(fact:FactInput,overrides:Partial<ResearchEvent>={})=>event(project.projectId,runId,fact,overrides);
  const send=(e:ResearchEvent)=>store.bind(OWNERS[e.fact.kind]).ingest(e);
  const run=make({kind:'run',id:runId,revision:1,snapshotId:id(),settings:{objectiveRef:id(),dataRef:id(),splitsRef:id(),evaluationContextRef:id(),metricPolicyRef:id(),initializationRef:id(),environmentRef:id(),agentRef:id(),durationRef:id(),stoppingRef:id(),codeSourceCommit:commit,resolved:{seed:42,seconds:300}}});
  if(run.fact.kind!=='run') throw new Error();
  const inputs=make({kind:'inputs',id:id(),revision:1,snapshotId:run.fact.snapshotId,evaluationContextRef:run.fact.settings.evaluationContextRef,
    initializationRef:run.fact.settings.initializationRef,dataRef:run.fact.settings.dataRef,splitsRef:run.fact.settings.splitsRef,
    environmentRef:run.fact.settings.environmentRef,processingRef:id(),digest:treeDigest,resolved:{sourceRevision:commit}});
  const hardware=make({kind:'hardware',id:id(),revision:1,reservationId:id(),provider:'fixture',resourceId:'instance',gpuIds:['synthetic-gpu'],environmentRef:run.fact.settings.environmentRef,details:{model:'Fixture GPU',count:1}});
  const attempt=(role:'baseline'|'candidate'='baseline',candidate:Extract<Fact,{kind:'candidate'}>|null=null)=> {
    if(hardware.fact.kind!=='hardware' || run.fact.kind!=='run') throw new Error();
    return make({kind:'attempt',id:id(),revision:1,role,candidateId:candidate?.id??null,snapshotId:run.fact.snapshotId,manifestId:inputs.fact.id,
      testedCommit:candidate?.testedCommit??commit,treeDigest,reservationId:hardware.fact.reservationId,hardwareId:hardware.fact.id,actionId:id(),protocolRef:id()});
  };
  const outcome=(attemptId:string,status:Extract<Fact,{kind:'outcome'}>['status']='completed')=>make({kind:'outcome',id:id(),revision:1,attemptId,status,evidenceId:id(),explanation:'Confirmed fixture outcome'});
  const evaluation=(a:ResearchEvent)=> {
    if(a.fact.kind!=='attempt'||run.fact.kind!=='run') throw new Error();
    return make({kind:'evaluation',id:id(),revision:1,attemptId:a.fact.id,testedCommit:a.fact.testedCommit,checkpointId:id(),evaluationContextRef:run.fact.settings.evaluationContextRef,validity:'valid',eligible:true,metrics:[metric()],constraints:[],explanation:'Protected fixture evaluation'});
  };
  return {root,get recording(){return recording;},sanitizer,revoked,project,runId,run,inputs,hardware,make,send,attempt,outcome,evaluation,
    get store(){return store;},get catalog(){return catalog;},
    async restartSecurity(){recording=new SafeRecording(new PrivateFiles(path.join(root,'security')),sanitizer,async id=>{revoked.push(id);});await recording.initialize();},
    async seed(){await send(run);await send(inputs);await send(hardware);},
    reopen(){catalog.close();catalog=new ProjectCatalog(root);store=catalog.research(project.projectId,recording);return store;},
    cleanup(){catalog.close();rmSync(root,{recursive:true,force:true});},
  };
}
export async function publish(store:ResearchStore,events:ResearchEvent[]) {
  for(const e of events) await store.bind(OWNERS[e.fact.kind]).ingest(e);
}
