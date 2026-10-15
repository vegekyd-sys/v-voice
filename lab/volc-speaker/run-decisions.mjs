import { readFile, writeFile } from 'node:fs/promises';
import { loadCredentials } from './credentials.mjs';
import { SpeakerConversation, createArkEvaluator, PARTICIPANTS } from './decision.mjs';

const dir='artifacts/volc-speaker';
const env=await loadCredentials(),{Id:endpointId}=JSON.parse(await readFile(`${dir}/ark-endpoint.json`,'utf8'));
const evaluate=await createArkEvaluator(env,{endpointId});
const turns=JSON.parse(await readFile(`${dir}/streaming-result-turns.json`,'utf8'));
// Synthetic-only calibration from the known fixture voice schedule. This is
// session binding, not an assertion that voiceprint matching worked.
const map={'0':'tianyi','1':'shier','2':'unknown'};
const prepare=turn=>({...turn,speaker:{...(PARTICIPANTS.find(p=>p.id===map[turn.speakerId])??{id:'unknown',name:'未绑定说话人',role:'unknown'}),source:'synthetic-session-binding'}});
const cases=[];
for(const mode of ['exclusive','adaptive','group']){
  const conversation=new SpeakerConversation({evaluate,mode,targetId:'tianyi'});
  const outputs=[];
  for(const turn of turns){const result=await conversation.accept(prepare(turn));outputs.push({turn:prepare(turn),...result});console.log(JSON.stringify({mode,speaker:map[turn.speakerId],status:result.status,target:result.targetId,style:result.decision?.style,policyChanged:result.policyChanged,elapsedMs:result.elapsedMs}));}
  cases.push({mode,outputs,modelCalls:conversation.modelCalls});
  await writeFile(`${dir}/decision-results.json`,JSON.stringify(cases,null,2),{mode:0o600});
}
const exclusive=cases.find(c=>c.mode==='exclusive'),adaptive=cases.find(c=>c.mode==='adaptive');
const checks={
  exclusiveOwnerRetainedUntilHandoff:exclusive.outputs[0].targetId==='tianyi',
  exclusiveHandoffToChild:exclusive.outputs[1].targetId==='shier'&&exclusive.outputs[1].policyChanged===true,
  exclusiveFormerOwnerAndUnknownWithheld:!exclusive.outputs[3].modelCalled&&!exclusive.outputs[4].modelCalled,
  exclusiveChildCanContinue:exclusive.outputs[2].modelCalled&&exclusive.outputs[5].modelCalled,
  handoffSelectsChild:adaptive.outputs[1].decision?.nextTargetId==='shier',
  childQuestionUsesChildStyle:adaptive.outputs[2].decision?.style==='child'&&adaptive.outputs[2].decision?.addresseeIds.includes('shier'),
  unknownInputRetainsUnknownIdentity:adaptive.outputs[4].turn.speaker.id==='unknown',
};
await writeFile(`${dir}/decision-checks.json`,JSON.stringify(checks,null,2),{mode:0o600});
console.log(JSON.stringify({checks,totalModelCalls:cases.reduce((n,c)=>n+c.modelCalls,0),tokens:cases.flatMap(c=>c.outputs).reduce((n,x)=>n+(x.usage?.total_tokens??0),0)}));
if(Object.values(checks).some(x=>!x))process.exitCode=1;
