import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadCredentials } from './credentials.mjs';
import { VolcAsrStream } from './volc-asr.mjs';
import { FinalUtterances } from './utterances.mjs';
import { SpeakerConversation, createArkEvaluator, PARTICIPANTS } from './decision.mjs';
import { synthesizeReply } from './tts.mjs';

const port=Number(process.env.VOLC_SPEAKER_PORT??26318),env=await loadCredentials();
const artifactRoot=new URL('../../artifacts/volc-speaker/',import.meta.url);
const {Id:endpointId}=JSON.parse(await readFile(new URL('ark-endpoint.json',artifactRoot),'utf8'));
const evaluator=await createArkEvaluator(env,{endpointId});
let liveOwner=null,modelCalls=0,audioBytes=0,ttsCharacters=0;
const limits={modelCalls:60,audioBytes:32000*600,ttsCharacters:6000};
const staticFiles=new Map([['/','index.html'],['/client.mjs','client.mjs'],['/capture-worklet.js','capture-worklet.js']]);
const origins=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
const server=http.createServer(async(req,res)=>{
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403).end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    if(req.method==='GET'&&staticFiles.has(path)){
      const filename=staticFiles.get(path);res.setHeader('Content-Type',filename.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');
      res.end(await readFile(new URL(filename,import.meta.url)));return;
    }
    if(req.method==='GET'&&path==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ready:true,asr:'doubao-seed-asr-2.0',model:'doubao-seed-2-1-lite-260915',voice:'xiaohe',voiceprintIdentityVerified:false,modelCalls,audioSeconds:audioBytes/32000,limits}));return;}
    if(req.method==='GET'&&path==='/fixture.pcm'){res.setHeader('Content-Type','application/octet-stream');res.end(await readFile(new URL('turn-taking.pcm',artifactRoot)));return;}
    res.writeHead(404).end();
  }catch{res.writeHead(500).end('实验资源读取失败');}
});
const wss=new WebSocketServer({noServer:true,maxPayload:256*1024});
server.on('upgrade',(req,socket,head)=>{
  if(!origins.has(req.headers.origin)||req.url!=='/stream'||liveOwner){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
});
wss.on('connection',ws=>{
  const session={};liveOwner=session;
  let asr,closed=false,revision=0,bindings=new Map(),pendingBinding=null,tracker=new FinalUtterances(),tail=Promise.resolve(),ready=false;
  let abort=new AbortController(),conversation;
  const send=value=>{if(ws.readyState===1)ws.send(JSON.stringify(value));};
  const limitedEvaluate=async(payload,options)=>{
    if(++modelCalls>limits.modelCalls)throw Error('本次实验调用上限已到，请先结束测试');
    return evaluator(payload,options);
  };
  const configure=value=>{
    abort.abort();abort=new AbortController();revision++;
    conversation=new SpeakerConversation({evaluate:limitedEvaluate,mode:value.mode??'adaptive',targetId:value.targetId??'tianyi'});
    send({type:'configured',mode:conversation.mode,targetId:conversation.targetId,revision});
  };
  const close=()=>{if(closed)return;closed=true;revision++;abort.abort();asr?.close();if(liveOwner===session)liveOwner=null;};
  ws.on('close',close);ws.on('error',close);
  const expiry=setTimeout(()=>{send({type:'error',message:'单次真人测试已达三分钟，请结束后重新开始'});ws.close();},180000);ws.on('close',()=>clearTimeout(expiry));
  async function processTurn(turn,epoch){
    if(closed||epoch!==revision)return;
    const person=PARTICIPANTS.find(p=>p.id===bindings.get(turn.speakerId));
    const speaker=person?{...person,source:'session-binding'}:{id:'unknown',name:`未绑定声线 ${turn.speakerId}`,role:'unknown',source:'unbound'};
    const annotated={...turn,speaker};send({type:'utterance',turn:annotated});
    const controller=abort,owner=conversation;
    try{
      const result=await owner.accept(annotated,{signal:controller.signal});
      if(closed||epoch!==revision)return;
      send({type:'decision',turn:annotated,...result});
      if(result.decision?.shouldRespond){
        const text=result.decision.reply;ttsCharacters+=text.length;
        if(ttsCharacters>limits.ttsCharacters)throw Error('本次实验语音输出上限已到');
        const speech=await synthesizeReply(env.DOUBAO_SPEECH_API_KEY??env.VOLCENGINE_ASR_API_KEY,text,{signal:controller.signal});
        if(!closed&&epoch===revision)send({type:'speech',audio:speech.audio.toString('base64'),mime:speech.mime,forTurn:{startMs:turn.startMs,endMs:turn.endMs},usage:speech.usage});
      }
    }catch(error){if(!controller.signal.aborted&&!closed&&epoch===revision)send({type:'error',message:error.message});}
  }
  ws.on('message',async(data,binary)=>{
    try{
      if(binary){
        if(!ready)throw Error('识别通道尚未就绪');
        const bytes=Buffer.from(data);if(bytes.length%2||bytes.length>32000)throw Error('音频块格式不合法');
        audioBytes+=bytes.length;if(audioBytes>limits.audioBytes)throw Error('本次实验音频总量上限已到');
        asr.append(bytes);return;
      }
      const value=JSON.parse(data.toString());
      if(value.type==='start'){
        if(asr)throw Error('识别已开始');configure(value);
        // The synthetic fixture labels are known test calibration, never a
        // claim that enrolled voiceprint identification succeeded.
        if(value.synthetic){bindings=new Map([['0','tianyi'],['1','shier']]);send({type:'notice',message:'合成素材回放：身份来自已知素材校准，不是声纹自动认人。'});}
        asr=new VolcAsrStream({apiKey:env.VOLCENGINE_ASR_API_KEY,
          onResult:event=>{
            const interim=event.body.result?.text;if(interim)send({type:'interim',text:interim});
            for(const entry of tracker.consume(event)){
              if(entry.type==='identity-revision'){send({type:'identity-revision',message:'识别服务修订了说话人编号，相关身份需重新核实',...entry});continue;}
              const {turn}=entry;
              if(pendingBinding){
                const previous=bindings.get(turn.speakerId);
                if(previous&&previous!==pendingBinding)send({type:'error',message:'本句仍被识别成已绑定的声线，请让另一位单独连续讲五秒后重试。'});
                else if([...bindings].some(([id,p])=>p===pendingBinding&&id!==turn.speakerId))send({type:'error',message:'该人物已绑定其他声线，请重新开始校准。'});
                else{bindings.set(turn.speakerId,pendingBinding);send({type:'bound',speakerId:turn.speakerId,participantId:pendingBinding});pendingBinding=null;send({type:'calibration',turn});continue;}
              }
              const epoch=revision;tail=tail.then(()=>processTurn(turn,epoch));
            }
            if(event.final)send({type:'asr-ended'});
          },onError:error=>{send({type:'error',message:error.message});asr?.close();ready=false;},onClose:()=>{ready=false;}});
        await asr.connect();if(closed){asr.close();return;}ready=true;send({type:'ready'});return;
      }
      if(value.type==='configure'){configure(value);return;}
      if(value.type==='bind'){
        if(!PARTICIPANTS.some(p=>p.id===value.participantId))throw Error('未知校准人物');
        pendingBinding=value.participantId;send({type:'binding',participantId:pendingBinding});return;
      }
      if(value.type==='finish'){asr?.finish();return;}
      if(value.type==='stop'){close();ws.close();return;}
      throw Error('未知实验操作');
    }catch(error){send({type:'error',message:error.message});}
  });
});
server.listen(port,'127.0.0.1',()=>console.log(`Volc speaker lab ready: http://127.0.0.1:${port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{for(const ws of wss.clients)ws.close();server.close(()=>process.exit(0));});
