import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

// A bounded CLI adapter, not a shell and not a fallback for denied Gateway exec.
// Only the server's private personal mapping may instantiate it.
export function mediaArgv(command) {
  if(typeof command!=='string'||command.length>16000||/[\0\r\n]/u.test(command))throw Error('无效创作命令');
  const out=[];let token='',quote='',started=false;
  for(let i=0;i<command.length;i++){
    const c=command[i];
    if(quote){if(c===quote)quote='';else if(c==='\\'&&quote==='"'&&['"','\\'].includes(command[i+1]))token+=command[++i];else token+=c;started=true;continue;}
    if(c==='\''||c==='"'){quote=c;started=true;continue;}
    if(c==='\\'){if(!command[i+1])throw Error('无效命令引用');token+=command[++i];started=true;continue;}
    if(/\s/u.test(c)){if(started){out.push(token);token='';started=false;}continue;}
    if(/[;&|<>`$(){}*?~]/u.test(c))throw Error('创作命令不支持 Shell 操作或变量');
    token+=c;started=true;
  }
  if(quote)throw Error('创作命令引号未闭合');if(started)out.push(token);
  if(out.shift()!=='makaron')throw Error('此执行器只支持 makaron 创作命令');
  return out;
}
const specs={edit:['image-model','aspect','image','ref'],create:['image','title'],'video create':['video-model','duration','video-resolution','script','image'], 'video status':[]};
const https=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
export function validateMediaArgv(argv) {
  const verb=argv[0]==='video'?argv.slice(0,2).join(' '):argv[0];
  if(!Object.hasOwn(specs,verb))throw Error('仅支持图片生成/保存、视频生成/查询');
  const flags={},positionals=[];
  for(let i=verb.startsWith('video ')?2:1;i<argv.length;i++){
    const v=argv[i];if(v.startsWith('-')){const key=v.slice(2);if(!v.startsWith('--')||!specs[verb].includes(key)||Object.hasOwn(flags,key)||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('不支持的创作选项');flags[key]=argv[++i];}else positionals.push(v);
  }
  if(positionals.length!==(['edit','video status'].includes(verb)?1:0))throw Error('创作参数不完整');
  if(verb==='edit'&&flags['image-model']!=='gpt-image-2.5-flare'||verb==='video create'&&flags['video-model']!=='fal-h3-max')throw Error('必须使用本次指定的创作模型');
  if(flags.aspect&&!/^\d{1,2}:\d{1,2}$/u.test(flags.aspect))throw Error('无效画幅');
  if(verb==='video create'&&(!flags.script||!/^([5-9]|1[0-5])$/u.test(flags.duration??'5')||flags['video-resolution']&&flags['video-resolution']!=='768p'))throw Error('无效视频参数');
  if(verb==='video create'){
    const references=[...flags.script.matchAll(/<<<media_(\d+)>>>/gu)].map(m=>m[1]);
    if(flags.image&&!references.includes('1')||references.some(id=>!flags.image||id!=='1'))throw Error('本地校验未提交、未扣费：带 --image 的脚本必须用 <<<media_1>>> 引用图片；无图片时不写媒体标记。请修正参数后提交。');
  }
  for(const key of ['image','ref'])if(flags[key]&&verb!=='create'&&!https(flags[key]))throw Error('参考图必须是 HTTPS 媒体链接');
  if(verb==='create'&&!flags.image)throw Error('只能保存本通话已生成图片');
  if(verb==='video status'&&!/^[\w:-]{1,200}$/u.test(positionals[0]))throw Error('无效任务 ID');
  return {verb,flags,positionals};
}
export function createVoiceMediaCli({environment=process.env,binary='makaron',baseDirectory=environment.TMPDIR??os.tmpdir(),maxBytes=128*1024,timeoutMs=120000}={}) {
  // Explicit deployment-owned key only: the default CLI login may belong to
  // another account. Never fall back to it or the Gateway secret store.
  if(!environment.MAKARON_API_KEY||environment.MAKARON_URL&&environment.MAKARON_URL!=='https://www.makaron.app')return null;
  const env=Object.fromEntries(['PATH','LANG','LC_ALL','MAKARON_API_KEY'].filter(k=>environment[k]).map(k=>[k,environment[k]]));
  env.PATH=[path.dirname(process.execPath),env.PATH].filter(Boolean).join(path.delimiter);
  return {forCall:async()=>{
    const directory=await fs.realpath(await fs.mkdtemp(path.join(baseDirectory,'voice-media-')));await fs.chmod(directory,0o700);
    const files=new Set(),tasks=new Set(),requests=new Map(),lastPoll=new Map();let tail=Promise.resolve();
    const execute=async(command,signal)=>{
      signal?.throwIfAborted();const argv=mediaArgv(command),{verb,flags,positionals}=validateMediaArgv(argv);
      if(verb==='create'){
        const file=path.resolve(directory,flags.image);
        if(!files.has(file)||await fs.realpath(file)!==file||(await fs.lstat(file)).isSymbolicLink())throw Error('只能保存本通话生成的文件');
        argv[argv.indexOf('--image')+1]=file;
      }
      if(verb==='video status'&&!tasks.has(positionals[0]))throw Error('只能查询本通话提交的任务');
      if(verb==='video status'){const remaining=2000-(Date.now()-(lastPoll.get(positionals[0])??0));if(remaining>0)await delay(remaining,undefined,{signal});lastPoll.set(positionals[0],Date.now());}
      const outputFile=verb==='edit'?path.join(directory,randomUUID()+'.png'):null;
      if(outputFile)argv.push('--out',outputFile);
      const result=await new Promise((resolve,reject)=>{
        let output='',bytes=0,failure,killTimer;
        const child=spawn(binary,argv,{cwd:directory,env:{...env,HOME:directory,TMPDIR:directory},shell:false,detached:true,stdio:['ignore','pipe','pipe']});
        const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}};
        const stop=message=>{if(failure)return;failure=message;try{process.kill(-child.pid,'SIGTERM');}catch{}killTimer=setTimeout(kill,1000);};
        const abort=()=>stop('创作命令已中止；供应商状态未确认，不要重新生成');
        const timer=setTimeout(()=>stop('创作命令超时；状态未知，不要重新生成'),timeoutMs);
        const collect=data=>{bytes+=data.length;if(bytes>maxBytes){stop('创作结果超限；不要重新生成');return;}output+=data.toString();};
        child.stdout.on('data',collect);child.stderr.on('data',collect);
        const cleanup=()=>{clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);};
        child.once('error',()=>{cleanup();reject(Error('Makaron CLI 无法启动'));});
        child.once('close',(code,exitSignal)=>{cleanup();const text=output.split(environment.MAKARON_API_KEY).join('[redacted]');resolve({isError:Boolean(failure)||code!==0,content:[{type:'text',text:[text,failure].filter(Boolean).join('\n')}],details:{status:failure||code!==0?'failed':'completed',exitCode:code,exitSignal,source:'voice-local-makaron'}});});
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      });
      const text=result.content[0].text;
      for(const match of text.matchAll(/Task ID:\s*([\w:-]+)/gu))tasks.add(match[1]);
      if(outputFile&&!result.isError){
        // CLI chooses the extension from actual MIME bytes, regardless of --out.
        // Admit only this submission's random stem, never paths from tool text.
        const stem=path.basename(outputFile,'.png');
        for(const name of await fs.readdir(directory)){
          if(!new RegExp('^'+stem+'(?:-[1-9][0-9]?)?\\.(?:png|jpg|jpeg|webp)$','u').test(name))continue;
          const file=path.join(directory,name),stat=await fs.lstat(file);
          if(stat.isFile()&&!stat.isSymbolicLink()){files.add(file);result.content[0].text+='\nImage file: '+file;}
        }
      }
      // Private diagnostic receipts survive disconnects; never lose a completed
      // generation or its task ID merely because the receipt disk is full.
      await fs.writeFile(path.join(directory,'receipt-'+randomUUID()+'.json'),JSON.stringify({operation:verb,model:flags['image-model']??flags['video-model'],result}),{mode:0o600}).catch(()=>{});
      return result;
    };
    return {execute:(command,signal)=>{
      // Serialize requests and reuse even failed/unknown submissions, never spend twice.
      const argv=mediaArgv(command),key=JSON.stringify(argv),query=argv[0]==='video'&&argv[1]==='status';
      if(!query&&requests.has(key))return requests.get(key);
      const pending=tail.then(()=>execute(command,signal));tail=pending.catch(()=>{});
      if(!query)requests.set(key,pending);
      return pending;
    }};
  }};
}
