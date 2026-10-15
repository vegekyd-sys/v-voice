import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

// Only pre-generated, checksummed candidate assets. This module cannot call a provider.
export async function loadVoiceListening(directory) {
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  if(manifest.schema!=='voice-listening-v1'||!Array.isArray(manifest.scenes)||!Array.isArray(manifest.variants)||!Array.isArray(manifest.clips)||manifest.clips.length>40)throw Error('Invalid listening manifest');
  const files=new Map();
  for(const clip of manifest.clips){
    if(!/^[a-z0-9-]{1,100}$/.test(clip.id)||clip.file!==clip.id+'.wav'||files.has(clip.id))throw Error('Invalid listening asset');
    const path=join(directory,clip.file),stat=await lstat(path);
    if(!stat.isFile()||stat.size>8*1024*1024||stat.size!==clip.bytes)throw Error('Invalid listening audio');
    const bytes=await readFile(path);
    if(createHash('sha256').update(bytes).digest('hex')!==clip.sha256)throw Error('Listening checksum mismatch');
    files.set(clip.id,{path,size:stat.size});
  }
  // Never expose server paths or transport event payloads.
  const publicManifest={...manifest,clips:manifest.clips.map(({file,events,...clip})=>clip)};
  return {
    manifest:publicManifest,
    async audio(id,range){
      const asset=files.get(id);if(!asset)return null;
      const headers={'content-type':'audio/wav','accept-ranges':'bytes','cache-control':'private, max-age=86400, immutable'};
      let start=0,end=asset.size-1,status=200;
      if(range){
        const match=/^bytes=(\d*)-(\d*)$/.exec(range);
        if(!match||!match[1]&&!match[2])return {status:416,headers:{...headers,'content-range':`bytes */${asset.size}`},body:Buffer.alloc(0)};
        if(!match[1])start=Math.max(0,asset.size-Number(match[2]));
        else {start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=asset.size)return {status:416,headers:{...headers,'content-range':`bytes */${asset.size}`},body:Buffer.alloc(0)};
        status=206;headers['content-range']=`bytes ${start}-${end}/${asset.size}`;
      }
      const body=(await readFile(asset.path)).subarray(start,end+1);headers['content-length']=String(body.length);
      return {status,headers,body};
    },
  };
}
