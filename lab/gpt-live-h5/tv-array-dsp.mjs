// Some TV array channels carry electrical playback references, not microphones.
// Independent AEC instances keep a reference-only channel from determining the
// suppression gain of a real speech channel. Never assume channel zero is speech.
export class TvArrayEchoProcessor {
  constructor(module,channels){
    if(![4,6].includes(channels))throw Error('Unsupported TV array');
    this.channels=channels;this.closed=false;
    this.processors=Array.from({length:channels},()=>new module.AEC3(16000,1,1));
  }
  render(data,sampleRate=48000){if(!this.closed)for(const aec of this.processors)aec.analyze([data],{sampleRateIn:sampleRate});}
  capture(pcm){
    if(this.closed||pcm.length!==960*this.channels)throw Error('Invalid TV frame');
    const options={sampleRateIn:48000,sampleRateOut:24000},outputs=[];let inputEnergy=0,outputEnergy=0;
    for(let c=0;c<this.channels;c++){
      const input=new Float32Array(960);for(let i=0;i<960;i++){const v=pcm[i*this.channels+c]/32768;input[i]=v;inputEnergy+=v*v;}
      const aec=this.processors[c],out=new Float32Array(aec.processSize([input],options));aec.process([out],[input],options);outputs.push(out);
    }
    const mono=new Int16Array(outputs[0].length);
    for(let i=0;i<mono.length;i++){let value=0;for(const out of outputs)value+=out[i];value/=this.channels;outputEnergy+=value*value;mono[i]=Math.round(Math.max(-1,Math.min(1,value))*(value<0?32768:32767));}
    return {buffer:mono.buffer,inputRms:Math.sqrt(inputEnergy/(960*this.channels)),outputRms:Math.sqrt(outputEnergy/Math.max(1,mono.length))};
  }
  close(){if(this.closed)return;this.closed=true;for(const aec of this.processors)aec.free();this.processors=[];}
}
