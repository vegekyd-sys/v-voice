import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {mediaAccountFailure} from './media-accounts.mjs';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

// A bounded CLI adapter, not a shell and not a fallback for denied Gateway exec.
// Account selection is server-owned.
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
// The pictures a thing is made from may be several (two characters in one frame need a picture of each):
// one base picture and further references for an image, several pictures for a reference video.
// (As many as the models take: Nano Banana 2.1 takes fourteen pictures in all, FAL H3 Max nine images.)
const repeats={edit:{ref:13},'video create':{image:9}};
const https=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
export function validateMediaArgv(argv) {
  const verb=argv[0]==='video'?argv.slice(0,2).join(' '):argv[0];
  if(!Object.hasOwn(specs,verb))throw Error('仅支持图片生成/保存、视频生成/查询');
  const flags={},lists={},positionals=[];
  for(let i=verb.startsWith('video ')?2:1;i<argv.length;i++){
    const v=argv[i];if(v.startsWith('-')){const key=v.slice(2),many=repeats[verb]?.[key]??1;
      if(!v.startsWith('--')||!specs[verb].includes(key)||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('不支持的创作选项：'+v.slice(0,30)+'（这里只能用 '+specs[verb].map(name=>'--'+name).join('、')+'）');
      if(Object.hasOwn(flags,key)&&many===1)throw Error('不支持的创作选项：--'+key+' 只能写一次');
      if((lists[key]?.length??0)>=many)throw Error('参考图太多：--'+key+' 最多 '+many+' 个');
      (lists[key]??=[]).push(argv[++i]);flags[key]??=lists[key][0];
    }else positionals.push(v);
  }
  if(positionals.length!==(['edit','video status'].includes(verb)?1:0))throw Error('创作参数不完整');
  if(verb==='edit'&&flags['image-model']!=='gemini-2.1'||verb==='video create'&&flags['video-model']!=='fal-h3-max')throw Error('必须使用本次指定的创作模型');
  if(flags.aspect&&!/^\d{1,2}:\d{1,2}$/u.test(flags.aspect))throw Error('无效画幅');
  // (A length it cannot make is said so, so the caller can be told what it can: "三十秒" is asked for often.)
  if(verb==='video create'&&flags.script&&!/^([5-9]|1[0-5])$/u.test(flags.duration??'5'))throw Error('本地校验未提交、未扣费：这里一条视频只能做 5 到 15 的整数秒，最长 15 秒。用户要更长的，用 delegate_to_v 交后台去拼（告诉用户要多等一会儿）；用户同意先看 15 秒的，再按 15 秒重新提交。不到 5 秒的按 5 秒做。');
  if(verb==='video create'&&(!flags.script||!/^([5-9]|1[0-5])$/u.test(flags.duration??'5')||flags['video-resolution']&&flags['video-resolution']!=='768p'))throw Error('无效视频参数');
  if(verb==='video create'){
    const images=lists.image??[],references=[...flags.script.matchAll(/<<<media_(\d+)>>>/gu)].map(m=>Number(m[1]));
    if(references.some(n=>n<1||n>images.length))throw Error('本地校验未提交、未扣费：带 --image 的脚本必须用 <<<media_1>>> 引用图片（第二张用 <<<media_2>>>，依此类推）；无图片时不写媒体标记。请修正参数后提交。');
    // The pictures are what was asked for; a forgotten marker should not cost a turn.
    const missing=images.map((_,index)=>index+1).filter(n=>!references.includes(n));
    if(missing.length){flags.script=missing.map(n=>'<<<media_'+n+'>>>').join(' ')+' '+flags.script;argv[argv.indexOf('--script')+1]=flags.script;}
  }
  for(const key of ['image','ref'])for(const value of lists[key]??[])if(verb!=='create'&&!https(value))throw Error('参考图必须是 HTTPS 媒体链接');
  // (Every picture given is part of what the command is: two commands that differ in a second picture are not the same request.)
  for(const [key,values] of Object.entries(lists))if(values.length>1)flags[key]=values.join(' ');
  if(verb==='create'&&!flags.image)throw Error('只能保存本通话已生成图片');
  if(verb==='video status'&&!/^[\w:-]{1,200}$/u.test(positionals[0]))throw Error('无效任务 ID');
  return {verb,flags,positionals};
}
const videoPending=result=>!result.isError&&/\b(?:is rendering|is queued|is processing|is saving)\b/iu.test(result.content[0].text);
const quote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
const mediaUrl=(result,kind)=>{
  if(result?.isError)return null;
  for(const match of String(result?.content?.[0]?.text??'').matchAll(/https:\/\/[^\s<>"']+/gu)){
    try {const url=new URL(match[0].replace(/[),.;]+$/u,''));
      if(!url.username&&!url.password&&(kind==='video'?/\.(mp4|webm|mov)$/iu:/\.(png|jpe?g|webp|gif|avif)$/iu).test(url.pathname))return url.href;
    }catch{}
  }return null;
};
export function createVoiceMediaCli({environment=process.env,accounts,binary='makaron',baseDirectory=environment.TMPDIR??os.tmpdir(),maxBytes=128*1024,timeoutMs=120000,pollIntervalMs=2000,completeMedia=true}={}) {
  if ((!accounts && !environment.MAKARON_API_KEY) || (environment.MAKARON_URL && environment.MAKARON_URL !== 'https://www.makaron.app')) return null;
  const env=Object.fromEntries(['PATH','LANG','LC_ALL'].filter(k=>environment[k]).map(k=>[k,environment[k]]));
  env.PATH=[path.dirname(process.execPath),env.PATH].filter(Boolean).join(path.delimiter);
  return {sessionAccounts:Boolean(accounts),forCall:async({scope,register,authorize}={})=>{
    if (accounts && !scope) throw Error('通话没有已确认的 Makaron 会话绑定');
    const directory=await fs.realpath(await fs.mkdtemp(path.join(baseDirectory,'voice-media-')));await fs.chmod(directory,0o700);
    const files=new Map(),tasks=new Map(),requests=new Map(),turnRequests=new Map(),lastPoll=new Map(),active=new Map(),latest=new Map(),savedFiles=new Map();let tail=Promise.resolve();
    const execute=async(command,signal,remainingMs=timeoutMs)=>{
      let account;
      signal?.throwIfAborted();const argv=mediaArgv(command),{verb,flags,positionals}=validateMediaArgv(argv);
      if(verb==='create'){
        const file=path.resolve(directory,flags.image);
        if(savedFiles.has(file))return savedFiles.get(file);
        if(!files.has(file)||await fs.realpath(file)!==file||(await fs.lstat(file)).isSymbolicLink())throw Error('只能保存本通话生成的文件');
        account=files.get(file);
        argv[argv.indexOf('--image')+1]=file;
      }
      if(verb==='video status'&&!tasks.has(positionals[0]))throw Error('只能查询本通话提交的任务');
      if(verb==='video status'){const remaining=pollIntervalMs-(Date.now()-(lastPoll.get(positionals[0])??0));if(remaining>0)await delay(remaining,undefined,{signal});lastPoll.set(positionals[0],Date.now());}
      if (verb==='video status') account=tasks.get(positionals[0]);
      if (!account) {
        account=accounts ? await accounts.resolve(scope,chat=>register(chat,signal)) : {key:environment.MAKARON_API_KEY};
        await authorize?.();
      }
      signal?.throwIfAborted();
      const outputFile=verb==='edit'?path.join(directory,randomUUID()+'.png'):null;
      if(outputFile)argv.push('--out',outputFile);
      const result=await new Promise((resolve,reject)=>{
        let output='',bytes=0,failure,killTimer;
        const child=spawn(binary,argv,{cwd:directory,env:{...env,MAKARON_API_KEY:account.key,HOME:directory,TMPDIR:directory},shell:false,detached:true,stdio:['ignore','pipe','pipe']});
        const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}};
        const stop=message=>{if(failure)return;failure=message;try{process.kill(-child.pid,'SIGTERM');}catch{}killTimer=setTimeout(kill,1000);};
        const abort=()=>stop('创作命令已中止；供应商状态未确认，不要重新生成');
        const timer=setTimeout(()=>stop('创作命令超时；状态未知，不要重新生成'),remainingMs);
        const collect=data=>{bytes+=data.length;if(bytes>maxBytes){stop('创作结果超限；不要重新生成');return;}output+=data.toString();};
        child.stdout.on('data',collect);child.stderr.on('data',collect);
        const cleanup=()=>{clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);};
        child.once('error',()=>{cleanup();reject(Object.assign(Error('Makaron CLI 无法启动；本次未提交。'),{code:'executor_unavailable',submission:'not-submitted'}));});
        child.once('close',(code,exitSignal)=>{cleanup();const text=output.split(account.key).join('[redacted]');resolve({isError:Boolean(failure)||code!==0,content:[{type:'text',text:[text,failure].filter(Boolean).join('\n')}],details:{status:failure||code!==0?'failed':'completed',...(failure||code!==0?{submission:'unknown',retryable:false}:{}),exitCode:code,exitSignal,source:'voice-local-makaron'}});});
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      });
      const text=result.content[0].text;
      if (result.isError && result.details.exitCode === 1 && !result.details.exitSignal && !/Task ID:|供应商状态未确认|状态未知|创作结果超限/u.test(text) && ['edit','video create'].includes(verb)) {
        const issue=mediaAccountFailure(text,account,scope);
        if (issue) {
          result.accountIssue=issue;
          result.details.code=issue.code;
          result.details.submission='rejected';
          result.content=[{type:'text',text:issue.message}];
        }
      }
      for(const match of text.matchAll(/Task ID:\s*([\w:-]+)/gu))tasks.set(match[1],account);
      if(outputFile&&!result.isError){
        // CLI chooses the extension from actual MIME bytes, regardless of --out.
        // Admit only this submission's random stem, never paths from tool text.
        const stem=path.basename(outputFile,'.png');
        for(const name of await fs.readdir(directory)){
          if(!new RegExp('^'+stem+'(?:-[1-9][0-9]?)?\\.(?:png|jpg|jpeg|webp)$','u').test(name))continue;
          const file=path.join(directory,name),stat=await fs.lstat(file);
          if(stat.isFile()&&!stat.isSymbolicLink()){files.set(file,account);result.content[0].text+='\nImage file: '+file;}
        }
      }
      // Private diagnostic receipts survive disconnects; never lose a completed
      // generation or its task ID merely because the receipt disk is full.
      await fs.writeFile(path.join(directory,'receipt-'+randomUUID()+'.json'),JSON.stringify({operation:verb,model:flags['image-model']??flags['video-model'],result}),{mode:0o600}).catch(()=>{});
      return result;
    };
    // `separate`: not the caller's own request (a picture a lesson asked for). It waits its turn like any
    // other, but neither answers nor is answered by a request of the caller's for the same kind of thing
    // (call of 11/21: the caller's poster came back as the lesson's picture, which was being made).
    return {execute:(command,signal,{reuseExisting=false,requestToken,separate=false}={})=>{
      // Serialize requests and reuse even failed/unknown submissions, never spend twice.
      let argv,parsed;try{argv=mediaArgv(command);parsed=validateMediaArgv(argv);}catch(error){return Promise.reject(Object.assign(error,{code:'invalid_arguments',submission:'not-submitted'}));}
      const key=JSON.stringify([parsed.verb,Object.entries(parsed.flags).sort(),parsed.positionals]);
      const creation=parsed.verb==='edit'?'image':parsed.verb==='video create'?'video':null;
      const query=parsed.verb==='video status';
      // One human request admits one submission per media kind. A rewritten
      // command (including dropping a failed reference image) is not new consent.
      // Local argv validation above may still be corrected before any submission.
      if(!separate&&creation&&requestToken&&turnRequests.get(requestToken)?.has(creation))return turnRequests.get(requestToken).get(creation);
      if(!separate&&creation&&active.has(creation))return active.get(creation);
      if(!separate&&creation&&reuseExisting){
        if(latest.has(creation))return latest.get(creation);
        return Promise.resolve({isError:true,content:[{type:'text',text:'当前没有这类已提交任务；用户只在问进度，不能新建付费生成。'}],details:{status:'not-started'}});
      }
      if(!query&&requests.has(key))return requests.get(key);
      const pending=tail.then(async()=>{
        const deadline=Date.now()+timeoutMs;
        let result=await execute(command,signal);
        let taskId=query?parsed.positionals[0]:null,queryCommand=command;
        if(completeMedia&&creation==='image'&&!result.isError&&!mediaUrl(result,'image')){
          const file=result.content[0].text.match(/\nImage file: (.+)/u)?.[1];
          if(file&&files.has(file)){
            // The current image API returns bytes. Store them once inside the
            // original operation; the model sees only the final media URL.
            if(!savedFiles.has(file))savedFiles.set(file,execute(`makaron create --image ${quote(file)} --title 'Voice 图片'`,signal,Math.max(1,deadline-Date.now())));
            result=await savedFiles.get(file);
          }
        }
        if(completeMedia&&creation==='video'&&!result.isError){
          taskId=result.content[0].text.match(/Task ID:\s*([\w:-]+)/u)?.[1]??null;
          if(taskId&&!mediaUrl(result,'video')){
            queryCommand=`makaron video status ${quote(taskId)}`;
            result=await execute(queryCommand,signal,Math.max(1,deadline-Date.now()));
          }
        }
        // A realtime model can end its turn after hearing "rendering". Keep
        // this one read-only CLI query open until the original task resolves.
        while(taskId&&videoPending(result)&&Date.now()+pollIntervalMs<deadline){
          result=await execute(queryCommand,signal,Math.max(1,deadline-Date.now()-pollIntervalMs));
        }
        if(taskId&&videoPending(result)){
          result={...result,details:{...result.details,status:'pending'},content:[{type:'text',text:result.content[0].text+'\nTask ID: '+taskId+'\n本次等待已结束，原视频仍未完成；保留任务ID，不重新提交生成。'}]};
        }
        const kind=creation??(query?'video':parsed.verb==='create'?'image':null),url=kind&&mediaUrl(result,kind);
        if(completeMedia&&url)result={isError:false,media:{kind,url,...(taskId?{taskId}:{})},content:[{type:'text',text:`${kind==='video'?'视频':'图片'}已生成：${url}`}],details:{...result.details,status:'completed'}};
        return result;
      });tail=pending.catch(()=>{});
      if(!query){
        requests.set(key,pending);
        // A new human turn may retry after topping up or binding an account.
        // The original turn keeps its receipt, including an account rejection.
        const forget=()=>{if(requests.get(key)===pending)requests.delete(key);};
        pending.then(result=>{if(result.accountIssue)forget();},error=>{if(error.submission==='not-submitted')forget();});
      }
      if(separate)return pending;
      if(creation&&requestToken){if(!turnRequests.has(requestToken))turnRequests.set(requestToken,new Map());turnRequests.get(requestToken).set(creation,pending);}
      if(creation){active.set(creation,pending);latest.set(creation,pending);pending.finally(()=>{if(active.get(creation)===pending)active.delete(creation);}).catch(()=>{});}
      return pending;
    }};
  }};
}
