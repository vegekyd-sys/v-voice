import {test} from 'node:test';import assert from 'node:assert/strict';
import {createRobotDevice,probeRobot,robotOperations} from './robot-device.mjs';
const pack=x=>({content:[{type:'text',text:JSON.stringify(x)}]});
function fixture(overrides={}){
 const calls=[];let current=true;let owner;
 const wire={callTool:async(name,args)=>{calls.push({name,args});if(overrides.call)return overrides.call(name,args);
  if(name.endsWith('capabilities'))return pack({version:1,axes:'yaw,pitch',feedbackValid:true});
  if(name.endsWith('bind'))return pack({bound:true});
  if(name.endsWith('command')){owner=args;return pack({...args,status:'running'});}
  return pack({...owner,...args,yaw:0,pitch:30,status:name.endsWith('cancel')?'cancelled':'completed',feedbackValid:true,reason:'hardware_feedback',reached:3,total:3});},takePhoto:()=>{}};
 return {wire,calls,isCurrent:()=>current,close:()=>current=false};
}
const options=id=>({requestId:id,voiceSessionId:'call-one',deadline:Date.now()+4000});
async function adapter(f){const probe=await probeRobot({wire:f.wire,camera:true});const d=createRobotDevice({wire:f.wire,voiceSessionId:'call-one',probe,look:async(a,o)=>({description:'真实照片摘要',source:'robot-camera',requestId:o.requestId,capturedAt:Date.now()}),isCurrent:f.isCurrent,pollMs:1});await d.bind();return d;}
test('only live hardware feedback enables axes; missing RPC keeps legacy camera only',async()=>{
 const probe=await probeRobot({wire:{callTool:async()=>{throw Error('old');},takePhoto(){}},camera:true});
 assert.equal(probe.capabilities['robot.observe'].status,'available');assert.equal(probe.capabilities['robot.move'].status,'unavailable');
});
test('move completes only from matching hardware receipt; duplicate request never replays',async()=>{
 const f=fixture(),d=await adapter(f),o=options('r1');
 const [a,b]=await Promise.all([d.execute('robot.gesture',{gesture:'nod'},o),d.execute('robot.gesture',{gesture:'nod'},o)]);
 assert.equal(a.status,'ok');assert.deepEqual(a,b);assert.equal(f.calls.filter(x=>x.name.endsWith('command')).length,1);
 assert.equal((await d.execute('robot.gesture',{gesture:'shake'},o)).reason,'request_conflict');d.close();
});
test('unsupported axis, angles and model-supplied identity fail before hardware execution',async()=>{
 for(const [op,args] of [['robot.move',{yaw:80,pitch:30}],['robot.move',{yaw:0,pitch:0}],['robot.gesture',{gesture:'roll'}],['robot.move',{yaw:0,pitch:30,voiceSessionId:'other'}]])assert.throws(()=>robotOperations[op].validateArguments(args));
 const f=fixture(),d=await adapter(f);assert.equal((await d.execute('robot.gesture',{gesture:'nod'},{...options('r2'),voiceSessionId:'other'})).status,'cancelled');
 assert.equal(f.calls.filter(x=>x.name.endsWith('command')).length,0);d.close();
});
test('fake completion or foreign receipt is unknown and attempts a stop, never repeats command',async()=>{
 for(const bad of [{feedbackValid:false},{requestId:'old'},{voiceSessionId:'other'},{reached:0}]){
  const f=fixture({call:async(name,args)=>name.endsWith('capabilities')?pack({version:1,axes:'yaw,pitch',feedbackValid:true}):name.endsWith('bind')?pack({bound:true}):pack({...args,status:'completed',feedbackValid:true,reason:'hardware_feedback',reached:1,total:1,...bad})});
  const d=await adapter(f);assert.equal((await d.execute('robot.gesture',{gesture:'nod'},options('r3'))).status,'unknown');
  assert.equal(f.calls.filter(x=>x.name.endsWith('command')).length,1);assert.equal(f.calls.filter(x=>x.name.endsWith('cancel')).length,1);d.close();
 }
});
test('expired owner never takes a photo, valid photo returns source and request association',async()=>{
 const f=fixture(),d=await adapter(f);assert.equal((await d.execute('robot.observe',{question:'看什么？'},options('r4'))).status,'ok');
 f.close();assert.equal((await d.execute('robot.observe',{question:'看什么？'},options('r5'))).status,'cancelled');d.close();
});
