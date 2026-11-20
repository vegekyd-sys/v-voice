import {randomInt} from 'node:crypto';

// The Voice service's own media leg to GPT Live: the ChatGPT (Codex) login is
// only admitted over WebRTC, so the server is the WebRTC peer and the phone,
// app and devices keep their existing relay. 48 kHz stereo Opus on the wire,
// 24 kHz mono PCM towards the relay.
const WIRE_RATE=48000,WIRE_CHANNELS=2,FRAME_SAMPLES=960,FRAME_MS=20,PAYLOAD_TYPE=111;
const REORDER_DEPTH=4,MAX_PENDING_INPUT_BYTES=WIRE_RATE*2*2; // two seconds of 48 kHz mono
// Digital silence still arrives as packets; only audible frames are V speaking.
const AUDIBLE=200;

// Linear resampling with the interpolation phase carried across packets.
export class PcmResampler {
  constructor(from,to){
    if(![16000,24000,48000].includes(from)||![24000,48000].includes(to))throw Error('不支持的采样率');
    Object.assign(this,{from,to,seen:0,made:0,last:null});
  }
  push(bytes){
    if(bytes.length%2)throw Error('PCM 帧不完整');
    if(this.from===this.to||!bytes.length)return bytes;
    const input=bytes.length/2,samples=new Int16Array(input+(this.last===null?0:1));
    let offset=0;if(this.last!==null){samples[0]=this.last;offset=1;}
    for(let i=0;i<input;i++)samples[i+offset]=bytes.readInt16LE(i*2);
    // `seen` input samples have been consumed; samples[0] is input sample `start`.
    const start=this.seen-(this.last===null?0:1),output=[];
    for(;;this.made++){
      const numerator=this.made*this.from,index=Math.floor(numerator/this.to)-start,fraction=(numerator%this.to)/this.to;
      if(index+1>=samples.length)break;
      output.push(Math.round(samples[index]*(1-fraction)+samples[index+1]*fraction));
    }
    this.seen+=input;this.last=samples[samples.length-1];
    const result=Buffer.alloc(output.length*2);for(let i=0;i<output.length;i++)result.writeInt16LE(output[i],i*2);return result;
  }
}
// Stereo 48 kHz to mono 24 kHz: average the channels, then a two-tap average per output sample.
export function wireToRelayPcm(stereo){
  const frames=Math.floor(stereo.length/8),result=Buffer.alloc(frames*2);
  for(let i=0;i<frames;i++){
    const a=(stereo.readInt16LE(i*8)+stereo.readInt16LE(i*8+2))/2,b=(stereo.readInt16LE(i*8+4)+stereo.readInt16LE(i*8+6))/2;
    result.writeInt16LE(Math.round((a+b)/2),i*2);
  }
  return result;
}
export function monoToStereo(mono){
  const result=Buffer.alloc(mono.length*2);
  for(let i=0;i<mono.length;i+=2){const sample=mono.readInt16LE(i);result.writeInt16LE(sample,i*2);result.writeInt16LE(sample,i*2+2);}
  return result;
}
const forward=(expected,sequence)=>sequence-expected+65536&65535;

