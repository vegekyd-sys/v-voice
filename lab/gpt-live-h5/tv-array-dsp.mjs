// Fold synchronized channels into groups of at most four before cancellation.
// This bounds CPU cost without choosing a fixed channel as the microphone. Six
// channels use two filters so strong electrical references cannot dominate all
// microphones' suppression. Only cancelled outputs are combined for the model.
export class TvArrayEchoProcessor {
  constructor(module,channels,sampleRate=48000){
    if(![16000,48000].includes(sampleRate))throw Error('Unsupported TV sample rate');
    this.sampleRate=sampleRate;this.frameSize=sampleRate/50;
    if(![4,6].includes(channels))throw Error('Unsupported TV array');
    this.channels=channels;this.closed=false;
    const groups=channels===6?2:1;
    this.groupSize=channels/groups;
    this.processors=Array.from({length:groups},()=>new module.AEC3(16000,1,1));
  }
  render(data,sampleRate=48000){if(!this.closed)for(const aec of this.processors)aec.analyze([data],{sampleRateIn:sampleRate});}
  capture(pcm){
    if(this.closed||pcm.length!==this.frameSize*this.channels)throw Error('Invalid TV frame');
    const options={sampleRateIn:this.sampleRate,sampleRateOut:24000},outputs=[];let inputEnergy=0,outputEnergy=0;
    for(let g=0;g<this.processors.length;g++){
      const input=new Float32Array(this.frameSize);
      for(let i=0;i<this.frameSize;i++){let value=0;for(let c=0;c<this.groupSize;c++)value+=pcm[i*this.channels+g*this.groupSize+c]/32768;value/=this.groupSize;input[i]=value;inputEnergy+=value*value;}
      const aec=this.processors[g],out=new Float32Array(aec.processSize([input],options));aec.process([out],[input],options);outputs.push(out);
    }
    const mono=new Int16Array(outputs[0].length);
    for(let i=0;i<mono.length;i++){let value=0;for(const out of outputs)value+=out[i];value/=outputs.length;outputEnergy+=value*value;mono[i]=Math.round(Math.max(-1,Math.min(1,value))*(value<0?32768:32767));}
    return {buffer:mono.buffer,inputRms:Math.sqrt(inputEnergy/(this.frameSize*outputs.length)),outputRms:Math.sqrt(outputEnergy/Math.max(1,mono.length))};
  }
  close(){if(this.closed)return;this.closed=true;for(const aec of this.processors)aec.free();this.processors=[];}
}
