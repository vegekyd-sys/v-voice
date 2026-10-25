#!/usr/bin/env node
// Backend Skill helper. Descriptor arrives on stdin, never from a browser.
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>24000)throw Error('Descriptor too large');}
const {endpoint,lease}=JSON.parse(raw),operation=process.argv[2],args=JSON.parse(process.argv[3]??'{}');
const url=new URL(endpoint);
if(url.username||url.password||url.search||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('Invalid device endpoint');
const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lease,operation,args}),redirect:'error',signal:AbortSignal.timeout(185000)});
if(!response.ok)throw Error('Current device execution unavailable: '+response.status);
process.stdout.write(JSON.stringify(await response.json())+'\n');