export class GptLivePeer {
  // `werift` and `OpusScript` are injected so tests run without a network stack.
  constructor({werift,OpusScript,inputSampleRate=24000,onAudio=()=>{},onError=()=>{},onState=()=>{},iceServers,now=()=>Date.now()}){
    Object.assign(this,{werift,OpusScript,onAudio,onError,onState,now});
    this.peer=new werift.RTCPeerConnection({codecs:{audio:[werift.useOPUS({payloadType:PAYLOAD_TYPE})],video:[]},...(iceServers?{iceServers}:{})});
    this.transceiver=this.peer.addTransceiver('audio',{direction:'sendrecv'});
    this.encoder=new OpusScript(WIRE_RATE,WIRE_CHANNELS,OpusScript.Application.VOIP);
    this.input=new PcmResampler(inputSampleRate,WIRE_RATE);
    this.pending=Buffer.alloc(0);this.sequence=randomInt(65536);this.timestamp=randomInt(4294967296);
    this.closed=false;this.connected=false;this.tracks=new Set();this.streams=new Map();this.current=null;
    this.stats={rtpIn:0,rtpOut:0,pcmOut:0,peak:0,sources:0};
    this.peer.onTrack.subscribe(track=>this.attach(track));
    this.peer.connectionStateChange.subscribe(state=>{
      if(this.closed)return;
      this.onState(state);
      if(state==='connected'){this.connected=true;this.pump();}
      else if(['failed','disconnected','closed'].includes(state)){this.connected=false;this.onError(Error(`GPT Live 媒体连接${state==='failed'?'失败':'已断开'}`));}
    });
  }
  async offer(){
    await this.peer.setLocalDescription(await this.peer.createOffer());
    const sdp=this.peer.localDescription?.sdp;if(!sdp?.trim())throw Error('没有生成 SDP offer');return sdp;
  }
  async answer(sdp){
    await this.peer.setRemoteDescription({type:'answer',sdp});
    this.attach(this.transceiver.receiver.track);
  }
  // Microphone PCM (mono, the session's input rate). Paced out by the pump at 20 ms.
  sendAudio(bytes){
    if(this.closed||bytes.length<2)return;
    const wire=this.input.push(bytes);
    this.pending=this.pending.length?Buffer.concat([this.pending,wire]):wire;
    // A stalled connection must not replay old speech later: keep the newest audio.
    if(this.pending.length>MAX_PENDING_INPUT_BYTES)this.pending=this.pending.subarray(this.pending.length-MAX_PENDING_INPUT_BYTES);
  }
  // Frames follow the clock, not the timer: a timer that fires late would otherwise stretch
  // the caller's speech (the model heard the tail of a sentence after it had already answered).
  pump(){
    if(this.timer||this.closed)return;
    this.pumpAt=this.now();this.framesSent=0;
    this.timer=setInterval(()=>this.tick(),FRAME_MS/2);this.timer.unref?.();this.tick();
  }
  tick(){
    const due=Math.floor((this.now()-this.pumpAt)/FRAME_MS)+1;
    if(due-this.framesSent>25)this.framesSent=due-1; // stalled process: do not replay a backlog
    for(let burst=0;this.framesSent<due&&burst<4;burst++){this.frame();this.framesSent++;}
  }
  frame(){
    if(!this.connected||this.closed)return;
    try{
      const bytes=FRAME_SAMPLES*2,mono=Buffer.alloc(bytes); // silence keeps the stream's cadence
      this.pending.copy(mono,0,0,bytes);this.pending=this.pending.subarray(Math.min(bytes,this.pending.length));
      const packet=this.encoder.encode(monoToStereo(mono),FRAME_SAMPLES);
      const rtp=new this.werift.RtpPacket(new this.werift.RtpHeader({marker:false,payloadType:PAYLOAD_TYPE,sequenceNumber:this.sequence,timestamp:this.timestamp}),Buffer.from(packet));
      this.sequence=this.sequence+1&65535;this.timestamp=this.timestamp+FRAME_SAMPLES>>>0;this.stats.rtpOut++;
      Promise.resolve(this.transceiver.sender.sendRtp(rtp)).catch(()=>{if(!this.closed)this.onError(Error('GPT Live 媒体发送失败'));});
    }catch{this.onError(Error('GPT Live 媒体编码失败'));}
  }
  attach(track){
    if(!track||track.kind!=='audio'||this.tracks.has(track))return;
    this.tracks.add(track);track.onReceiveRtp.subscribe(packet=>this.receive(packet));
  }
  // Each RTP source has its own sequence space and decoder state. The service may send
  // silence on one source and V's voice on another (call f43963b5: 342 packets, peak 0);
  // one shared sequence window dropped the second source as "late".
  stream(ssrc){
    let stream=this.streams.get(ssrc);
    if(!stream){
      if(this.streams.size>=4){
        const oldest=[...this.streams.values()].sort((a,b)=>a.lastAt-b.lastAt)[0];
        clearTimeout(oldest.timer);try{oldest.decoder.delete();}catch{}
        this.streams.delete(oldest.ssrc);if(this.current===oldest)this.current=null;
      }
      stream={ssrc,decoder:new this.OpusScript(WIRE_RATE,WIRE_CHANNELS,this.OpusScript.Application.VOIP),next:undefined,packets:new Map(),timer:null,lastAt:0,loudAt:0};
      this.streams.set(ssrc,stream);this.stats.sources++;
    }
    return stream;
  }
  receive(packet){
    if(this.closed)return;
    this.stats.rtpIn++;
    try{
      const state=this.stream(packet.header.ssrc??0),sequence=packet.header.sequenceNumber;
      state.lastAt=this.now();
      if(state.next===undefined){state.next=sequence+1&65535;this.decode(state,packet);return;}
      const distance=forward(state.next,sequence);
      if(distance>=32768||state.packets.has(sequence))return; // late or duplicate
      if(distance===0){state.next=state.next+1&65535;this.decode(state,packet);this.drain(state);return;}
      state.packets.set(sequence,packet);
      if(state.packets.size>=REORDER_DEPTH)this.skip(state);
      else if(!state.timer){state.timer=setTimeout(()=>{state.timer=null;if(!this.closed)this.skip(state);},80);state.timer.unref?.();}
    }catch{this.onError(Error('GPT Live 媒体解码失败'));}
  }
  // Give up on the missing packets before the nearest one that did arrive.
  skip(state){
    if(!state.packets.size)return;
    state.next=[...state.packets.keys()].sort((a,b)=>forward(state.next,a)-forward(state.next,b))[0];this.drain(state);
  }
  drain(state){
    for(let packet;(packet=state.packets.get(state.next));){state.packets.delete(state.next);state.next=state.next+1&65535;this.decode(state,packet);}
    if(!state.packets.size&&state.timer){clearTimeout(state.timer);state.timer=null;}
  }
  decode(state,packet){
    if(!packet.payload?.length)return;
    const pcm=wireToRelayPcm(Buffer.from(state.decoder.decode(packet.payload)));
    if(!pcm.length)return;
    this.stats.pcmOut+=pcm.length;
    let loud=false;
    for(let i=0;i+1<pcm.length;i+=16){const sample=Math.abs(pcm.readInt16LE(i));if(sample>this.stats.peak)this.stats.peak=sample;if(sample>AUDIBLE)loud=true;}
    const now=this.now();
    if(loud)state.loudAt=now;
    // One voice reaches the caller: the source that is speaking. Another source takes over only
    // when it speaks while the current one has been quiet (or gone) for a moment.
    if(this.current!==state){
      if(!loud)return;
      const current=this.current;
      if(current&&now-current.loudAt<400&&now-current.lastAt<400)return;
      this.current=state;
    }
    this.onAudio(pcm);
  }
  close(){
    if(this.closed)return;this.closed=true;this.connected=false;
    clearInterval(this.timer);this.pending=Buffer.alloc(0);
    for(const stream of this.streams.values()){clearTimeout(stream.timer);stream.packets.clear();try{stream.decoder.delete();}catch{}}
    this.streams.clear();this.current=null;
    try{this.encoder.delete();}catch{}
    Promise.resolve(this.peer.close()).catch(()=>{});
  }
}
