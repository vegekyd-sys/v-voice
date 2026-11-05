// Fold synchronized channels into groups of at most four before cancellation.
// This bounds CPU cost without choosing a fixed channel as the microphone. Six
// channels use two filters so strong electrical references cannot dominate all
// microphones' suppression. Only cancelled outputs are combined for the model.
export class TvArrayEchoProcessor {
  constructor(module,channels,sampleRate=48000,layout){
    if(![16000,48000].includes(sampleRate))throw Error('Unsupported TV sample rate');
    this.sampleRate=sampleRate;this.frameSize=sampleRate/50;
    if(![4,6].includes(channels))throw Error('Unsupported TV array');
    this.channels=channels;this.closed=false;
    if(layout){
      const all=[...(layout.microphones??[]),...(layout.references??[])];
      if(layout.version!==1||!layout.microphones?.length||!layout.references?.length||all.length!==channels||new Set(all).size!==channels||all.some(c=>!Number.isInteger(c)||c<0||c>=channels))throw Error('Invalid array layout');
      this.layout={microphones:[...layout.microphones],references:[...layout.references]};
    }
    const groups=layout?1:channels===6?2:1;
    this.groupSize=channels/groups;
    this.processors=Array.from({length:groups},()=>new module.AEC3(16000,1,1));
  }
  render(data,sampleRate=48000){if(!this.closed&&!this.layout)for(const aec of this.processors)aec.analyze([data],{sampleRateIn:sampleRate});}
  capture(pcm){
    if(this.closed||pcm.length!==this.frameSize*this.channels)throw Error('Invalid TV frame');
    if(this.layout){
      // The reference is captured in the same hardware frame as the mics.
      // Never mix electrical speaker-reference channels into the user voice.
      const reference=new Float32Array(this.frameSize);
      for(let i=0;i<this.frameSize;i++)for(const c of this.layout.references)reference[i]+=pcm[i*this.channels+c]/32768/this.layout.references.length;
      this.processors[0].analyze([reference],{sampleRateIn:this.sampleRate});
    }
    const options={sampleRateIn:this.sampleRate,sampleRateOut:24000},outputs=[];let inputEnergy=0,outputEnergy=0;
    for(let g=0;g<this.processors.length;g++){
      const input=new Float32Array(this.frameSize),members=this.layout?.microphones??Array.from({length:this.groupSize},(_,c)=>g*this.groupSize+c);
      for(let i=0;i<this.frameSize;i++){let value=0;for(const c of members)value+=pcm[i*this.channels+c]/32768;value/=members.length;input[i]=value;inputEnergy+=value*value;}
      const aec=this.processors[g],out=new Float32Array(aec.processSize([input],options));aec.process([out],[input],options);outputs.push(out);
    }
    const mono=new Int16Array(outputs[0].length);
    for(let i=0;i<mono.length;i++){let value=0;for(const out of outputs)value+=out[i];value/=outputs.length;outputEnergy+=value*value;mono[i]=Math.round(Math.max(-1,Math.min(1,value))*(value<0?32768:32767));}
    return {buffer:mono.buffer,inputRms:Math.sqrt(inputEnergy/(this.frameSize*outputs.length)),outputRms:Math.sqrt(outputEnergy/Math.max(1,mono.length))};
  }
  close(){if(this.closed)return;this.closed=true;for(const aec of this.processors)aec.free();this.processors=[];}
}

// Raw array PCM has no browser AGC. Normalize post-AEC speech, retaining every
// sample and reserving headroom; this never gates based on assistant speaking.
export class TvInputGain {
  constructor(){this.gain=1;this.previousInput=0;this.previousHighpass=0;this.noiseRms=.0001;this.levels=[];this.noiseFactor=1;this.frames=0;}
  process(buffer){
    const pcm=new Int16Array(buffer),filtered=new Float32Array(pcm.length);let peak=0,energy=0;
    // Raw arrays include DC and low-frequency room rumble. Remove these before
    // estimating speech level, rather than amplifying them into a permanent VAD.
    const coefficient=Math.exp(-2*Math.PI*80/24000);
    for(let i=0;i<pcm.length;i++){
      const input=pcm[i]/32768,value=coefficient*(this.previousHighpass+input-this.previousInput);
      this.previousInput=input;this.previousHighpass=value;filtered[i]=value;peak=Math.max(peak,Math.abs(value));energy+=value*value;
    }
    const rms=Math.sqrt(energy/Math.max(1,pcm.length));
    this.levels.push(rms);if(this.levels.length>100)this.levels.shift();
    if(++this.frames%50===0){
      const sorted=[...this.levels].sort((a,b)=>a-b),low=sorted[Math.floor(sorted.length*.2)];
      // Follow quieter backgrounds promptly; never learn an entire spoken
      // sentence as noise. A louder floor requires sustained evidence.
      this.noiseRms=low<this.noiseRms?this.noiseRms*.5+low*.5:Math.min(low,this.noiseRms*1.02);
    }
    // Soft attenuation retains every sample and a nonzero floor. It depends
    // only on local signal power, never on model speech or transcript content.
    const desired=Math.sqrt(Math.max(.01,1-(this.noiseRms/Math.max(rms,1e-7))**2));
    this.noiseFactor+=(desired-this.noiseFactor)*(desired>this.noiseFactor?.8:.2);
    const target=Math.min(64,.8/Math.max(peak,.00001),.04/Math.max(rms,.00001));
    this.gain+=(target-this.gain)*(target<this.gain?.8:.08);
    const applied=Math.min(this.gain,.9/Math.max(peak,.00001))*this.noiseFactor;
    for(let i=0;i<pcm.length;i++)pcm[i]=Math.round(filtered[i]*applied*32768);
    return buffer;
  }
}
