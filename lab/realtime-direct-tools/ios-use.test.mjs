import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateIOSOperation,validateIOSResult,iosUseOperations,iosUseTool,createIOSUseAdapter} from './ios-use.mjs';
const event={title:'Candidate meeting',body:'Non-sensitive test',start:'2026-10-26T10:00:00+08:00',end:'2026-10-26T10:30:00+08:00',timeZone:'Asia/Shanghai'};
test('reject model-selected identities, targets, unbounded dates and hidden fields',()=>{
 for(const value of [{...event,actor:'other'},{...event,calendarId:'private'},{...event,start:'2026-10-26T10:00:00'},{...event,end:'2027-01-01T00:00:00Z'},{...event,end:event.start},{...event,timeZone:'invalid'}])assert.throws(()=>validateIOSOperation('calendar.create',value));
 assert.throws(()=>validateIOSOperation('reminders.query',{limit:true}));assert.throws(()=>validateIOSOperation('notes.append',{title:'',body:'x',noteId:'private'}));
});
test('Notes requires correlated content digest; shortcut open is not save',()=>{
 const payload={title:'想法',body:'先记录再安排'},requestId='b63825c8-5c07-4a99-a88b-30ac79e6a093';
 const result={status:'completed',evidence:'user_configured_shortcut_readback',contentDigest:createHash('sha256').update(payload.title+'\n'+payload.body+'\n\nV Voice · '+requestId).digest('hex')};
 assert.equal(validateIOSResult('notes.create',result,{requestId,payload}).completed,true);
 assert.throws(()=>validateIOSResult('notes.create',{...result,contentDigest:'wrong'},{requestId,payload}));
 assert.throws(()=>validateIOSResult('notes.create',{status:'completed',evidence:'system_handoff'},{requestId,payload}));
 assert.equal(validateIOSResult('notes.create',{status:'unknown'}).completed,false);
});
test('calendar completion requires persisted ID, actual fields and time readback',()=>{
 const result={status:'completed',evidence:'eventkit_written_readback',written:true,readBack:true,item:{id:'persisted',...event}};
 assert.equal(validateIOSResult('calendar.create',result,{payload:event}).completed,true);
 for(const item of [{...result.item,id:''},{...result.item,title:'other'},{...result.item,start:'2026-10-26T11:00:00+08:00'}])assert.throws(()=>validateIOSResult('calendar.create',{...result,item},{payload:event}));
});
test('stable device tool retains negotiated verbs but denial cannot be delegated through adapter',async()=>{
 let invoked=0;
 const snapshot={'notes.create':{status:'denied'},'notes.append':{status:'denied'},'calendar.create':{status:'available'},'calendar.query':{status:'available'}};
 assert.deepEqual(iosUseTool(snapshot).parameters.properties.operation.enum,['notes.create','notes.append','calendar.create','calendar.query']);
 const execute=createIOSUseAdapter({capabilities:snapshot,request:()=>{invoked++;}});
 await assert.rejects(()=>execute({operation:'notes.create',payload:{title:'x',body:'y'}},'call'));
 assert.equal(invoked,0);
});
test('public adapter follows operation-specific proof semantics',()=>{
 const operation=iosUseOperations()['calendar.create'];assert.equal(operation.sideEffect,true);
 operation.validateArguments(event);
 assert.equal(operation.validateResult({evidence:'eventkit_written_readback',written:true,readBack:true,item:{id:'saved',...event}},{requestId:'id',arguments:event}).completed,true);
 assert.equal(iosUseOperations()['calendar.query'].sideEffect,false);
});
test('query is bounded and reminders due time must match readback',()=>{
 assert.throws(()=>validateIOSResult('calendar.query',{status:'completed',evidence:'eventkit_query',items:[{id:'x',title:'a'},{id:'y',title:'b'}]},{payload:{limit:1}}));
 const payload={title:'Follow up',due:'2026-10-26T10:00:00+08:00',timeZone:'Asia/Shanghai'};
 assert.throws(()=>validateIOSResult('reminders.create',{status:'completed',evidence:'eventkit_written_readback',written:true,readBack:true,item:{id:'x',title:payload.title,due:'2026-10-26T11:00:00+08:00'}},{payload}));
});

test('common transport validates against this request arguments across interleaved calls',async()=>{
 const {createDeviceRequests}=await import('../../lib/device-requests.mjs');
 const adapters=iosUseOperations(),sentA=[],sentB=[];
 const make=(voiceSessionId,frames)=>createDeviceRequests({voiceSessionId,send:f=>frames.push(f),operations:adapters,capabilities:{'notes.create':{status:'available'}}});
 const a=make('call-A',sentA),b=make('call-B',sentB);
 const pa=a.request('notes.create',{title:'A',body:'First'}),pb=b.request('notes.create',{title:'B',body:'Second'});
 const receipt=(f,title,body)=>({type:'device.result',version:1,voiceSessionId:f.voiceSessionId,requestId:f.requestId,operation:f.operation,status:'ok',result:{evidence:'user_configured_shortcut_readback',contentDigest:createHash('sha256').update(title+'\n'+body+'\n\nV Voice · '+f.requestId).digest('hex')}});
 b.receive(receipt(sentB[0],'B','Second'));a.receive(receipt(sentA[0],'A','First'));
 assert.equal((await pa).status,'ok');assert.equal((await pb).status,'ok');a.close();b.close();
});
