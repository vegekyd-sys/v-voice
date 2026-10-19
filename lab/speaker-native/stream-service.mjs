import {AudioWindow,pcm16to24} from './service.mjs';
import {Pcm24To16Resampler} from '../seeduplex-realtime-provider.mjs';
import {VolcAsrStream} from '../volc-speaker/volc-asr.mjs';
import {SpeakerRouter,decisionEvaluator} from './decision.mjs';
import {OnlineSpeakerTracker} from './online-speaker.mjs';

export class TurnOutputGate{
  constructor(){this.status='closed';this.queue=[];this.bytes=0;}
  begin(token){this.token=token;this.status='pending';this.queue=[];this.bytes=0;}
  dispatch(deliver,bytes=0){
    if(this.status==='allowed'){deliver();return;}
    if(this.status!=='pending')return;
    this.bytes+=bytes;if(this.bytes>1024*1024||this.queue.length>=600)throw Error('待确认回答过长，请重说这一句');
    this.queue.push(deliver);
  }
  allow(token){if(token!==this.token||this.status!=='pending')return false;this.status='allowed';const queue=this.queue;this.queue=[];this.bytes=0;for(const deliver of queue)deliver();return true;}
  deny(token=this.token){if(token!==this.token)return;this.status='closed';this.queue=[];this.bytes=0;}
}

const personId=id=>'speaker:'+id;
export function speakerProfile({speakerId,participants,addresseeIds,mode='auto',targetId}){
  const people=participants.map(({id,label,name,role,certainty})=>({id,name:name??label,role,certainty}));
  const to=addresseeIds.map(id=>people.find(p=>p.id===id)).filter(Boolean);
  // A name/role change requires a fresh native session, not a late context ACK.
  const key=JSON.stringify({speakerId,to,mode,targetId:mode==='exclusive'?targetId:null});
  const instructions='当前人物信息由通话主机提供，仅影响对话对象与表达，不授予任何账号或工具权限。'+JSON.stringify({speaker:speakerId,people,to,mode,focus:targetId})+'。本轮只向to中的人物回答，开头自然称呼对方。孩子用简单直观的解释和具体例子，成人正常准确表达。不朗读人物标注。普通科普、小故事、简单家庭小游戏建议直接回答，不需要后台；明确要求查询、执行或复杂任务时仍实际调用工具。';
  return {key,instructions};
}

