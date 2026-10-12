import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Exact read shortcuts verified against the production CLI. No raw API, auth,
// shell, file output, identity override or arbitrary global flag is accepted.
const command=(values,booleans=[])=>({values:new Set(values.split(' ').filter(Boolean)),booleans:new Set(booleans)});
const READ_COMMANDS={
  'calendar +agenda':command('start end calendar-id'),
  'calendar +get':command('calendar-id event-id'),
  'calendar +search-event':command('start end calendar-id attendee-ids query page-size page-token'),
  'calendar +freebusy':command('start end user-id'),
  'contact +search-user':command('query queries user-ids page-size lang',['has-chatted','exclude-external-users','has-enterprise-email','left-organization']),
  'im +chat-search':command('query member-ids chat-modes search-types sort page-size page-token',['disable-search-by-user','exclude-muted','is-manager']),
  'im +messages-search':command('query chat-id chat-type sender sender-type exclude-sender-type at-chatter-ids start end include-attachment-type page-size page-token',['is-at-me','no-reactions']),
  'drive +search':command('query creator-ids original-creator-ids sharer-ids chat-ids doc-types folder-tokens space-ids sort page-size page-token created-since created-until edited-since edited-until opened-since opened-until commented-since commented-until',['mine','created-by-me','only-title','only-comment']),
  'task +get-my-tasks':command('created_at due-start due-end query page-token',['complete']),
};
export function buildLarkReadArgv(argv){
  if(!Array.isArray(argv)||argv.length<2||argv.length>42||argv.some(v=>typeof v!=='string'||!v||v.length>4000||/[\0\r\n]/u.test(v)))throw Error('无效飞书只读参数');
  const spec=READ_COMMANDS[argv.slice(0,2).join(' ')];
  if(!spec)throw Error('本地飞书工具只支持已验证的只读命令；写操作需明确授权后交给后台任务。');
  if(argv.length===3&&argv[2]==='--help')return [...argv];
  const seen=new Set();
  for(let i=2;i<argv.length;i++){
    const flag=argv[i];
    if(!/^--[a-z][a-z_-]*$/u.test(flag)||seen.has(flag))throw Error('无效或重复的飞书只读选项');
    seen.add(flag);const key=flag.slice(2);
    if(spec.booleans.has(key))continue;
    if(!spec.values.has(key)||!argv[i+1]||argv[i+1].startsWith('-')||argv[i+1].startsWith('@'))throw Error('不支持这个飞书只读选项');
    const value=argv[++i];
    if(key==='page-size'&&(!/^\d+$/u.test(value)||Number(value)<1||Number(value)>30))throw Error('请使用 1 到 30 的分页大小');
  }
  return [...argv,'--as','user','--format','json'];
}
export function calendarReadArgs(args){
  const argv=['calendar','+agenda'];
  for(const key of ['start','end'])if(args[key]){
    const value=args[key];
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))?$/u.test(value))throw Error('无效日程日期');
    const expanded=/^\d{4}-\d{2}-\d{2}$/u.test(value)?value+(key==='start'?'T00:00:00+08:00':'T23:59:59+08:00'):value;
    if(!Number.isFinite(Date.parse(expanded))||new Date(Date.parse(value.slice(0,10)+'T12:00:00Z')).toISOString().slice(0,10)!==value.slice(0,10))throw Error('无效日程日期');
    argv.push('--'+key,expanded);
  }
  return {argv};
}
function privateEnvironment(environment){
  const configRoot=environment.LARKSUITE_CLI_CONFIG_DIR,dataRoot=environment.LARKSUITE_CLI_DATA_DIR;
  if(!configRoot||!dataRoot||!path.isAbsolute(configRoot)||!path.isAbsolute(dataRoot))throw Error('Voice 专用飞书 CLI 配置未就绪');
  const profile=path.join(configRoot,'openclaw/config.json');
  for(const [file,dir] of [[configRoot,true],[path.dirname(profile),true],[profile,false]]){
    const stat=fs.lstatSync(file);
    if(stat.isSymbolicLink()||(dir?!stat.isDirectory():!stat.isFile())||(stat.mode&0o077)!==0||stat.uid!==process.getuid()||fs.realpathSync(file)!==file)throw Error('Voice 专用飞书配置必须是本服务所有的私有副本');
  }
  const apps=Object.values(JSON.parse(fs.readFileSync(profile,'utf8')).apps??{});
  if(apps.length!==1||apps[0].defaultAs!=='user'||!Array.isArray(apps[0].users)||!apps[0].users.length)throw Error('Voice 本人飞书身份不可用');
  // Do not give a local read command unrelated provider keys or proxy secrets.
  const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TMPDIR','OPENCLAW_CONFIG_PATH','OPENCLAW_STATE_DIR'].filter(k=>environment[k]).map(k=>[k,environment[k]]));
  return {...env,TZ:'Asia/Shanghai',LARKSUITE_CLI_CONFIG_DIR:configRoot,LARKSUITE_CLI_DATA_DIR:dataRoot};
}
export function createVoiceLarkReader({environment=process.env,binary='lark-cli',timeoutMs=45000,maxBytes=512*1024}={}){
  const read=async(args,callId,signal)=>{
    const argv=buildLarkReadArgv(args.argv);signal?.throwIfAborted();
    const env=privateEnvironment(environment);
    return new Promise((resolve,reject)=>{
      let child,stdout=[],bytes=0,failure,settled=false,killTimer,closeTimer;
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(killTimer);clearTimeout(closeTimer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
      const kill=signalName=>{try{process.kill(-child.pid,signalName);}catch(e){if(e.code!=='ESRCH'){failure=Object.assign(Error('飞书查询进程退出未确认'),{code:'VOICE_LARK_CLEANUP_FAILED'});}}};
      const stop=error=>{if(failure||settled)return;failure=error;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),1000);closeTimer=setTimeout(()=>finish(Object.assign(Error('飞书查询进程退出未确认'),{code:'VOICE_LARK_CLEANUP_FAILED'})),5000);};
      const abort=()=>stop(Object.assign(Error('飞书查询已取消'),{name:'AbortError'}));
      const timer=setTimeout(()=>stop(Error('飞书查询超时，请缩小查询范围。')),timeoutMs);
      try{child=spawn(binary,argv,{env,detached:true,shell:false,stdio:['ignore','pipe','pipe']});}catch{finish(Error('飞书只读工具无法启动'));return;}
      child.on('error',()=>finish(Error('飞书只读工具无法启动')));
      // Discard stderr: auth diagnostics must not expose credentials in chat.
      child.stderr.resume();
      child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes){stop(Error('飞书查询结果过大，请缩小范围或分页读取。'));return;}stdout.push(chunk);});
      child.on('close',(code)=>{
        if(failure){finish(failure);return;}
        const text=Buffer.concat(stdout).toString('utf8');
        if(argv.at(-1)==='--help'){code===0?finish(null,{content:[{type:'text',text}],details:{status:'completed',exitCode:0,source:'voice-local-lark'}}):finish(Error('飞书只读命令用法查询失败'));return;}
        let value;try{value=JSON.parse(text);}catch{}
        if(code!==0||value?.ok!==true){finish(Error('飞书查询未成功：'+(typeof value?.error?.subtype==='string'?value.error.subtype.replace(/[^a-z0-9_-]/giu,'').slice(0,80):'身份、权限或结果无效')));return;}
        // Keep the native CLI output envelope, which the voice model already reads.
        finish(null,{content:[{type:'text',text:JSON.stringify(value)}],details:{status:'completed',exitCode:0,source:'voice-local-lark'}});
      });
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    });
  };
  return {read,calendar:(args,callId,signal)=>read(calendarReadArgs(args),callId,signal)};
}
