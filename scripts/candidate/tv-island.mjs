// Loopback-only fixture: real shared H5 + shared Voice service; no credentials or real TV calls.
import {EventEmitter} from 'node:events';
import {WebSocketServer} from 'ws';
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';
import {createDirectVoiceService} from '../../lab/realtime-direct-tools/session.mjs';
import {appendFile,mkdir} from 'node:fs/promises';
await mkdir('artifacts/tv-island',{recursive:true});
let volume=15;let bridge;
const tools=[{id:'xiaomi-tv_tv_status',description:'[本地替身] 读取电视缓存状态，不能作为命令执行判据',parameters:{type:'object',properties:{},additionalProperties:false}},{id:'xiaomi-tv_tv_volume',description:'[本地替身] 设置音量，参数 percent 为 1-100 整数。accepted 仅表示替身接受。',parameters:{type:'object',properties:{percent:{type:'integer',minimum:1,maximum:100}},required:['percent'],additionalProperties:false}}];
const audit=e=>{if(e.type==='tool.invoke'||e.type==='tool.native-result')void appendFile('artifacts/tv-island/tool-trace.jsonl',JSON.stringify(e)+'\n');};
const gateway={ready:true,request:async(method,args)=>{if(method==='tools.catalog')return {groups:[{tools}]};if(method==='tools.invoke'){if(!tools.some(t=>t.id===args.name))throw Error('Local fixture tool unavailable');if(args.name==='xiaomi-tv_tv_volume'){const p=args.args.percent;if(!Number.isInteger(p)||p<1||p>100)throw Error('Invalid fixture volume');volume=p;}return {ok:true,output:{accepted:true,simulation:true,volume_percent:volume,physical_playback_verified:false}};}if(method==='sessions.resolve')return {key:args.key};if(method==='sessions.describe')return {session:{key:args.key,agentId:'makaron'}};throw Error('Local fixture RPC unavailable: '+method);}};
class Model extends EventEmitter {
 constructor(){super();this.readyState=1;this.text='';this.toolDone=false;setImmediate(()=>this.emit('open'));}
 emitEvent(e){if(this.readyState===1)this.emit('message',Buffer.from(JSON.stringify(e)),false);}
 send(raw){const e=JSON.parse(raw);if(e.type==='session.update'){queueMicrotask(()=>this.emitEvent({type:'session.updated'}));return;}if(e.type==='conversation.item.create'){if(e.item.type==='function_call_output'){this.result=JSON.parse(e.item.output);this.toolDone=true;}else if(e.item.role==='user')this.text=e.item.content?.find(c=>c.type==='input_text')?.text??'';return;}if(e.type==='response.create')setTimeout(()=>this.respond(),80);}
 respond(){const id='fixture-'+Date.now();this.emitEvent({type:'response.created',response:{id}});if(/音量/.test(this.text)&&!this.toolDone){this.emitEvent({type:'conversation.item.input_audio_transcription.completed',item_id:'user-'+id,transcript:this.text});let p=Number(this.text.match(/\d+/)?.[0]??15);this.emitEvent({type:'response.function_call_arguments.done',response_id:id,call_id:'tool-'+id,name:'openclaw_tool',arguments:JSON.stringify({tool:'xiaomi-tv_tv_volume',arguments:JSON.stringify({percent:Math.max(1,Math.min(100,p))})})});this.emitEvent({type:'response.done',response:{id,status:'completed'}});return;}
 let text=this.toolDone?(this.result?.ok===true?'本地电视替身已接受音量设置。真实电视没有变化。':'本地替身未完成操作；没有控制真实电视。'):'这是本地验收，使用原有 V 网页和共用会话服务。可以用文字输入“音量调到 15”。';this.toolDone=false;this.text='';this.emitEvent({type:'response.output_audio_transcript.done',response_id:id,transcript:text});const pcm=Buffer.alloc(4800);for(let i=0;i<2400;i++)pcm.writeInt16LE(Math.sin(i*2*Math.PI*440/24000)*400,i*2);this.emitEvent({type:'response.output_audio.delta',response_id:id,delta:pcm.toString('base64')});this.emitEvent({type:'response.done',response:{id,status:'completed'}});}
 close(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
}
const service=createDirectVoiceService({gateway,wsModule:{WebSocket:Model,WebSocketServer},apiKeys:{grok:'LOCAL_FIXTURE_ONLY'},audit,loadContext:async()=>'',searchAcknowledgment:'off'});
bridge=createLiveH5Server({gateway,directVoice:service,defaultModel:'grok',conversationEntries:[{id:'tv_fixture',agentId:'makaron',callerId:'tianyi',permissionProfile:'personal-tianyi',sessionKey:'agent:makaron:feishu:group:tv_fixture',accountId:'fixture',kind:'group',accountLabel:'本地演示账号',displayName:'TV 替身 · 非真实身份',accessToken:'LOCAL_FIXTURE_NOT_A_REAL_SECRET_0000'}],callSummarize:async()=>'',avatarEvaluate:async()=>({}),callControlEvaluate:async()=>({}),candidateRelease:{id:'tv-island-local-1',warning:'本地模拟：身份未连接；不会控制真实电视'}});
// Keep the shell's original URL usable while making the fixture identity visible.
const [handleRequest]=bridge.server.listeners('request');
bridge.server.removeListener('request',handleRequest);
bridge.server.on('request',(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');if(url.pathname==='/'&&!url.searchParams.has('phone')){url.searchParams.set('phone','tv_fixture');res.writeHead(302,{location:url.pathname+url.search});res.end();return;}handleRequest(req,res);});
bridge.server.listen(26326,'127.0.0.1',()=>console.log('TV_ISLAND_LOCAL http://127.0.0.1:26326/?tv=1'));
process.on('SIGTERM',()=>void bridge.dispose().finally(()=>process.exit()));
