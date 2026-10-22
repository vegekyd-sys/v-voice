import {VolcAsrStream} from '../volc-speaker/volc-asr.mjs';
import {Pcm24To16Resampler} from '../seeduplex-realtime-provider.mjs';

// Speech control only. This lane cannot admit a turn, invoke a tool, cancel a
// task, or gate the continuous audio sent to the native speech model.
export function explicitSpeechStop(text,final=false){
  const value=String(text??'').replace(/[\s\p{P}\p{S}]/gu,'');
  return /^(?:等一下|等一等|等等|先停|停一下|暂停一下|先别说|别说了|别讲了|不要讲了|打住|听我说)/u.test(value)
    ||final&&/^(?:停|暂停)$/u.test(value);
}

export class NativeInterruptAsr{
  constructor({apiKey,inputSampleRate=24000,isSpeaking=()=>false,getResponseId,onInterrupt=()=>{},onStatus=()=>{},createAsr=o=>new VolcAsrStream(o)}){
    if(!apiKey)throw Error('Native interruption ASR credential missing');
    if(![16000,24000].includes(inputSampleRate))throw Error('Unsupported speech-control input rate');
    this.apiKey=apiKey;this.inputSampleRate=inputSampleRate;this.isSpeaking=isSpeaking;this.getResponseId=getResponseId;this.windows=[];
    this.onInterrupt=onInterrupt;this.onStatus=onStatus;this.createAsr=createAsr;
    this.resampler=new Pcm24To16Resampler();this.inputBytes=0;this.offsetMs=0;
    this.lastControlStart=-Infinity;this.epoch=0;this.ready=false;this.closed=false;this.retries=[];
  }
  async connect(){
    if(this.closed)throw Error('Speech control is closed');
    const epoch=++this.epoch;
    const asr=this.createAsr({apiKey:this.apiKey,speakerInfo:false,nonstream:false,
      onResult:e=>{if(!this.closed&&epoch===this.epoch)this.result(e);},
      onError:()=>this.lost(epoch),onClose:()=>this.lost(epoch)});
    this.asr=asr;
    try{await asr.connect();}catch(error){asr.close();throw error;}
    if(this.closed||epoch!==this.epoch){asr.close();throw Error('Speech control connection superseded');}
    this.offsetMs=this.inputBytes/32;this.ready=true;this.onStatus('ready');
  }
  result(event){
    if(!this.ready)return;
    for(const turn of event.body?.result?.utterances??[]){
      const start=this.offsetMs+(turn.start_time??0);
      if(!Number.isFinite(start)||start<=this.lastControlStart+750||!explicitSpeechStop(turn.text,turn.definite===true))continue;
      // Mark even an idle control: replayed ASR history cannot later cancel a
      // new response just because V started speaking after the original words.
      this.lastControlStart=start;
      // A delayed transcript must not cancel the answer to a newer user turn.
      if(this.getResponseId){const owner=this.windows.findLast(x=>x.startMs<=start)?.responseId;
        if(!owner||owner!==this.getResponseId())continue;}
      if(this.isSpeaking())this.onInterrupt();
    }
  }
  append(audio){
    if(this.closed)return;
    const pcm=this.inputSampleRate===16000?audio:this.resampler.push(audio);
    if(this.getResponseId){this.windows.push({startMs:this.inputBytes/32,responseId:this.isSpeaking()?this.getResponseId():null});
      if(this.windows.length>1600)this.windows.splice(0,this.windows.length-1600);}
    this.inputBytes+=pcm.length;
    if(this.ready){try{this.asr.append(pcm);}catch{this.lost(this.epoch);}}
  }
  lost(epoch){
    if(this.closed||epoch!==this.epoch)return;
    const wasReady=this.ready;this.ready=false;this.epoch++;this.asr?.close();
    if(!wasReady)return; // Initial setup belongs to the caller's readiness check.
    this.onStatus('reconnecting');
    const now=Date.now();this.retries=this.retries.filter(at=>now-at<60000);
    const wait=this.retries.length>=5?Math.max(1000,60000-(now-this.retries[0])):500;
    this.retries.push(now);
    this.retry=setTimeout(()=>{if(this.closed)return;void this.connect().catch(()=>{
      if(!this.closed){this.ready=true;this.lost(this.epoch);}
    });},wait);this.retry.unref?.();
  }
  close(){if(this.closed)return;this.closed=true;this.ready=false;this.epoch++;clearTimeout(this.retry);this.windows=[];this.asr?.close();}
}
