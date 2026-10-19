// Reuses the existing authorized synthetic corpus; never records a microphone.
import {readFile,writeFile} from 'node:fs/promises';
const dir=new URL('../../artifacts/speaker-native/',import.meta.url),read=id=>readFile(new URL(id+'.pcm',dir));
const [a,b]=await Promise.all([read('ask-v2'),read('child')]);const mix=Buffer.alloc(Math.max(a.length,b.length));
for(let i=0;i<mix.length;i+=2)mix.writeInt16LE(Math.round(((i<a.length?a.readInt16LE(i):0)+(i<b.length?b.readInt16LE(i):0))*.45),i);
const clips=[['intro',await read('intro'),9000],['child',b,12000],['overlap',mix,14000],['ask-v2',a,10000]],parts=[],turns=[];let size=0;
for(const [id,pcm,gap]of clips){turns.push({id,startMs:size/32,endMs:(size+pcm.length)/32});parts.push(pcm,Buffer.alloc(gap*32));size+=pcm.length+gap*32;}
await writeFile(new URL('overlap-sequence.pcm',dir),Buffer.concat(parts),{mode:0o600});
const file=new URL('fixtures.json',dir),manifest=JSON.parse(await readFile(file));manifest.scenarios.overlap={durationMs:size/32,turns};await writeFile(file,JSON.stringify(manifest,null,2),{mode:0o600});console.log(JSON.stringify(manifest.scenarios.overlap));
