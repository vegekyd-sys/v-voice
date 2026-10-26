import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function module(){
 const scope={module:{exports:{}},exports:{},require,process,Buffer,console,setTimeout,clearTimeout,TextDecoder,TextEncoder,__dirname:new URL("./assets/tv-aec/",import.meta.url).pathname};
 vm.runInNewContext(readFileSync(new URL('./assets/tv-aec/webrtcaec3-0.3.0.js',import.meta.url),'utf8'),scope);
 return scope.module.exports();
}
for(const channels of [4,6])test(`${channels}-channel actual DSP removes reference and echo while preserving overlapping near speech`,async()=>{
 const m=await module(),{TvArrayEchoProcessor}=await import('./tv-array-dsp.mjs'),dsp=new TvArrayEchoProcessor(m,channels);
 let seed=31,ref=[],raw=0,clean=0,nearEnergy=0,nearOutput=0;const nearSamples=[],outputSamples=[];
 const voice=index=>.025*Math.sin(index*2*Math.PI*191/48000)+.015*Math.sin(index*2*Math.PI*431/48000)+.01*Math.sin(index*2*Math.PI*877/48000);
 const random=()=>{seed=(seed*1664525+1013904223)>>>0;return (seed/4294967296-.5)*.3;};
 for(let frame=0;frame<550;frame++){
  const render=new Float32Array(960),pcm=new Int16Array(960*channels);
  for(let i=0;i<960;i++){
   const index=frame*960+i;render[i]=random();ref.push(render[i]);const echo=(ref[index-960]??0)*.55,near=frame>=375?voice(index):0;
   pcm[i*channels]=Math.round((ref[index-960]??0)*32768);for(let c=1;c<channels;c++)pcm[i*channels+c]=Math.round((echo+near)*32768);
  }
  dsp.render(render);const output=new Int16Array(dsp.capture(pcm).buffer);assert.equal(output.length,480);
  if(frame>=225&&frame<350)for(let i=0;i<480;i++){let original=0;for(let c=0;c<channels;c++)original+=pcm[i*2*channels+c]/channels/32768;raw+=original**2;clean+=(output[i]/32768)**2;}
  if(frame>=425)for(let i=0;i<480;i++){let near=voice(frame*960+i*2);nearEnergy+=near*near;nearOutput+=(output[i]/32768)**2;nearSamples.push(near);outputSamples.push(output[i]/32768);}
 }
 dsp.close();let correlation=-1;
 for(let lag=0;lag<=240;lag+=2){let dot=0,a=0,b=0;for(let i=240;i<outputSamples.length;i+=2){const x=nearSamples[i-lag],y=outputSamples[i];dot+=x*y;a+=x*x;b+=y*y;}correlation=Math.max(correlation,dot/Math.sqrt(a*b));}
 const erle=10*Math.log10(raw/clean);console.log(JSON.stringify({channels,syntheticErleDb:erle,nearCorrelation:correlation,nearEnergyRatio:nearOutput/nearEnergy}));
 assert(erle>15,'echo attenuation dB '+erle);assert(correlation>.75,'near-speech correlation '+correlation);assert(nearOutput>nearEnergy*.3,'near speech must not be muted');
 assert.throws(()=>dsp.capture(new Int16Array(3840))); // stopped owners cannot emit
});

test('TV array capture only offers models with rendered PCM reference support',async()=>{
 const {tvArraySupportsModel}=await import('./tv-array-capture.mjs');
 assert(tvArraySupportsModel('seeduplex'));assert(tvArraySupportsModel('grok'));
 assert.equal(tvArraySupportsModel('gpt-live'),false);assert.equal(tvArraySupportsModel('unknown'),false);
});
