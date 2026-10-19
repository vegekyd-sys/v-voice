class PcmCapture extends AudioWorkletProcessor {
  constructor(){super();this.bucket=0;this.weight=0;this.output=[];this.ratio=sampleRate/16000;}
  process(inputs){
    const input=inputs[0]?.[0];if(!input)return true;
    for(const sample of input){
      let remaining=1;
      while(remaining>1e-8){
        const used=Math.min(remaining,this.ratio-this.weight);this.bucket+=sample*used;this.weight+=used;remaining-=used;
        if(this.weight>=this.ratio-1e-8){
          const value=Math.max(-1,Math.min(1,this.bucket/this.ratio));this.output.push(Math.round(value*(value<0?32768:32767)));this.bucket=0;this.weight=0;
          if(this.output.length===3200){const pcm=new Int16Array(this.output);this.port.postMessage(pcm.buffer,[pcm.buffer]);this.output=[];}
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture',PcmCapture);
