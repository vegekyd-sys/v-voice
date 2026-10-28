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

for(const channels of [4,6])test(`${channels}-channel mixed path cancels direct references plus delayed room echo and keeps near speech`,async()=>{
 const m=await module(),{TvArrayEchoProcessor}=await import('./tv-array-dsp.mjs'),dsp=new TvArrayEchoProcessor(m,channels);
 let seed=77;const ref=[],expected=[],observed=[];let raw=0,clean=0;
 const near=i=>.045*Math.sin(i*2*Math.PI*239/48000)+.03*Math.sin(i*2*Math.PI*541/48000)+.02*Math.sin(i*2*Math.PI*1163/48000);
 for(let frame=0;frame<650;frame++){
  const render=new Float32Array(960),pcm=new Int16Array(960*channels);
  for(let i=0;i<960;i++){
   const n=frame*960+i;seed=(seed*1664525+1013904223)>>>0;render[i]=(seed/4294967296-.5)*.32;ref.push(render[i]);
   // Two electrical references lead the real microphone channels by 40 ms.
   pcm[i*channels]=Math.round(render[i]*32768);pcm[i*channels+1]=Math.round((ref[n-32]??0)*.8*32768);
   for(let c=2;c<channels;c++){const echo=(ref[n-1920-c*4]??0)*.45+(ref[n-3360]??0)*.12;pcm[i*channels+c]=Math.round((echo+(frame>=450?near(n-c*2):0))*32768);}
  }
  dsp.render(render);const output=new Int16Array(dsp.capture(pcm).buffer);
  if(frame>=300&&frame<425)for(let i=0;i<480;i++){let x=0;for(let c=0;c<channels;c++)x+=pcm[i*2*channels+c]/32768/channels;raw+=x*x;clean+=(output[i]/32768)**2;}
  if(frame>=525)for(let i=0;i<480;i++){let x=0;for(let c=2;c<channels;c++)x+=near(frame*960+i*2-c*2)/channels;expected.push(x);observed.push(output[i]/32768);}
 }
 dsp.close();let corr=-1,energy=0,baseline=0;
 for(let i=0;i<observed.length;i++){energy+=observed[i]**2;baseline+=expected[i]**2;}
 for(let lag=0;lag<=240;lag+=2){let dot=0,a=0,b=0;for(let i=240;i<observed.length;i+=2){const x=expected[i-lag],y=observed[i];dot+=x*y;a+=x*x;b+=y*y;}corr=Math.max(corr,dot/Math.sqrt(a*b));}
 const erle=10*Math.log10(raw/clean);console.log(JSON.stringify({channels,directAndDelayedErleDb:erle,nearCorrelation:corr,nearRetention:energy/baseline}));
 assert(erle>15,'direct+room echo attenuation '+erle);assert(corr>.75,'near speech correlation '+corr);assert(energy>baseline*.5,'overlapping near speech must survive');
});

for(const channels of [4,6])test(`${channels}-channel 16k hardware frames produce 24k model frames without timing drift`,async()=>{
 const m=await module(),{TvArrayEchoProcessor}=await import('./tv-array-dsp.mjs'),dsp=new TvArrayEchoProcessor(m,channels,16000);let samples=0,energy=0;
 for(let f=0;f<250;f++){
  const pcm=new Int16Array(320*channels);for(let i=0;i<320;i++)for(let c=0;c<channels;c++)pcm[i*channels+c]=Math.round(4000*Math.sin((f*320+i)*2*Math.PI*337/16000));
  dsp.render(new Float32Array(960),48000);const out=new Int16Array(dsp.capture(pcm).buffer);assert.equal(out.length,480);samples+=out.length;for(const v of out)energy+=v*v;
 }
 assert.equal(samples,5*24000);assert(energy>1000000,'near speech survives with no render echo');dsp.close();
});

