import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {request} from 'node:http';
import {createLiveH5Server} from '../../lab/gpt-live-h5/server.mjs';
import {createVoiceAgentControl,listenVoiceAgentControl} from '../../lib/voice-agent-control.mjs';
const exec=promisify(execFile);
export async function voiceCliFixture({directory,now=Date.now,directVoice,publicTools=true}={}) {
  const dir=directory??await mkdtemp(join(tmpdir(),'vvoice-cli-')),file=join(dir,'registry.json'),socketPath=join(dir,'control.sock');
  const calls=[];
  const bridge=createLiveH5Server({publicOrigin:'https://voice-cli.example',basePath:'/voice',accessToken:'private-legacy-fixture'.repeat(3),iosPublicEntry:true,publicTools,
    feishuLogin:{conversations:true,allowUnidentified:true,appId:'cli_fixture',appSecret:'fixture-secret-not-production',accountId:'default',actors:[]},
    gateway:{ready:true,request:async(method,args)=>{calls.push({method,args});if(method==='tools.catalog')return {groups:[]};throw Error('Private Gateway must not be invoked');}},
    directVoice:{models:()=>[{id:'seeduplex',available:true}],reserve:async()=>{throw Error('No paid or real calls in CLI fixture');},close:async()=>{},dispose:async()=>{},...directVoice}});
  const controller=await createVoiceAgentControl({file,...bridge.cliConfiguration(),now,status:bridge.cliStatus,activity:bridge.cliActivity,onInvalidate:bridge.invalidateManagedCalls});
  bridge.setAgentControl(controller);
  const socket=await listenVoiceAgentControl({socketPath,controller});
  await new Promise(r=>bridge.server.listen(0,'127.0.0.1',r));
  const cli=async(...args)=>{
    let result;try{result=await exec(process.execPath,[resolve(import.meta.dirname,'../../bin/v-voice.mjs'),'--socket',socketPath,...args],{env:{...process.env,V_VOICE_SOCKET:''}});result.code=0;}
    catch(error){result={stdout:error.stdout,stderr:error.stderr,code:error.code};}
    return {...result,value:JSON.parse(result.stdout)};
  };
  const http=(path,cookie='',body)=>new Promise((accept,reject)=>{
    const req=request({hostname:'127.0.0.1',port:bridge.server.address().port,path,method:body===undefined?'GET':'POST',headers:{host:'voice-cli.example',origin:'https://voice-cli.example',cookie,'content-type':'application/json'}},res=>{
      let raw='';res.on('data',c=>raw+=c);res.on('end',()=>accept({status:res.statusCode,headers:res.headers,body:raw,json:()=>JSON.parse(raw)}));
    });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  const close=async({keep=false}={})=>{await socket.close();await bridge.dispose();await controller.close();if(!keep)await rm(dir,{recursive:true,force:true});};
  return {dir,file,socketPath,bridge,controller,calls,cli,http,close};
}
