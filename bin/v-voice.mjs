#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {request} from 'node:http';
import {open,lstat,unlink} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CLI_SCHEMA,COMMANDS,capabilities,validateCommand,VoiceCliError,commandGroup,helpResult,renderHelp} from '../lib/voice-cli-contract.mjs';

async function writeSecret(file,value) {
  const path=resolve(file),parent=await lstat(dirname(path));
  if(!parent.isDirectory()||parent.mode&0o077||parent.uid!==process.getuid?.())throw new VoiceCliError('PRIVATE_OUTPUT_REQUIRED','Output directory must be owned by this user with mode 0700.','Create a private directory and retry the same request ID.');
  let handle;
  try{handle=await open(path,'wx',0o600);await handle.writeFile(value+'\n');await handle.sync();await handle.close();handle=null;return path;}
  catch(error){if(handle){await handle.close();await unlink(path);}throw new VoiceCliError('OUTPUT_NOT_WRITTEN','Private output could not be written; the service operation may have succeeded.','Read links list; recover with links export --id ID --out NEW_FILE, or retry the same request ID.',8);}
}
export async function runVoiceCli(argv,env=process.env) {
  let parsed;
  try {parsed=parseArgs({args:argv,allowPositionals:true,strict:true,options:{help:{type:'boolean',short:'h'},version:{type:'boolean',short:'v'},json:{type:'boolean'},...Object.fromEntries(['socket','id','entry','kind','account','chat','ttl','out','request-id'].map(k=>[k,{type:'string'}]))}});}
  catch{throw new VoiceCliError('INVALID_ARGUMENT','Invalid command line.','Run v-voice capabilities.');}
  const {values,positionals}=parsed;
  if(values.version)return {schema:CLI_SCHEMA,ok:true,result:{version:capabilities().version}};
  const command=positionals.length===2?positionals.join('.'):positionals[0]??'capabilities';
  if((positionals.length<=1&&commandGroup(command))||!positionals.length||values.help){
    if(positionals.length>2||!Object.hasOwn(COMMANDS,command)&&!commandGroup(command))throw new VoiceCliError('UNKNOWN_COMMAND','Unknown command.','Run v-voice --help.');
    const value={schema:CLI_SCHEMA,ok:true,result:helpResult(command)};
    if(!values.json)Object.defineProperty(value,'helpText',{value:renderHelp(command)});
    return value;
  }
  if(positionals.length>2||!Object.hasOwn(COMMANDS,command))throw new VoiceCliError('UNKNOWN_COMMAND','Unknown command.','Run v-voice capabilities.');
  if(command==='capabilities')return {schema:CLI_SCHEMA,ok:true,result:capabilities()};
  const args=Object.fromEntries(Object.entries(values).filter(([k])=>!['socket','json'].includes(k)));
  validateCommand(command,args);
  // Validate output before the mutation. Atomic exclusive creation still handles races.
  if(args.out){const parent=await lstat(dirname(resolve(args.out))).catch(()=>null);if(!parent?.isDirectory()||parent.mode&0o077||parent.uid!==process.getuid?.())throw new VoiceCliError('PRIVATE_OUTPUT_REQUIRED','Output needs a private directory owned by this user.','Create a mode 0700 directory.');}
  const socketPath=values.socket??env.V_VOICE_SOCKET;
  if(!socketPath?.startsWith('/'))throw new VoiceCliError('SOCKET_REQUIRED','An absolute Voice control socket is required.','Set V_VOICE_SOCKET or --socket; see docs/voice-cli.md.');
  const {out,...wireArgs}=args;
  const response=await new Promise((accept,reject)=>{
    const req=request({socketPath,path:'/v1',method:'POST',headers:{'content-type':'application/json'}},res=>{
      let raw='';res.on('data',chunk=>{raw+=chunk;if(Buffer.byteLength(raw)>2_000_000)req.destroy();});
      res.on('end',()=>{try{const value=JSON.parse(raw);if(value.schema!==CLI_SCHEMA||typeof value.ok!=='boolean')throw Error();accept(value);}catch{reject(new VoiceCliError('PROTOCOL_ERROR','Invalid Voice control response.','Check CLI/service compatibility; read back before retrying a mutation.',8));}});
      res.on('error',()=>reject(new VoiceCliError('TRANSPORT_ERROR','Response interrupted.','Read back before retrying the same request ID.',8)));
    });
    req.setTimeout(10000,()=>req.destroy());
    req.on('error',()=>reject(new VoiceCliError('TRANSPORT_UNAVAILABLE','Cannot reach Voice control socket; operation outcome may be unknown.','Check socket ownership/service status; read back, then retry with the same request ID.',3)));
    req.end(JSON.stringify({command,args:wireArgs}));
  });
  if(!response.ok)return response;
  if(response.result?.link?.url){
    const url=response.result.link.url;
    // Bearer links never enter stdout, errors or shell arguments.
    delete response.result.link.url;
    response.result.link.linkFile=await writeSecret(out,url);
    response.result.link.secretPrinted=false;
  }
  return response;
}
if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===fileURLToPath(import.meta.url)){
  try{const value=await runVoiceCli(process.argv.slice(2));process.stdout.write(value.helpText??JSON.stringify(value)+'\n');if(!value.ok)process.exitCode=value.error?.exitCode??7;}
  catch(error){const known=error instanceof VoiceCliError;process.stdout.write(JSON.stringify({schema:CLI_SCHEMA,ok:false,error:known?{code:error.code,message:error.message,next:error.next,exitCode:error.exitCode}:{code:'LOCAL_ERROR',message:'Local command failed.',next:'Check private paths and command arguments.',exitCode:2}})+'\n');process.exitCode=known?error.exitCode:2;}
}
