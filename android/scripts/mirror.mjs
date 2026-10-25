#!/usr/bin/env node
// Read-only mirror of one explicitly selected emulator. Never chooses a device.
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const serial=process.argv[2],port=Number(process.env.VVOICE_ANDROID_MIRROR_PORT??3202);
if(!/^emulator-\d+$/u.test(serial??''))throw Error('Usage: node android/scripts/mirror.mjs emulator-PORT');
const run=promisify(execFile),adb=process.env.ADB??'adb';let capturing;
const page=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>V Voice · Android 模拟器</title><style>body{margin:0;background:#ece8f1;font:14px system-ui;color:#554564;display:grid;place-items:center;min-height:100vh}main{padding:12px;text-align:center}img{display:block;max-height:86vh;max-width:94vw;border-radius:24px;box-shadow:0 10px 40px #51446033}p{margin:9px}small{opacity:.7}</style><main><p>V Voice · Android 16 模拟器</p><img id="screen" alt="Android 模拟器实时画面"><p><small>实时只读镜像 · 本地 Candidate</small></p></main><script>const image=document.getElementById('screen');function refresh(){image.src='/screen.png?t='+Date.now()}image.onload=()=>setTimeout(refresh,1200);image.onerror=()=>setTimeout(refresh,2500);refresh()</script>`;
const server=createServer(async(req,res)=>{
 if(req.headers.host!==`127.0.0.1:${port}`&&req.headers.host!==`localhost:${port}`){res.writeHead(403).end();return;}
 if(req.url==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}).end(page);return;}
 if(!req.url.startsWith('/screen.png?')){res.writeHead(404).end();return;}
 try {capturing??=run(adb,['-s',serial,'exec-out','screencap','-p'],{encoding:'buffer',maxBuffer:10*1024*1024}).finally(()=>capturing=null);
  const {stdout}=await capturing;res.writeHead(200,{'content-type':'image/png','cache-control':'no-store'}).end(stdout);
 }catch{res.writeHead(503).end();}
});
server.listen(port,'127.0.0.1',()=>console.log(`Read-only emulator mirror http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