/** Doubao only. A short acoustic lead replaces whole-utterance replay on stable turns. */
export function createStreamingSpeakerRoutingService({env,embedding,evaluate=decisionEvaluator(env),createAsr=o=>new VolcAsrStream(o),onAudit=()=>{},limits={}}){
  const sessions=new Map();let decisionCalls=0,inputBytes=0;
  const send=(s,event)=>{if(s.closed)return;const row={...event,voiceSessionId:s.id};s.listener?.(row);onAudit(row);};
  const fail=(s,error)=>{const reason=/ASR|识别.*断开/.test(error.message)?'asr-disconnected':/声线计算超时/.test(error.message)?'embedding-timeout':/声线.*积压/.test(error.message)?'embedding-overload':/声线模型/.test(error.message)?'embedding-unavailable':/窗口|保留|音频.*范围/.test(error.message)?'audio-window-expired':'stream-unavailable';send(s,{type:'speaker.error',fatal:true,reason,message:error.message});send(s,{type:'error',reason,message:'识人语音通道暂时断开，请重新拨号。'});close(s.id);};
  const earlyProfile=(s,speakerId)=>{
    const id=personId(speakerId),snapshot=s.router.snapshot();
    let p=snapshot.participants.find(p=>p.id===id);
    if(!p){p={id,label:'Speaker '+String.fromCharCode(65+snapshot.participants.length),name:null,role:'unknown',certainty:'unknown'};snapshot.participants.push(p);}
    return speakerProfile({...snapshot,speakerId:id,addresseeIds:[id],targetId:snapshot.targetId??id});
  };
  const feed=async(s,c,profile,approved=false)=>{
    if(s.closed||c.cancelled)return;
    clearTimeout(s.responseDeadline);
    if(s.input&&s.input!==c){s.input.cancelled=true;s.gate.deny(s.input.token);}
    s.input=c;c.profileKey=profile.key;s.gate.begin(c.token);s.native.cancel?.();s.nativeBusy=false;
    const preparedAt=performance.now();
    try{c.preparation=s.native.prepare(profile.instructions,profile.key,s.acceptedHistory.slice(-6));await c.preparation;}
    catch(error){if(!s.closed&&!c.cancelled)fail(s,error);return;}
    if(s.closed||c.cancelled||s.input!==c)return;
    c.profileKey=profile.key;c.fed=true;c.cursor=Math.max(0,c.startMs-80);s.prepared=true;
    if(approved)s.gate.allow(c.token);
    send(s,{type:'speaker.stream-start',token:c.token,speakerId:c.speakerId,startMs:c.startMs,bufferMs:Math.round(s.window.bytes/32-c.startMs),prepareMs:Math.round(performance.now()-preparedAt),fallback:Boolean(c.fallback)});
  };
  const recover=async(s,reason,authorized=false)=>{
    if(s.closed||s.router.mode==='exclusive'&&!authorized||performance.now()-(s.lastRecoveryAt??-Infinity)<8000)return;
    s.lastRecoveryAt=performance.now();
    const c={token:'recovery'+(++s.serial),cancelled:false,decided:true,recovery:true,segmentIds:new Set()};
    if(s.input)s.input.cancelled=true;
    clearTimeout(s.responseDeadline);s.input=c;s.gate.begin(c.token);s.native.cancel?.();s.nativeBusy=false;
    send(s,{type:'speaker.recovery',reason,token:c.token});
    try{
      await s.native.prepare('刚才输入未能可靠区分。只简短请对方重新说一句或轮流说话，不猜身份，不调用工具。','speaker-recovery',[]);
      if(s.closed||s.input!==c||c.cancelled)return;
      s.prepared=true;s.gate.allow(c.token);
      s.native.clarify?.(reason==='mixed-speakers'?'刚才你们的声音重叠了，请轮流说，我在听。':'刚才那句我没听清，请再说一次，我在听。');
    }catch(error){if(!s.closed&&s.input===c)send(s,{type:'speaker.error',reason:'recovery-unavailable',message:'这句没听清，请再说一次。'});}
  };
  const identified=(s,e)=>{
    const seg=e.segment;
    send(s,{type:'speaker.identity',speakerId:seg.speakerId,startMs:seg.startMs,afterStartMs:e.afterStartMs,inferenceMs:e.inferenceMs});
    if(s.router.mode==='exclusive'&&personId(seg.speakerId)!==s.router.targetId)return;
    const previous=s.input;
    if(previous&&!previous.decided&&!previous.cancelled&&previous.speakerId===seg.speakerId&&seg.startMs-(previous.endMs??seg.startMs)<1000){previous.segmentIds.add(seg.id);previous.endMs=seg.endMs;return;}
    // While V is already talking, semantic admission stays conservative so a
    // bystander's speech cannot prematurely clear the accepted reply.
    if(s.nativeBusy)return;
    const c={token:'stream'+(++s.serial),speakerId:seg.speakerId,startMs:seg.startMs,endMs:seg.endMs,segmentIds:new Set([seg.id])};
    void feed(s,c,earlyProfile(s,seg.speakerId));
  };
  const enqueue=(s,turn)=>{
    if(turn.endMs<=(s.typedAtMs??-1))return;
    s.latestFinalEnd=Math.max(s.latestFinalEnd??0,turn.endMs);
    s.tail=s.tail.then(()=>process(s,turn)).catch(error=>fail(s,error));
  };
  const process=async(s,turn)=>{
    if(s.closed)return;
    const inputAt=performance.now(),anchor=s.clock.find(c=>c.startMs<=turn.endMs&&c.endMs>=turn.endMs),endAt=anchor?anchor.at-(anchor.endMs-turn.endMs):inputAt;
    send(s,{type:'speaker.utterance',turn});
    let result;try{result=await s.router.accept(turn,{signal:s.abort.signal});}catch(error){
      if(s.closed)return;
      if(turn.endMs<(s.latestFinalEnd??0)-200){send(s,{type:'speaker.superseded',reason:'stale-decision-error',turn});return;}
      if(s.input)s.input.cancelled=true;
      s.gate.deny();s.native.cancel?.();s.native.invalidate?.();s.nativeBusy=false;
      send(s,{type:'speaker.error',message:'这一句人物判断未完成，请再说一次。',reason:error.name==='TimeoutError'?'decision-timeout':'decision-unavailable'});
      await recover(s,'decision-unavailable');return;
    }
    if(s.closed)return;
    const timings={asrMs:Math.round(inputAt-endAt),decisionMs:result.decisionMs??0,afterEndMs:Math.round(performance.now()-endAt)};
    send(s,{type:'speaker.decision',...result,timings});
    if(turn.endMs<(s.latestFinalEnd??0)-200){send(s,{type:'speaker.superseded',reason:'newer-final-turn',turn});return;}
    if(result.endCall){
      if((s.tracker.current?.lastVoiceMs??0)>turn.endMs+200){send(s,{type:'speaker.superseded',reason:'speech-after-farewell',turn});return;}
      if(s.input)s.input.cancelled=true;
      clearTimeout(s.responseDeadline);s.gate.deny();s.native.cancel?.();s.nativeBusy=false;
      const control={token:'ending'+(++s.serial),speakerId:turn.speakerId,decided:true,ending:true,segmentIds:new Set()};s.input=control;
      // A fresh native connection cannot leak delayed transcription or a prior
      // person's reply into the farewell. Existing background owners are kept.
      const profile=speakerProfile({speakerId:result.turn.speakerId,...result});
      await s.native.prepare(profile.instructions,'speaker-end:'+result.turn.id,s.acceptedHistory.slice(-6));
      if(s.closed||s.input!==control||control.cancelled)return;
      if(turn.endMs<(s.latestFinalEnd??0)-200||(s.tracker.current?.lastVoiceMs??0)>turn.endMs+200){control.cancelled=true;send(s,{type:'speaker.end-revoked',reason:'newer-speech-during-prepare'});return;}
      s.prepared=true;s.gate.begin(control.token);s.gate.allow(control.token);
      send(s,{type:'speaker.end-accepted',turn:result.turn});
      s.responseDeadline=setTimeout(()=>{if(s.closed||s.input!==control||control.cancelled||control.responded)return;control.ending=false;s.native.cancelEnd?.();s.native.cancel?.();s.gate.deny();send(s,{type:'speaker.error',reason:'farewell-no-audio',message:'告别语音暂时没有播放，可以再说一次拜拜，或点挂断。'});},limits.farewellMs??15000);s.responseDeadline.unref?.();
      s.native.end?.({turnId:result.turn.id});return;
    }
    const c=s.input,matches=c&&!c.cancelled&&c.speakerId===turn.speakerId&&c.startMs<turn.endMs&&(!c.endMs||c.endMs>=turn.startMs-200);
    if(!result.shouldRespond){if(matches){clearTimeout(s.responseDeadline);c.cancelled=true;s.gate.deny(c.token);s.native.cancel?.();s.native.invalidate?.();s.nativeBusy=false;}return;}
    send(s,{type:'speaker.admitted',turn:result.turn});
    const profile=speakerProfile({speakerId:result.turn.speakerId,...result});
    s.acceptedHistory.push({role:'user',text:turn.text});s.acceptedHistory=s.acceptedHistory.slice(-8);
    if(matches&&c.profileKey===profile.key&&!c.fed)await c.preparation;
    if(s.closed)return;
    if(s.input!==c||turn.endMs<(s.latestFinalEnd??0)-200){send(s,{type:'speaker.superseded',reason:'newer-input-during-prepare',turn});return;}
    if(matches&&c.fed&&c.profileKey===profile.key){c.decided=true;c.endMs=turn.endMs;s.gate.allow(c.token);send(s,{type:'speaker.stream-accepted',token:c.token,timings,avoidedReplayMs:Math.round(turn.endMs-turn.startMs)});return;}
    if(c){c.cancelled=true;s.gate.deny(c.token);s.native.cancel?.();}
    const fallback={token:'stream'+(++s.serial),speakerId:turn.speakerId,startMs:turn.startMs,endMs:turn.endMs,segmentIds:new Set(),fallback:true,decided:true};
    send(s,{type:'speaker.stream-fallback',reason:matches?'人物或回应对象已更新':'首次或身份未确认',timings});
    await feed(s,fallback,profile,true);
  };
  const normalizeFinals=(s,event)=>{
    const output=[];
    for(const entry of event.body?.result?.utterances??[]){
      // ASR's protobuf JSON omits zero-valued start_time on a first utterance.
      const raw={...entry,start_time:entry.start_time??0};
      if(!raw.definite||!raw.text?.trim()||!Number.isFinite(raw.start_time)||!Number.isFinite(raw.end_time))continue;
      const key=raw.start_time+':'+raw.end_time;if(s.seen.has(key))continue;
      if(raw.end_time<(s.latestFinalEnd??0)-200){s.seen.add(key);send(s,{type:'speaker.superseded',reason:'late-asr-final'});continue;}
      const overlaps=s.tracker.overlaps(raw.start_time,raw.end_time);
      if(overlaps.some(x=>x.segment.ambiguous)){s.seen.add(key);void recover(s,'mixed-speakers');continue;}
      let ids=[...new Set(overlaps.map(x=>x.segment.speakerId).filter(Boolean))];
      if(ids.length<=1&&(!ids.length||overlaps.some(x=>!x.segment.speakerId&&x.ms>250))){
        if(s.backfilled.has(key)){
          const verified=s.backfilled.get(key);
          if(!verified){s.seen.add(key);s.gate.deny();s.native.cancel?.();s.native.invalidate?.();s.nativeBusy=false;if(s.input)s.input.cancelled=true;send(s,{type:'speaker.error',reason:'identity-uncertain',message:'这一句声线暂未确认，请再说一句完整的话。'});void recover(s,'identity-uncertain');continue;}
          ids=[verified];
        }else{
          if(raw.end_time-raw.start_time<400){s.seen.add(key);void recover(s,'short-utterance');continue;}
          if(!s.backfilling.has(key)){
            s.backfilling.add(key);
            let pcm;try{pcm=s.window.slice(raw.start_time,Math.min(raw.end_time,raw.start_time+8000));}catch{s.backfilling.delete(key);s.seen.add(key);void recover(s,'audio-window-expired');continue;}
            void s.tracker.verifyWindow(pcm).then(id=>{if(s.closed)return;s.backfilled.set(key,id);for(const turn of normalizeFinals(s,s.latestAsr))enqueue(s,turn);}).catch(error=>fail(s,error));
          }
          continue;
        }
      }
      if(ids.length>1){
        if(!raw.words?.length){send(s,{type:'speaker.error',message:'这一句多人声音混在一起，请轮流说话。'});s.seen.add(key);s.gate.deny();s.native.cancel?.();s.native.invalidate?.();s.nativeBusy=false;if(s.input)s.input.cancelled=true;void recover(s,'mixed-speakers');continue;}
        const groups=[];
        for(const word of raw.words){const mid=((word.start_time??0)+(word.end_time??raw.end_time))/2;const owner=overlaps.find(x=>x.segment.speakerId&&mid>=x.segment.startMs&&mid<=(x.segment.endMs??s.window.bytes/32))?.segment;
          if(!owner)continue;let g=groups.at(-1);if(!g||g.speakerId!==owner.speakerId){g={speakerId:owner.speakerId,startMs:word.start_time,endMs:word.end_time,text:''};groups.push(g);}g.text+=word.text??'';g.endMs=word.end_time;}
        if(!groups.length){s.seen.add(key);void recover(s,'mixed-speakers');continue;}output.push(...groups.filter(g=>g.text.trim()&&g.endMs>g.startMs));
      }else output.push({speakerId:ids[0],startMs:raw.start_time,endMs:raw.end_time,text:raw.text.trim()});
      s.seen.add(key);
    }
    const merged=[];for(const turn of output){const last=merged.at(-1);if(last&&last.speakerId===turn.speakerId&&turn.startMs-last.endMs<1200){last.text+=turn.text;last.endMs=turn.endMs;}else merged.push(turn);}return merged;
  };
  const connectAsr=async(s,startMs=0)=>{
    const epoch=++s.asrEpoch;s.asrReady=false;
    const recoverAsr=error=>{
      if(s.closed||epoch!==s.asrEpoch)return;
      s.asrEpoch++;s.asrReady=false;s.asr?.close();
      const now=performance.now();s.asrRetries=s.asrRetries.filter(t=>now-t<60000);
      if(s.asrRetries.length>=2){fail(s,error);return;}
      s.asrRetries.push(now);send(s,{type:'speaker.asr-reconnecting',reason:'asr-disconnected'});
      const resumeMs=Math.max(0,s.window.bytes/32-400);
      s.asrRetry=setTimeout(()=>void connectAsr(s,resumeMs).catch(e=>fail(s,e)),250);s.asrRetry.unref?.();
    };
    const shift=u=>({...u,start_time:(u.start_time??0)+startMs,end_time:Number.isFinite(u.end_time)?u.end_time+startMs:u.end_time,...u.words?{words:u.words.map(shift)}:{}});
    const asr=createAsr({apiKey:env.VOLCENGINE_ASR_API_KEY,onResult:event=>{
      if(s.closed||epoch!==s.asrEpoch)return;
      const result=event.body?.result;const absolute=result?{...event,body:{...event.body,result:{...result,utterances:(result.utterances??[]).map(shift)}}}:event;
      s.latestAsr=absolute;
      if(env.VOICE_STREAM_SYNTHETIC_TRACE==='1')send(s,{type:'speaker.asr-state',utterances:(absolute.body?.result?.utterances??[]).map(u=>({definite:u.definite,startMs:u.start_time,endMs:u.end_time,textLength:u.text?.length}))});
      for(const turn of normalizeFinals(s,absolute))enqueue(s,turn);
    },onError:recoverAsr,onClose:()=>recoverAsr(Error('语音识别已断开'))});s.asr=asr;
    try{await asr.connect();}catch(error){recoverAsr(error);return;}
    if(s.closed||epoch!==s.asrEpoch){asr.close();return;}
    s.asrReady=true;
    const end=s.window.bytes/32,from=Math.max(startMs,end-3000);
    // ASR is nonstream-capable; at most three seconds recover from the existing
    // private ring buffer. All returned timestamps retain the absolute origin.
    if(from>startMs){s.asrEpoch++;asr.close();void connectAsr(s,from).catch(error=>fail(s,error));return;}
    for(let at=from;at<end;at+=100)asr.append(s.window.slice(at,Math.min(end,at+100)));
    if(startMs>0)send(s,{type:'speaker.asr-recovered'});
  };
  const close=id=>{const s=sessions.get(id);if(!s)return;send(s,{type:'speaker.closed',decisionCalls:s.decisionCalls,inputSeconds:s.inputBytes/48000});s.closed=true;s.abort.abort();if(s.input)s.input.cancelled=true;s.gate.deny();clearInterval(s.timer);clearTimeout(s.responseDeadline);clearTimeout(s.asrRetry);clearTimeout(s.expiry);s.asr?.close();s.tracker.close();s.window.chunks=[];s.listener=null;sessions.delete(id);};
  return {
    reserve(id,{model,policy='speaker'}={}){
      if(model!=='seeduplex'||policy==='native')return null;
      const s={id,decisionCalls:0,inputBytes:0,router:new SpeakerRouter({evaluate:async(...args)=>{decisionCalls++;if(++s.decisionCalls>(limits.decisionCalls??300))throw Error('本轮判断预算已用完');return evaluate(...args);}}),window:new AudioWindow(),resampler:new Pcm24To16Resampler(),clock:[],gate:new TurnOutputGate(),abort:new AbortController(),acceptedHistory:[],seen:new Set(),backfilled:new Map(),backfilling:new Set(),serial:0,asrEpoch:0,asrRetries:[],tail:Promise.resolve(),ready:false,nativeBusy:false,closed:false};
      s.tracker=new OnlineSpeakerTracker({embed:pcm=>embedding.compute(pcm),onEvent:e=>{
        if(s.closed)return;
        if(e.type==='start'&&s.input?.ending){s.input.cancelled=true;s.gate.deny();s.native.cancelEnd?.();s.native.cancel?.();s.nativeBusy=false;send(s,{type:'speaker.end-revoked',reason:'new-speech'});}
        if(e.type==='identified')identified(s,e);
        if(e.type==='end'&&s.input?.segmentIds.has(e.segment.id))s.input.endMs=e.segment.endMs;
        if(e.type==='revision'){if(s.input?.segmentIds.has(e.segment.id)){s.input.cancelled=true;s.gate.deny();s.native.cancel?.();s.native.invalidate?.();s.nativeBusy=false;}send(s,{type:'speaker.stream-fallback',reason:'短片段声线需要复核'});}
        if(e.type==='error')fail(s,Error(e.message));
      }});
      sessions.set(id,s);s.expiry=setTimeout(()=>fail(s,Error('本次候选通话已达时长上限，请重拨')),limits.durationMs??1800000);s.expiry.unref?.();
      return {voiceSessionId:id,model,transport:'relay',policy:'streaming'};
    },
    async text(id,text){
      const s=sessions.get(id);if(!s||s.closed)throw Error('通话已结束');
      if(s.input)s.input.cancelled=true;clearTimeout(s.responseDeadline);s.gate.deny();s.native.cancelEnd?.();s.native.cancel?.();s.nativeBusy=false;
      const c={token:'keyboard'+(++s.serial),decided:true,segmentIds:new Set()};s.input=c;s.typedAtMs=s.window.bytes/32;s.gate.begin(c.token);
      await s.native.prepare('当前这一轮是电话本人在键盘输入的文字，不依据上一位声音猜输入者的名字或年龄；按本人原有方式回答。','keyboard-input',s.acceptedHistory.slice(-6));
      if(s.closed||s.input!==c||c.cancelled)return;s.prepared=true;s.gate.allow(c.token);s.native.context(text);
    },
    has:id=>sessions.has(id),lazyNative:id=>sessions.has(id),controlsEnding:id=>sessions.has(id),
    pending:id=>sessions.get(id)?.gate.status==='pending',
    async bind(id,native,listener){
      const s=sessions.get(id);if(!s)return;s.native=native;s.listener=listener;await embedding.ready;
      await connectAsr(s);if(s.closed)return;s.ready=true;
      s.timer=setInterval(()=>{
        if(s.closed||!s.prepared)return;
        const c=s.input;
        try{
          if(c?.fed&&!c.cancelled&&c.decided&&!c.inputComplete&&c.cursor>=c.endMs){
            c.inputComplete=true;send(s,{type:'speaker.native-input-complete',token:c.token,endMs:c.endMs});
            if(!c.responded){s.responseDeadline=setTimeout(()=>{if(!s.closed&&s.input===c&&!c.cancelled&&s.gate.status==='allowed'&&!c.responded)void recover(s,'native-no-output',true);},limits.responseMs??12000);s.responseDeadline.unref?.();}
          }
          if(c?.fed&&!c.cancelled){
            const end=c.endMs===null?s.window.bytes/32:c.endMs+700;
            if(c.cursor+20<=Math.min(end,s.window.bytes/32)){native.forward(pcm16to24(s.window.slice(c.cursor,c.cursor+20)));c.cursor+=20;
              return;}
          }
          native.forward(Buffer.alloc(960));
        }catch(error){fail(s,error);}
      },20);s.timer.unref?.();send(s,{type:'speaker.ready',streaming:true});
    },
    audio(id,pcm24){const s=sessions.get(id);if(!s?.ready||s.closed)throw Error('流式识人尚未就绪');inputBytes+=pcm24.length;s.inputBytes+=pcm24.length;if(s.inputBytes>48000*(limits.inputSeconds??1800))throw Error('本轮音频预算已用完');const pcm=s.resampler.push(pcm24),startMs=s.window.bytes/32;s.window.append(pcm);s.clock.push({startMs,endMs:s.window.bytes/32,at:performance.now()});if(s.clock.length>1200)s.clock.shift();if(s.asrReady)s.asr.append(pcm);s.tracker.push(pcm);
      if(s.latestAsr)for(const turn of normalizeFinals(s,s.latestAsr))enqueue(s,turn);return true;},
    dispatch(id,kind,value,deliver){const s=sessions.get(id);if(!s)return false;if(s.gate.status!=='closed'){if(kind==='audio')s.nativeBusy=true;if(kind==='done')s.nativeBusy=false;}try{const c=s.input;s.gate.dispatch(()=>{if(kind==='tool'&&value.name==='end_call'){s.native.rejectNativeEnd?.(value);send(s,{type:'speaker.end-withheld',reason:'native-end-unconfirmed'});return;}if(c&&s.input===c&&['audio','tool'].includes(kind)){c.responded=true;clearTimeout(s.responseDeadline);}deliver();},kind==='audio'?value.length:0);}catch(error){if(s.input)s.input.cancelled=true;s.gate.deny();s.native.cancel?.();s.native.invalidate?.();s.nativeBusy=false;send(s,{type:'speaker.error',message:error.message});}return true;},
    assistant(id,text){const s=sessions.get(id);if(s&&text?.trim()){s.router.assistant(text);s.acceptedHistory.push({role:'assistant',text:text.slice(-800)});s.acceptedHistory=s.acceptedHistory.slice(-8);}},
    initialInstructions(id,text){return sessions.has(id)?text.replace('现在正在电话中和 Tianyi（天意）本人交流','正在电话中与主机当前指定的人物交流；账号与工具仍属于原电话入口，不随人物切换'):text;},
    close,upgrade(_req,socket){socket.destroy();},
    snapshot:()=>({enabled:true,streaming:true,activeSessions:sessions.size,decisionCalls,inputSeconds:inputBytes/48000}),
    dispose(){for(const id of sessions.keys())close(id);},
  };
}
