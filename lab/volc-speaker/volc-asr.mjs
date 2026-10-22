import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { WebSocket } from 'ws';

export const ASR_RESOURCE = 'volc.seedasr.sauc.duration';
export const ASR_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';

export function encodeAsrFrame(type, data, {json=false,last=false}={}) {
  const payload = gzipSync(json ? Buffer.from(JSON.stringify(data)) : data);
  const size = Buffer.alloc(4); size.writeUInt32BE(payload.length);
  return Buffer.concat([Buffer.from([0x11,(type<<4)|(last?2:0),(json?0x10:0)|1,0]),size,payload]);
}

export function decodeAsrFrame(data) {
  const frame = Buffer.from(data);
  if(frame.length<8)throw Error('Truncated ASR response');
  const type=frame[1]>>4,flags=frame[1]&15,compression=frame[2]&15;
  let offset=(frame[0]&15)*4,sequence,errorCode;
  if(type===15){errorCode=frame.readUInt32BE(offset);offset+=4;}
  else if(flags&1){sequence=frame.readInt32BE(offset);offset+=4;}
  const length=frame.readUInt32BE(offset);offset+=4;
  if(offset+length>frame.length)throw Error('Truncated ASR payload');
  const raw=frame.subarray(offset,offset+length);
  const payload=compression===1?gunzipSync(raw):raw;
  let body;try{body=JSON.parse(payload.toString());}catch{body={message:payload.toString().slice(0,500)};}
  return {type,flags,sequence,errorCode,body,final:Boolean(flags&2)};
}

export class VolcAsrStream {
  constructor({apiKey,resource=ASR_RESOURCE,voiceprints,identifyOnly=false,speakerInfo=true,nonstream=true,onResult=()=>{},onError=()=>{},onClose=()=>{},createWebSocket=(url,options)=>new WebSocket(url,options),setupTimeoutMs=10000}){
    this.apiKey=apiKey;this.resource=resource;this.voiceprints=voiceprints;this.identifyOnly=identifyOnly;
    this.pendingAudio=Buffer.alloc(0);this.onResult=onResult;this.onError=onError;this.onClose=onClose;this.requestId=randomUUID();
    this.createWebSocket=createWebSocket;this.setupTimeoutMs=setupTimeoutMs;
    this.speakerInfo=speakerInfo;this.nonstream=nonstream;
  }
  connect(){return new Promise((resolve,reject)=>{
    let settled=false;const settle=error=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(this);};
    const timer=setTimeout(()=>{settle(Error('ASR initialization timed out'));this.socket?.close();},this.setupTimeoutMs);timer.unref?.();
    this.socket=this.createWebSocket(ASR_URL,{headers:{'X-Api-Key':this.apiKey,'X-Api-Resource-Id':this.resource,
      'X-Api-Request-Id':this.requestId,'X-Api-Connect-Id':this.requestId},handshakeTimeout:15000,maxPayload:4*1024*1024});
    this.socket.on('upgrade',r=>{this.logId=r.headers['x-tt-logid'];});
    this.socket.once('unexpected-response',(_req,response)=>{
      response.resume();settle(Error(`ASR handshake rejected: HTTP ${response.statusCode}`));
    });
    this.socket.once('open',()=>{
      this.socket.send(encodeAsrFrame(1,{user:{uid:'v-speaker-lab'},
        audio:{format:'pcm',codec:'raw',rate:16000,bits:16,channel:1},
        request:{model_name:'bigmodel',enable_itn:true,enable_punc:true,show_utterances:true,
          enable_speaker_info:this.speakerInfo,enable_nonstream:this.nonstream,
          ...(this.identifyOnly?{ssd_mode:2}:{}),...(this.voiceprints?{voiceprints:this.voiceprints}:{})}},{json:true}));
      // A WebSocket open is not application readiness. Wait for the service's
      // initialization response before the caller can start uploading speech.
    });
    this.socket.on('message',data=>{
      try{const event=decodeAsrFrame(data);if(event.type===15||event.body.code&&event.body.code!==20000000){
        const error=Error(`ASR ${event.errorCode??event.body.code}: ${event.body.message??event.body.error??'rejected'}`);settle(error);this.onError(error);
      }else {if(event.type===9)settle();this.onResult({...event,requestId:this.requestId,logId:this.logId});}}
      catch(error){settle(error);this.onError(error);}
    });
    this.socket.on('error',error=>{settle(error);this.onError(error);});
    this.socket.on('close',()=>{settle(Error('ASR closed before initialization'));this.onClose();});
  });}
  append(pcm){
    if(this.socket?.readyState!==WebSocket.OPEN)return;
    this.pendingAudio=Buffer.concat([this.pendingAudio,pcm]);
    // Browser/native transport stays at 20ms. The cloud recognizer receives
    // bounded 100ms frames, independently of caller packet sizes.
    while(this.pendingAudio.length>=3200){this.socket.send(encodeAsrFrame(2,this.pendingAudio.subarray(0,3200)));this.pendingAudio=this.pendingAudio.subarray(3200);}
  }
  finish(){if(this.socket?.readyState!==WebSocket.OPEN)return;if(this.pendingAudio.length)this.socket.send(encodeAsrFrame(2,this.pendingAudio));this.pendingAudio=Buffer.alloc(0);this.socket.send(encodeAsrFrame(2,Buffer.alloc(0),{last:true}));}
  close(){this.pendingAudio=Buffer.alloc(0);this.socket?.close();}
}

export async function voiceprintRequest(apiKey, action, body){
  const response=await fetch(`https://openspeech.bytedance.com/api/proxy/invoke?Action=${encodeURIComponent(action)}`,{
    method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':apiKey},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  return {status:response.status,data:await response.json()};
}
