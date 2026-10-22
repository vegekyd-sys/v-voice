import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';

// The former Mac media candidate is only a bookmark redirect now. No audio,
// credentials, Gateway connection or inference runs in this process.
export function createLegacyEntry({destination}){
  const target=new URL(destination);
  if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash)throw Error('A plain HTTPS candidate entry is required');
  return createServer((req,res)=>{
    res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');
    const url=new URL(req.url,'http://localhost');
    if(req.method!=='GET'||url.pathname!=='/'){res.writeHead(410,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'旧候选已迁移，请重新打开拨号页。'}));return;}
    const next=new URL(target);for(const key of ['entry','fixture','inputPolicy'])if(url.searchParams.has(key))next.searchParams.set(key,url.searchParams.get(key));
    res.writeHead(307,{location:next.href});res.end();
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  createLegacyEntry({destination:process.env.VOICE_STREAM_REDIRECT_ORIGIN}).listen(Number(process.env.VOICE_STREAM_PORT??26325),'127.0.0.1',()=>console.log('Former local candidate redirects to Linux'));
}