test('verified two-mic/two-reference hardware uses synchronous reference without feeding it into near speech',async()=>{
 const m=await module(),{TvArrayEchoProcessor}=await import('./tv-array-dsp.mjs');
 const layout={version:1,microphones:[0,1],references:[2,3]};
 assert.throws(()=>new TvArrayEchoProcessor(m,4,16000,{...layout,references:[0,3]}));
 const dsp=new TvArrayEchoProcessor(m,4,16000,layout);let seed=13,history=[],raw=0,clean=0,nearInput=0,nearOutput=0;
 for(let f=0;f<450;f++){
  const pcm=new Int16Array(1280);
  for(let i=0;i<320;i++){
   const n=f*320+i;seed=(seed*1664525+1013904223)>>>0;const ref=(seed/4294967296-.5)*.25;history.push(ref);
   const echo=(history[n-640]??0)*.45+(history[n-960]??0)*.1;
   const near=f>300?.04*Math.sin(n*2*Math.PI*337/16000)+.025*Math.sin(n*2*Math.PI*677/16000):0;
   pcm[i*4]=Math.round((echo+near)*32768);pcm[i*4+1]=Math.round((echo*.9+near)*32768);
   pcm[i*4+2]=pcm[i*4+3]=Math.round(ref*32768);
   if(f>150&&f<250)raw+=echo**2;
   if(f>350)nearInput+=near**2;
  }
  // No rendered callbacks are needed: the device reference shares the ADC clock.
  const out=new Int16Array(dsp.capture(pcm).buffer);assert.equal(out.length,480);
  if(f>150&&f<250)for(const v of out)clean+=(v/32768)**2/1.5;
  if(f>350)for(const v of out)nearOutput+=(v/32768)**2/1.5;
 }
 const erle=10*Math.log10(raw/clean);console.log({hardwareErleDb:erle,nearRetention:nearOutput/nearInput});
 // Use the existing 15 dB suite requirement; report the measured attenuation,
 // and separately require preservation of overlapping near speech.
 assert(erle>15);assert(nearOutput>nearInput*.5);dsp.close();
});

test('raw TV gain removes DC while preserving speech and protecting loud peaks',async()=>{
 const {TvInputGain}=await import('./tv-array-dsp.mjs');const gain=new TvInputGain();
 for(let n=0;n<100;n++)gain.process(new Int16Array(480).fill(65).buffer);
 const dc=new Int16Array(480).fill(65);gain.process(dc.buffer);assert(dc.every(v=>Math.abs(v)<2));
 const loud=new Int16Array(480);for(let i=0;i<480;i++)loud[i]=Math.round(30000*Math.sin(i*.3));gain.process(loud.buffer);assert(loud.every(v=>Math.abs(v)<=29492));assert(loud.length===480);
});

// Observed far-field speech is about 0.0005 RMS; it must remain audible after
// normalization, with no sample skipping and immediate loud-peak protection.
test('raw far-field speech reaches usable level without clipping',async()=>{
 const {TvInputGain}=await import('./tv-array-dsp.mjs');const gain=new TvInputGain();
 for(let n=0;n<100;n++){const p=new Int16Array(480);for(let i=0;i<p.length;i++)p[i]=Math.round(23*Math.sin(i*.3));gain.process(p.buffer);if(n===99){const rms=Math.sqrt(p.reduce((a,v)=>a+(v/32768)**2,0)/480);assert(rms>.025&&rms<.045);}}
 const peak=new Int16Array([32767,-32768]);gain.process(peak.buffer);assert(peak.every(v=>Math.abs(v)<=29492));
});

test('TV soft noise attenuation retains weak speech above steady room noise',async()=>{
 const {TvInputGain}=await import('./tv-array-dsp.mjs');const gain=new TvInputGain();let seed=47,noisePower=0,speechPower=0;
 for(let f=0;f<200;f++){
  const pcm=new Int16Array(480);
  for(let i=0;i<480;i++){seed=(seed*1664525+1013904223)>>>0;pcm[i]=Math.round((seed/4294967296-.5)*10+(f>=100?23*Math.sin((f*480+i)*.3):0));}
  gain.process(pcm.buffer);const power=pcm.reduce((sum,v)=>sum+(v/32768)**2,0)/480;
  if(f>=50&&f<100)noisePower+=power/50;if(f>=150)speechPower+=power/50;
 }
 assert(Math.sqrt(noisePower)<.003);assert(Math.sqrt(speechPower)>.025);
});
