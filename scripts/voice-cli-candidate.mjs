#!/usr/bin/env node
// Local-only UI fixture. Never proxies a real Gateway, token or model.
import {createServer,request} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {voiceCliFixture} from '../tests/helpers/voice-cli-fixture.mjs';
const f=await voiceCliFixture();
await f.cli('entries','create','--id','browser-demo','--kind','guest','--request-id','browser-entry-001');
const issued=await f.cli('links','create','--entry','browser-demo','--ttl','3600','--out',join(f.dir,'browser.url'),'--request-id','browser-link-001');
if(issued.code!==0)throw Error('Candidate CLI setup failed');
const link=new URL((await readFile(issued.value.result.link.linkFile,'utf8')).trim());
const proxy=createServer((req,res)=>{
  if(req.url==='/demo'){res.writeHead(302,{location:link.pathname+link.search+link.hash,'cache-control':'no-store'});res.end();return;}
  const upstream=request({hostname:'127.0.0.1',port:f.bridge.server.address().port,path:req.url,method:req.method,
    headers:{...req.headers,host:'voice-cli.example',origin:'https://voice-cli.example'}},response=>{
      const headers={...response.headers};if(headers['set-cookie'])headers['set-cookie']=headers['set-cookie'].map(c=>c.replace(/; Secure/gu,''));
      res.writeHead(response.statusCode,headers);response.pipe(res);
    });upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
const info={browser:`http://localhost:${proxy.address().port}/demo`,socket:f.socketPath,linkId:issued.value.result.link.id,directory:f.dir,fixture:true,calls:0};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(info)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(info));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void(async()=>{proxy.closeAllConnections();await new Promise(r=>proxy.close(r));await f.close();process.exit(0);})());
