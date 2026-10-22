const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve(process.env.VOICE_BROWSER_OUTPUT??'/tmp/voice-wait-browser');await mkdir(output,{recursive:true});
const port=Number(process.argv[2]);if(![29847,29848].includes(port))throw Error('Local fixture ports only');
const origin=`http://127.0.0.1:${port}`,result={port,checks:{},errors:[]};
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{}),args:['--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1100,height:850}});
await context.addInitScript(()=>{
 const AC=window.AudioContext,AW=window.AudioWorkletNode,WS=window.WebSocket;
 window.probe={wire:[],levels:[],controls:[]};
 navigator.mediaDevices.getUserMedia=async()=>{const ac=new AC(),out=ac.createMediaStreamDestination();const osc=ac.createOscillator(),gain=ac.createGain();gain.gain.value=0;osc.frequency.value=440;osc.connect(gain).connect(out);osc.start();window.probe.micGain=gain;await ac.resume();return out.stream;};
 window.AudioWorkletNode=class extends AW{constructor(ac,name,options){super(ac,name,options);if(name==='v-direct-speaker'){
   const post=this.port.postMessage.bind(this.port);this.port.postMessage=(...args)=>{if(['clear','pause'].includes(args[0]?.type))window.probe.controls.push({...args[0],at:performance.now()});return post(...args);};
   const a=ac.createAnalyser();a.fftSize=2048;this.connect(a);const samples=new Float32Array(2048);
   setInterval(()=>{a.getFloatTimeDomainData(samples);let sum=0,crossings=0;for(let i=0;i<samples.length;i++){sum+=samples[i]*samples[i];if(i&&samples[i]>0&&samples[i-1]<=0)crossings++;}window.probe.levels.push({at:performance.now(),rms:Math.sqrt(sum/samples.length),hz:crossings*ac.sampleRate/samples.length});},10);
 }}};
 window.WebSocket=class extends WS{constructor(...args){super(...args);if(String(args[0]).includes('/api/relay'))this.addEventListener('message',({data})=>{const e=JSON.parse(data);window.probe.wire.push({type:e.type,responseId:e.responseId,retiredResponseId:e.retiredResponseId,reason:e.reason,at:performance.now()});});}};
});
const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
const command=async name=>{const r=await context.request.post(origin+'/fixture/command',{data:{command:name}});if(!r.ok())throw Error(await r.text());return page.evaluate(()=>performance.now());};
const state=async()=>context.request.get(origin+'/fixture/state').then(r=>r.json());
try{
 await page.goto(origin+'/voice/');await page.locator('#start').click();await page.locator('#stop').waitFor({state:'visible',timeout:15000});
 const deadline=Date.now()+10000;while(!(await state()).connected&&Date.now()<deadline)await page.waitForTimeout(30);
 await command('old');await page.waitForFunction(()=>window.probe.levels.some(x=>x.rms>.03),{timeout:4000});
 for(let attempt=0;attempt<2;attempt++){
  await page.evaluate(()=>window.probe.micGain.gain.value=.15);
  await page.waitForTimeout(240);await command('speech-start');
  const stoppedAt=await command('speech-complete');
  await page.evaluate(()=>window.probe.micGain.gain.value=0);
  await page.waitForTimeout(3200);
  const waiting=await page.evaluate(at=>window.probe.levels.filter(x=>x.at>at+100),stoppedAt);
  result.checks['silentWhileAwaiting'+attempt]=waiting.length>100&&waiting.every(x=>x.rms<.001);
  result['waitingPeakRMS'+attempt]=Math.max(0,...waiting.map(x=>x.rms));
  if(attempt===0){
   const ignoredAt=await command('ignored');await page.waitForTimeout(600);
   result.checks.ignoredResumesOld=await page.evaluate(at=>window.probe.levels.some(x=>x.at>at+100&&x.rms>.03&&x.hz>350&&x.hz<520),ignoredAt);
  }
 }
 const replaceAt=await command('replace');await page.waitForTimeout(220);
 const gap=await page.evaluate(at=>window.probe.levels.filter(x=>x.at>at+70),replaceAt);
 result.checks.stoppedBeforeNewPCM=gap.length>5&&gap.every(x=>x.rms<.001);
 result.stopLatencyMs=await page.evaluate(at=>{const x=window.probe.levels.find(x=>x.at>=at&&x.rms<.001);return x?Math.round(x.at-at):null;},replaceAt);
 result.gapPeakRMS=Math.max(0,...gap.map(x=>x.rms));
 const nextAt=await command('next');await page.waitForTimeout(1000);
 const tail=await page.evaluate(at=>window.probe.levels.filter(x=>x.at>at+600),nextAt);
 result.checks.noOldTail=tail.length>5&&tail.every(x=>x.rms<.001);
 result.oldTailSamples=tail.filter(x=>x.rms>.001).length;
 result.checks.newToneOnly=await page.evaluate(at=>{const audible=window.probe.levels.filter(x=>x.at>at+70&&x.at<at+280&&x.rms>.01);return audible.length>3&&audible.every(x=>x.hz>800&&x.hz<950);},nextAt);
 await page.screenshot({path:`${output}/wait-browser-${port}.png`});
 await command('farewell');await page.locator('#start').waitFor({state:'visible',timeout:6000});result.checks.automaticHangup=true;
 result.state=await state();result.wire=await page.evaluate(()=>window.probe.wire);
}catch(error){result.errors.push(error.message);}finally{await page.locator('#stop').click({timeout:500}).catch(()=>{});await browser.close();}
await writeFile(`${output}/wait-browser-${port}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
if(port===29847&&(!Object.values(result.checks).every(Boolean)||result.errors.length))process.exitCode=1;
