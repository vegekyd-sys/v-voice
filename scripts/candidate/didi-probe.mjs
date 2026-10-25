// Private Candidate transport probe; never prints the URL/key or tool content.
import {readFile,writeFile} from 'node:fs/promises';
const key=(await readFile(process.env.DIDI_MCP_KEY_FILE,'utf8')).trim();
const endpoint=new URL('https://mcp.didichuxing.com/mcp-servers');endpoint.searchParams.set('key',key);
let session,id=0;
async function request(method,params){
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',...(session?{'mcp-session-id':session}:{})},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),redirect:'error',signal:AbortSignal.timeout(20000)});
 session=response.headers.get('mcp-session-id')??session;
 const raw=await response.text();if(!response.ok)throw Error('MCP HTTP '+response.status);
 const parsed=raw.startsWith('data:')?JSON.parse(raw.split('\n').find(l=>l.startsWith('data:')).slice(5)):JSON.parse(raw);
 if(parsed.error)throw Error('MCP error '+parsed.error.code);return parsed.result;
}
try{
 await request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'voice-location-private-candidate',version:'1'}});
 const result=await request('tools/list',{});
 await writeFile(process.env.DIDI_PROBE_OUTPUT,JSON.stringify(result),{mode:0o600});
 console.log(JSON.stringify({authenticated:true,tools:result.tools.map(t=>({name:t.name,coordinateContract:((t.description??'').match(/.{0,20}(?:WGS|GCJ|坐标系).{0,80}/g)??[])}))}));
}catch(error){console.log(JSON.stringify({authenticated:false,error:String(error.message).replaceAll(key,'[redacted]')}));process.exitCode=1;}
