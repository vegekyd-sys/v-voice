// node make-stimuli.mjs <out-dir>: synthesizes each clause once (xAI TTS, paid) into 16 kHz PCM16LE.
import {writeFile,mkdir,stat} from 'node:fs/promises';
import {SCENES} from './stimuli.mjs';
const out=process.argv[2];await mkdir(out,{recursive:true});
for(const [scene,{clauses}] of Object.entries(SCENES))for(let i=0;i<clauses.length;i++){
  const file=`${out}/${scene}-${i}.pcm`;if(await stat(file).catch(()=>null))continue;
  const r=await fetch('https://api.x.ai/v1/tts',{method:'POST',headers:{Authorization:'Bearer '+process.env.XAI_API_KEY,'content-type':'application/json'},body:JSON.stringify({text:clauses[i],voice_id:'rex',language:'zh',output_format:{codec:'pcm',sample_rate:16000}})});
  if(!r.ok)throw Error(`tts ${r.status} ${(await r.text()).slice(0,200)}`);
  const pcm=Buffer.from(await r.arrayBuffer());await writeFile(file,pcm);console.log(file,pcm.length/32000);
}
