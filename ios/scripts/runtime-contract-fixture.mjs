// Reviewed, synthetic cross-language wire fixture. No provider/network access.
import {writeFile,mkdir} from 'node:fs/promises';
import {createNativeRuntime} from '../../lab/realtime-direct-tools/native-runtime.mjs';
const r=createNativeRuntime({voiceSessionId:'native-contract-fixture',duplex:true,assisted:true});
const events=[
  {type:'transcript',role:'assistant',text:'先自然接话',final:false},
  {type:'transcript',role:'assistant',text:'先自然接话，再查询。',final:true},
  {type:'speaker.utterance',turn:{speakerId:1,startMs:0,endMs:300,text:'我叫甲'},participants:[{id:'speaker:1',label:'Speaker A',name:'甲'}]},
  {type:'speaker.decision',turn:{speakerId:1,startMs:0,endMs:300,text:'我叫甲'},shouldRespond:true},
  {type:'speaker.recovery',reason:'mixed-speakers'},
  {type:'tool.call',callId:'search',activity:'web'},
  {type:'tool.progress',callId:'search',stage:'比较第二组资料',step:2},
  {type:'tool.result',callId:'search'},
  {type:'audio',audio:Buffer.alloc(960).toString('base64'),sampleRate:24000,sequence:1,responseId:'reply',source:'future-interjection'},
  {type:'input.speech.started'}, {type:'input.speech.stopped',recognized:true},
  {type:'input.speech.ignored',preservedResponseId:'reply'},
  {type:'audio.clear',retiredResponseId:'reply'}, {type:'audio.done',responseId:'next'},
  {type:'backend.result',callId:'report',text:'# 候选报告\n没有调用模型或工具。'},
  {type:'provider.reconnecting'}, {type:'provider.recovered'},
  {type:'avatar.expression',expression:'happy'},
  {type:'end.after-playback',callId:'end'}, {type:'end.cancelled'},
];
const path=new URL('../Fixtures/native-runtime-v1.json',import.meta.url);
await mkdir(new URL('.',path),{recursive:true});
await writeFile(path,JSON.stringify({policy:r.descriptor,frames:events.map(e=>r.project(e))},null,2)+'\n');
