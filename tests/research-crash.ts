import { ResearchStore, type Checkpoint } from '../src/research/store';
import { SafeRecording } from '../src/security/recording';
import { Sanitizer } from '../src/security/sanitizer';
import { PrivateFiles } from '../src/security/private-files';
import { OWNERS, type ResearchEvent } from '../src/research/contracts';
async function main() {
 const [file,project,security,input,checkpoint]=process.argv.slice(2);
 const recording=new SafeRecording(new PrivateFiles(security),new Sanitizer(),async()=>{});await recording.initialize();
 const store=new ResearchStore(file,project,recording,(stage:Checkpoint)=>{if(stage===checkpoint)process.kill(process.pid,'SIGKILL');});
 const event=JSON.parse(input) as ResearchEvent;await store.bind(OWNERS[event.fact.kind]).ingest(event);process.exitCode=2;
}
void main();
