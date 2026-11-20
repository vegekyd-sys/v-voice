import test from 'node:test';import assert from 'node:assert/strict';
import {GptLivePeer,PcmResampler,wireToRelayPcm,monoToStereo} from './gpt-live-peer.mjs';
const pcm=samples=>{const b=Buffer.alloc(samples.length*2);samples.forEach((s,i)=>b.writeInt16LE(s,i*2));return b;};
const signal={subscribe(fn){(this.listeners??=[]).push(fn);},emit(v){for(const fn of this.listeners??[])fn(v);}};
function fakes(){
  const state={sent:[],peer:null,encoded:[],closed:false};
  class RTCPeerConnection{constructor(config){state.peer=this;this.config=config;this.onTrack={...signal,listeners:[]};this.connectionStateChange={...signal,listeners:[]};this.track={kind:'audio',onReceiveRtp:{...signal,listeners:[]}};}
    addTransceiver(){return {sender:{sendRtp:async packet=>{state.sent.push(packet);}},receiver:{track:this.track}};}
    async createOffer(){return {type:'offer',sdp:'v=0\r\noffer'};}
    async setLocalDescription(d){this.localDescription=d;}
    async setRemoteDescription(d){this.remote=d;}
    async close(){state.closed=true;}}
  const werift={RTCPeerConnection,useOPUS:o=>({mimeType:'audio/opus',...o}),RtpHeader:class{constructor(o){Object.assign(this,o);}},RtpPacket:class{constructor(header,payload){this.header=header;this.payload=payload;}}};
  class OpusScript{static Application={VOIP:2048};constructor(rate,channels){this.rate=rate;this.channels=channels;}
    encode(buffer,frame){state.encoded.push({bytes:buffer.length,frame});return Buffer.from([buffer.readInt16LE(0)&255,1]);}
    decode(packet){return monoToStereo(pcm(Array(480).fill(packet[0]*100)));}
    delete(){}}
  return {state,werift,OpusScript};
}
test('resampler keeps phase across packets and converts device and relay rates',()=>{
  const up=new PcmResampler(24000,48000),a=up.push(pcm([0,100,200,300])),b=up.push(pcm([400,500]));
  assert.deepEqual([...new Int16Array(a.buffer,a.byteOffset,a.length/2)],[0,50,100,150,200,250]);
  assert.deepEqual([...new Int16Array(b.buffer,b.byteOffset,b.length/2)],[300,350,400,450]);
  const device=new PcmResampler(16000,48000);assert.equal(device.push(pcm(Array(320).fill(7))).length,(320-1)*3*2);
  assert.equal(new PcmResampler(24000,24000).push(pcm([1,2])).length,4);
  assert.throws(()=>new PcmResampler(8000,48000),/采样率/u);assert.throws(()=>up.push(Buffer.alloc(3)),/不完整/u);
});
test('wire audio is averaged to relay mono and mono is doubled to stereo',()=>{
  const stereo=Buffer.alloc(16);[100,300,200,400,-100,-300,-200,-400].forEach((s,i)=>stereo.writeInt16LE(s,i*2));
  const mono=wireToRelayPcm(stereo);assert.deepEqual([mono.readInt16LE(0),mono.readInt16LE(2)],[250,-250]);
  assert.deepEqual([...new Int16Array(monoToStereo(pcm([5,-6])).buffer.slice(0,8))],[5,5,-6,-6]);
});
test('peer offers Opus, paces 20 ms RTP frames from microphone PCM and pads silence',async()=>{
  const {state,werift,OpusScript}=fakes(),errors=[];
  const peer=new GptLivePeer({werift,OpusScript,onError:e=>errors.push(e.message)});
  assert.equal(await peer.offer(),'v=0\r\noffer');await peer.answer('v=0\r\nanswer');
  assert.equal(state.peer.config.codecs.audio[0].payloadType,111);
  peer.sendAudio(pcm(Array(480).fill(1000))); // exactly one 20 ms frame at 24 kHz
  state.peer.connectionStateChange.emit('connected');
  assert.equal(state.sent.length,1);assert.deepEqual(state.encoded[0],{bytes:3840,frame:960});
  peer.frame();assert.equal(state.sent.length,2);assert.equal(state.sent[1].header.sequenceNumber,(state.sent[0].header.sequenceNumber+1)&65535);
  assert.equal(state.sent[1].header.timestamp,(state.sent[0].header.timestamp+960)>>>0);assert.equal(state.sent[1].header.payloadType,111);
  state.peer.connectionStateChange.emit('failed');assert.match(errors[0],/媒体连接失败/u);
  peer.close();assert.equal(state.closed,true);peer.frame();assert.equal(state.sent.length,2);
});
test('voice on a second RTP source is heard while the first carries only silence',()=>{
  const {state,werift,OpusScript}=fakes(),audio=[];let clock=1000;
  const peer=new GptLivePeer({werift,OpusScript,onAudio:b=>audio.push(b.readInt16LE(0)),now:()=>clock});
  state.peer.connectionStateChange.emit('connected');
  const rtp=(ssrc,sequenceNumber,value)=>({header:{ssrc,sequenceNumber},payload:Buffer.from([value])});
  // 342 silent packets on source A while V's voice starts on a new source B (unrelated sequence)
  for(let n=0;n<342;n++){clock+=20;peer.receive(rtp(111,100+n,0));}
  for(let n=0;n<10;n++){clock+=20;peer.receive(rtp(222,40000+n,50));}
  assert.deepEqual(audio,Array(10).fill(5000));
  assert.equal(peer.stats.sources,2);
  // a third source speaking over the current one is ignored; after the current goes quiet it takes over
  peer.receive(rtp(333,7,3));assert.equal(audio.length,10);
  clock+=500;peer.receive(rtp(333,8,3));assert.equal(audio.length,11);
  peer.close();
});
test('inbound RTP is decoded in order, a short gap is skipped, late packets are dropped',async()=>{
  const {state,werift,OpusScript}=fakes(),audio=[];
  const peer=new GptLivePeer({werift,OpusScript,onAudio:b=>audio.push(b.readInt16LE(0))});await peer.offer();await peer.answer('a');
  const rtp=(sequenceNumber,value)=>({header:{sequenceNumber},payload:Buffer.from([value*10,0])});
  const track=state.peer.track;peer.attach(track);
  track.onReceiveRtp.emit(rtp(10,1));track.onReceiveRtp.emit(rtp(12,3));assert.deepEqual(audio,[1000]);
  track.onReceiveRtp.emit(rtp(11,2));assert.deepEqual(audio,[1000,2000,3000]);
  track.onReceiveRtp.emit(rtp(10,9));assert.equal(audio.length,3); // late
  for(const n of [14,15,16,17])track.onReceiveRtp.emit(rtp(n,n-10));assert.deepEqual(audio.slice(3),[4000,5000,6000,7000]); // 13 never came
  track.onReceiveRtp.emit(rtp(18,8,));track.onReceiveRtp.emit({header:{sequenceNumber:19},payload:Buffer.alloc(0)});assert.equal(audio.length,8);
  peer.close();assert.equal(state.closed,true);peer.sendAudio(pcm([1,2]));
});
