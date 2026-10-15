import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { loadCredentials } from '../volc-speaker/credentials.mjs';
import { VolcAsrStream } from '../volc-speaker/volc-asr.mjs';
import { FinalUtterances } from '../volc-speaker/utterances.mjs';
import { SpeakerConversation, createArkEvaluator, shouldInterrupt } from './decision.mjs';
import { synthesizeReplyStream } from './tts-stream.mjs';

const port=Number(process.env.VOLC_SPEAKER_PORT??26319),env=await loadCredentials();
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
      res.end(await readFile(new URL(filename==='capture-worklet.js'?'../volc-speaker/capture-worklet.js':filename,import.meta.url)));return;
    }
    if(req.method==='GET'&&path==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ready:true,asr:'doubao-seed-asr-2.0',model:'doubao-seed-2-1-lite-260915',voice:'xiaohe',speakerIdentity:'anonymous-then-dialogue',manualCalibration:false,activeSession:Boolean(liveOwner),streamingSpeech:true,voiceprintIdentityVerified:false,modelCalls,audioSeconds:audioBytes/32000,limits}));return;}
    if(req.method==='GET'&&path==='/mode-fixture.pcm'){res.setHeader('Content-Type','application/octet-stream');res.end(await readFile(new URL('auto/mode-comparison.pcm',artifactRoot)));return;}
    if(req.method==='GET'&&path==='/fixture.pcm'){res.setHeader('Content-Type','application/octet-stream');res.end(await readFile(new URL('auto/turn-taking.pcm',artifactRoot)));return;}
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
  let asr,closed=false,revision=0,tracker=new FinalUtterances(),tail=Promise.resolve(),ready=false;
  let abort=new AbortController(),speechAbort=new AbortController(),conversation,speechSequence=0,sessionBytes=0;const audioClock=[],speechReceipts=new Map();
  const send=value=>{if(ws.readyState===1)ws.send(JSON.stringify(value));};
  const limitedEvaluate=async(payload,options)=>{
    if(++modelCalls>limits.modelCalls)throw Error('本次实验调用上限已到，请先结束测试');
    return evaluator(payload,options);
  };
  const configure=value=>{
    abort.abort();speechAbort.abort();abort=new AbortController();revision++;
    if(conversation)conversation.configure({mode:value.mode??conversation.mode,targetId:value.targetId??conversation.targetId});
    else conversation=new SpeakerConversation({evaluate:limitedEvaluate,mode:value.mode??'adaptive'});
    send({type:'configured',...conversation.snapshot(),revision});
  };
  const close=()=>{if(closed)return;closed=true;revision++;abort.abort();speechAbort.abort();asr?.close();if(liveOwner===session)liveOwner=null;};
  ws.on('close',close);ws.on('error',close);
  const expiry=setTimeout(()=>{send({type:'error',message:'单次真人测试已达三分钟，请结束后重新开始'});ws.close();},180000);ws.on('close',()=>clearTimeout(expiry));
  async function processTurn(turn,epoch,clock){
    if(closed||epoch!==revision)return;
    const annotated={...turn,speaker:conversation.register(turn.speakerId)};
    const timings={asrMs:Math.max(0,Math.round(clock.readyAt-clock.endAt)),queueMs:Math.round(performance.now()-clock.readyAt)};
    send({type:'utterance',turn:annotated,timings,...conversation.snapshot()});
    const controller=abort,owner=conversation;
    if(shouldInterrupt({mode:owner.mode,targetId:owner.targetId,speaker:annotated.speaker},turn.text)){
      speechAbort.abort();speechAbort=new AbortController();speechSequence++;
      send({type:'speech-cancel'});
    }
    const speechController=speechAbort,speechId=`${epoch}:${speechSequence}`;
    try{
      const result=await owner.accept(annotated,{signal:controller.signal});
      if(closed||epoch!==revision)return;
      timings.modelMs=result.elapsedMs??0;send({type:'decision',turn:annotated,...result,timings});
      if(result.decision?.shouldRespond){
        const text=result.decision.reply;ttsCharacters+=text.length;
        if(ttsCharacters>limits.ttsCharacters)throw Error('本次实验语音输出上限已到');
        // Speech runs independently: later decisions need not wait for full TTS.
        void speak(text,turn,epoch,speechId,speechController,controller,timings,clock);
      }
    }catch(error){if(!controller.signal.aborted&&!closed&&epoch===revision)send({type:'error',message:error.message});}
  }
  async function speak(text,turn,epoch,speechId,controller,sessionController,timings,clock){
    const started=performance.now(),forTurn={startMs:turn.startMs,endMs:turn.endMs};let first=true,chunkIndex=0;
    const current=()=>!closed&&epoch===revision&&!controller.signal.aborted&&!sessionController.signal.aborted;
    try{
      const speech=await synthesizeReplyStream(env.DOUBAO_SPEECH_API_KEY??env.VOLCENGINE_ASR_API_KEY,text,{
        signal:AbortSignal.any([controller.signal,sessionController.signal]),onChunk:chunk=>{
          if(!current())return;
          if(first){first=false;timings.ttsFirstMs=Math.round(performance.now()-started);timings.firstAudioAfterEndMs=Math.round(performance.now()-clock.endAt);
            speechReceipts.set(speechId,{timings:{...timings},forTurn});if(speechReceipts.size>20)speechReceipts.delete(speechReceipts.keys().next().value);
            send({type:'speech-start',speechId,mime:'audio/mpeg',forTurn,timings});}
          send({type:'speech-chunk',speechId,index:chunkIndex++,audio:chunk.toString('base64')});
        }});
      if(current())send({type:'speech-end',speechId,forTurn,usage:speech.usage,audioBytes:speech.audio.length,timings:{...timings,ttsTotalMs:Math.round(performance.now()-started)}});
    }catch(error){if(current())send({type:'error',message:error.message});}
  }
  ws.on('message',async(data,binary)=>{
    try{
      if(binary){
        if(!ready)throw Error('识别通道尚未就绪');
        const bytes=Buffer.from(data);if(bytes.length%2||bytes.length>32000)throw Error('音频块格式不合法');
        audioBytes+=bytes.length;if(audioBytes>limits.audioBytes)throw Error('本次实验音频总量上限已到');
        const startMs=sessionBytes/32;sessionBytes+=bytes.length;audioClock.push({startMs,endMs:sessionBytes/32,at:performance.now()});if(audioClock.length>1200)audioClock.shift();
        asr.append(bytes);return;
      }
      const value=JSON.parse(data.toString());
      if(value.type==='start'){
        if(asr)throw Error('识别已开始');configure(value);
        asr=new VolcAsrStream({apiKey:env.VOLCENGINE_ASR_API_KEY,
          onResult:event=>{
            const interim=event.body.result?.text;if(interim)send({type:'interim',text:interim});
            for(const entry of tracker.consume(event)){
              if(entry.type==='identity-revision'){
                abort.abort();speechAbort.abort();abort=new AbortController();revision++;
                conversation.invalidateSpeakers([entry.before.speakerId,entry.after.speakerId]);
                send({type:'identity-revision',message:conversation.paused?'识别服务修订了目标声线，已暂停本次对话，请结束后重新开始。':'识别服务修订了声线，相关姓名与历史已清空。',...entry,...conversation.snapshot()});continue;
              }
              const {turn}=entry;
              const epoch=revision,readyAt=performance.now(),anchor=audioClock.find(c=>c.startMs<=turn.endMs&&c.endMs>=turn.endMs);
              const endAt=anchor?anchor.at-(anchor.endMs-turn.endMs):readyAt;
              tail=tail.then(()=>processTurn(turn,epoch,{readyAt,endAt}));
            }
            if(event.final)send({type:'asr-ended'});
          },onError:error=>{send({type:'error',message:error.message});asr?.close();ready=false;},onClose:()=>{ready=false;}});
        await asr.connect();if(closed){asr.close();return;}ready=true;send({type:'ready'});return;
      }
      if(value.type==='playback-start'){const receipt=speechReceipts.get(value.speechId);if(receipt&&Number.isFinite(value.bufferMs)&&value.bufferMs>=0&&value.bufferMs<60000)send({type:'latency',speechId:value.speechId,forTurn:receipt.forTurn,timings:{...receipt.timings,bufferMs:Math.round(value.bufferMs),heardAfterEndMs:Math.round(receipt.timings.firstAudioAfterEndMs+value.bufferMs)}});return;}
      if(value.type==='configure'){configure(value);return;}
      if(value.type==='finish'){asr?.finish();return;}
      if(value.type==='stop'){close();ws.close();return;}
      throw Error('未知实验操作');
    }catch(error){send({type:'error',message:error.message});}
  });
});
server.listen(port,'127.0.0.1',()=>console.log(`Volc speaker lab ready: http://127.0.0.1:${port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{for(const ws of wss.clients)ws.close();server.close(()=>process.exit(0));});
