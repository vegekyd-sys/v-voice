const PcmPlaybackQueue=class PcmPlaybackQueue {
  constructor(rate, prefillMs=120, maxFrames=8*1024*1024) {
    this.rate=rate;this.prefill=Math.ceil(rate*prefillMs/1000);this.maxFrames=maxFrames;this.clear();
  }
  clear(){this.chunks=[];this.head=0;this.offset=0;this.frames=0;this.phase=0;this.wait=0;this.playing=false;this.consumed=0;this.underflows=0;this.lastPlayedAt=null;this.complete=false;this.holdUntilComplete=false;this.paused=false;}
  hold(){this.holdUntilComplete=true;}
  end(){this.complete=true;this.holdUntilComplete=false;}
  push(pcm){this.complete=false;if(!(pcm instanceof Int16Array)||!pcm.length)throw Error('Invalid PCM');if(this.frames+pcm.length>this.maxFrames)throw Error('PCM queue overflow');this.chunks.push(pcm);this.frames+=pcm.length;}
  peek(offset){const c=this.chunks[this.head];const i=this.offset+offset;return i<c.length?c[i]:(this.chunks[this.head+1]?.[i-c.length]??c[c.length-1]);}
  advance(){this.offset++;this.frames--;this.consumed++;if(this.offset===this.chunks[this.head].length){this.chunks[this.head]=null;this.head++;this.offset=0;if(this.head>=32){this.chunks.splice(0,this.head);this.head=0;}}}
  render(out,at){
    out.fill(0);
    if(this.paused)return;
    if(this.holdUntilComplete&&!this.complete)return;
    if(!this.frames){if(this.playing){if(!this.complete)this.underflows++;this.playing=false;this.wait=0;}return;}
    // Even a large first packet needs a real jitter window. Previously a
    // 244ms packet bypassed prefill and a next packet at 300ms caused a hole.
    // A complete response can start immediately: no more network frames await.
    if(!this.playing){this.wait+=out.length;if(!this.complete&&this.wait<this.prefill)return;this.playing=true;this.wait=0;}
    const step=24000/this.rate;
    for(let i=0;i<out.length;i++){
      if(!this.frames){if(!this.complete)this.underflows++;this.playing=false;this.wait=0;break;}
      const a=this.peek(0),b=this.peek(1);out[i]=(a+(b-a)*this.phase)/32768;this.lastPlayedAt=at+(i+1)/this.rate;
      this.phase+=step;while(this.phase>=1&&this.frames){this.phase-=1;this.advance();}
      if(!this.frames)this.phase=0;
    }
  }
};
class Speaker extends AudioWorkletProcessor {
 constructor(options){super();const prefill=options?.processorOptions?.prefillMs??120;this.reference=options?.processorOptions?.renderReference===true;this.ref=new Float32Array(Math.round(sampleRate/50));this.refPos=0;
 if(!Number.isFinite(prefill)||prefill<0||prefill>1000)throw Error('Invalid playback buffer');
 this.outputMuted=false;this.queue=new PcmPlaybackQueue(sampleRate,prefill);this.epoch=0;this.tick=0;
 this.port.onmessage=({data:e})=>{if(e.type==='clear'){this.epoch=e.epoch;this.queue.clear();}
 else if(e.type==='output-mute')this.outputMuted=e.muted===true;
 else if(e.type==='hold'&&e.epoch===this.epoch)this.queue.hold();
 else if(e.type==='pause'&&e.epoch===this.epoch)this.queue.paused=e.paused===true;
 else if(e.type==='done'&&e.epoch===this.epoch)this.queue.end();
 else if(e.type==='audio'&&e.epoch===this.epoch){try{this.queue.push(new Int16Array(e.buffer));}catch{this.port.postMessage({type:'error',epoch:this.epoch});}}};}
 process(inputs,outputs){const out=outputs[0]?.[0];if(!out)return true;
 const before=this.queue.frames;this.queue.render(out,currentTime);if(this.outputMuted)out.fill(0);
 if(this.reference)for(const value of out){this.ref[this.refPos++]=value;if(this.refPos===this.ref.length){this.port.postMessage({type:'render-reference',epoch:this.epoch,sampleRate,buffer:this.ref.buffer},[this.ref.buffer]);this.ref=new Float32Array(Math.round(sampleRate/50));this.refPos=0;}}
 if(++this.tick%8===0||before>0&&this.queue.frames===0)this.port.postMessage({type:'playback',epoch:this.epoch,consumed:this.queue.consumed,underflows:this.queue.underflows,lastPlayedAt:this.queue.lastPlayedAt,playing:this.queue.playing&&!this.queue.paused&&!this.outputMuted});return true;}
}
class Mic extends AudioWorkletProcessor {
 constructor(){super();this.sum=0;this.count=0;this.phase=0;this.frame=new Int16Array(480);this.index=0;}
 process(inputs){const data=inputs[0]?.[0];if(data)for(const value of data){this.sum+=value;this.count++;this.phase+=24000;
 if(this.phase>=sampleRate){this.phase-=sampleRate;const v=Math.max(-1,Math.min(1,this.sum/this.count));this.frame[this.index++]=Math.round(v*(v<0?32768:32767));this.sum=0;this.count=0;
 if(this.index===480){this.port.postMessage(this.frame.buffer,[this.frame.buffer]);this.frame=new Int16Array(480);this.index=0;}}}return true;}
}
registerProcessor('v-direct-speaker',Speaker);registerProcessor('v-direct-mic',Mic);