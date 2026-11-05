import {createHash,createHmac,randomBytes} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {open,rename,unlink,lstat,chmod} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createServer} from 'node:http';
import {createVoiceAccess} from '../lab/gpt-live-h5/access.mjs';
import {feishuConversationPhone} from './feishu-conversation-directory.mjs';
import {CLI_SCHEMA,VoiceCliError,capabilities,validateCommand} from './voice-cli-contract.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,message,next,exit=2)=>{throw new VoiceCliError(code,message,next,exit);};
const identity=()=>({kind:'service-os-user',uid:process.getuid?.()??null,scope:'cli-managed-entries-only'});
export async function privateDirectory(path) {
  const stat=await lstat(path);
  if(!stat.isDirectory()||stat.mode&0o077||stat.uid!==process.getuid?.())throw Error('CLI directory must be owned by service UID with mode 0700');
}

// One service owns this private registry. Mutations are serialized, copied and
// fsynced before publication. A failed write never publishes partial authority.
export async function createVoiceAgentControl({file,publicOrigin,basePath,accountId,guestEnabled,publicTools=false,now=Date.now,status=()=>({}),activity=()=>({}),onInvalidate=async()=>{}}) {
  if(!file?.startsWith('/')||!publicOrigin||!basePath)throw Error('CLI requires an absolute registry and hosted Voice');
  await privateDirectory(dirname(file));
  const lock=await open(file+'.lock','wx',0o600);
  let data,queue=Promise.resolve();
  try {
    try {
      const stat=lstatSync(file);
      if(!stat.isFile()||stat.mode&0o077||stat.uid!==process.getuid?.()||stat.size>2_000_000)throw Error('CLI registry must be private');
      data=JSON.parse(readFileSync(file,'utf8'));
      if(data.schema!==CLI_SCHEMA||!/^[a-f0-9]{64}$/u.test(data.secret??'')||!Array.isArray(data.entries)||!Array.isArray(data.links)||!data.requests)throw Error('Invalid CLI registry');
    }catch(error){if(error.code!=='ENOENT')throw error;data={schema:CLI_SCHEMA,secret:randomBytes(32).toString('hex'),entries:[],links:[],requests:{}};}
  }catch(error){await lock.close();await unlink(file+'.lock');throw error;}
  const persist=async next=>{
    const temporary=file+'.'+randomBytes(8).toString('hex')+'.tmp';
    let handle;
    try {handle=await open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(next)+'\n');await handle.sync();await handle.close();handle=null;await rename(temporary,file);}
    finally {await handle?.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  };
  // Persist a new signing secret before returning any capability.
  try{await persist(data);}catch(error){await lock.close();await unlink(file+'.lock');throw error;}
  const entry=(id,state=data)=>state.entries.find(e=>e.id===id)??fail('NOT_FOUND','Managed entry not found.','Run entries list.',4);
  const link=(id,state=data)=>state.links.find(l=>l.id===id)??fail('NOT_FOUND','Managed link not found.','Run links list --entry ID.',4);
  const configured=e=>e.kind==='guest'?guestEnabled:Boolean(accountId&&e.account===accountId);
  const effective=row=>!row.revokedAt&&row.expiresAt>now()&&!entry(row.entry).disabledAt&&configured(entry(row.entry));
  const scope=e=>e.kind==='guest'?{mode:'guest-capability',context:'isolated-cli-conversation',personalIdentity:false,sourceChatHistory:false,personalAccountTools:false,capabilities:publicTools?['conversation','web_search','memory_search','background_tasks','show_content']:['conversation','show_content'],revocation:'all access through this grant, including existing cookies; active call ended; background effects already completed are not undone'}:
    {mode:'feishu-invitation',account:e.account,chat:e.chat,identity:'recipient must authenticate',membership:'Gateway checked on recipient access',personalIdentity:false,sourceChatHistory:'only after recipient admission',personalAccountTools:'recipient existing Gateway authority only',revocation:'invitation only; independently established Feishu/device authority is unchanged'};
  const entryView=e=>{const {visitorId,...visible}=e;return {...visible,scope:scope(e),binding:e.kind==='guest'?{type:'isolated-guest',createdLazily:true}:{type:'feishu',phone:feishuConversationPhone(e.account,e.chat),actorVerified:false},...activity(e.id)};};
  const linkView=row=>({...row,active:effective(row),state:row.revokedAt?'revoked':entry(row.entry).disabledAt?'entry-disabled':row.expiresAt<=now()?'expired':!configured(entry(row.entry))?'service-disabled':'active',scope:scope(entry(row.entry))});
  const token=row=>createHmac('sha256',data.secret).update('voice-cli-link-v1:'+row.id).digest('base64url');
  const phone=row=>'cli_'+row.id;
  const access=row=>createVoiceAccess(token(row),basePath,now,{entry:phone(row)});
  const findPhone=value=>/^cli_[a-f0-9]{32}$/u.test(value??'')?data.links.find(l=>phone(l)===value):null;
  const exportLink=row=>{
    const e=entry(row.entry),url=new URL(publicOrigin+basePath+(e.kind==='feishu'?'/invite/'+row.id:'/'));
    if(e.kind==='guest'){url.searchParams.set('phone',phone(row));url.hash='access='+token(row);}
    return {...linkView(row),url:url.href};
  };
  const checkTarget=args=>{
    if(args.account!==accountId)fail('ACCOUNT_NOT_CONFIGURED','Account is not configured on this Voice service.','Use the account reported by doctor; do not substitute a personal identity.',5);
    try{feishuConversationPhone(args.account,args.chat);}catch{fail('INVALID_BINDING','Invalid Feishu chat ID.','Use the exact chat ID; the recipient must still pass Gateway admission.');}
  };
  async function mutate(command,args) {
    const fingerprint=hash(JSON.stringify([command,Object.entries(args).filter(([k])=>k!=='request-id').sort()]));
    const requestKey=hash(args['request-id']),previous=data.requests[requestKey];
    if(previous){if(previous.fingerprint!==fingerprint)fail('IDEMPOTENCY_CONFLICT','Request ID was used for different arguments.','Read the previous object or use a new request ID.',6);return {replayed:true,result:previous.result};}
    if(Object.keys(data.requests).length>=4096)fail('CAPACITY','Request journal is full.','Operator must archive this dedicated registry during a planned maintenance window.',6);
    const next=structuredClone(data);let result;
    if(command==='entries.create'){
      if(!/^[a-z0-9][a-z0-9_-]{7,63}$/u.test(args.id)||!['guest','feishu'].includes(args.kind))fail('INVALID_ENTRY','Invalid entry ID or kind.','Use 8–64 lowercase URL-safe characters and guest or feishu.');
      if(next.entries.some(e=>e.id===args.id))fail('CONFLICT','Entry already exists.','Read entries get or retry the original request ID.',6);
      if(next.entries.length>=256)fail('CAPACITY','Entry limit reached.','Reuse an existing managed entry.',6);
      if(args.kind==='feishu')checkTarget(args);
      else {if(!guestEnabled)fail('GUEST_UNAVAILABLE','Public guest service is disabled.','Inspect doctor; operator must enable the existing Public service.',5);if(args.account||args.chat)fail('INVALID_BINDING','Guest entries cannot reference a Feishu account/chat.','Create a Feishu invitation destination separately.');}
      const e={id:args.id,kind:args.kind,createdAt:now(),...(args.kind==='feishu'?{account:args.account,chat:args.chat}:{visitorId:randomBytes(16).toString('hex')})};
      next.entries.push(e);result={entry:e.id};
    }else if(command==='entries.bind'){
      const e=entry(args.id,next);if(e.kind!=='feishu'||e.disabledAt||next.links.some(l=>l.entry===e.id))fail('BINDING_LOCKED','Only an unused Feishu entry can be rebound.','Create a new entry to avoid silently switching an existing conversation.',6);
      checkTarget(args);Object.assign(e,{account:args.account,chat:args.chat});result={entry:e.id};
    }else if(command==='entries.disable'){
      const e=entry(args.id,next);e.disabledAt??=now();result={entry:e.id,disabled:true};
    }else if(command==='links.create'){
      const e=entry(args.entry,next);if(e.disabledAt)fail('ENTRY_DISABLED','Entry is disabled.','Create a new entry.',5);
      if(!/^\d+$/u.test(args.ttl)||Number(args.ttl)<60||Number(args.ttl)>86400)fail('INVALID_TTL','TTL must be 60–86400 seconds.','Choose a bounded expiry.');
      if(next.links.length>=1024)fail('CAPACITY','Link limit reached.','Reuse a link or plan registry maintenance.',6);
      const row={id:randomBytes(16).toString('hex'),entry:e.id,createdAt:now(),expiresAt:now()+Number(args.ttl)*1000};next.links.push(row);result={link:row.id};
    }else if(command==='links.revoke'){
      const row=link(args.id,next);row.revokedAt??=now();result={link:row.id,revoked:true};
    }
    next.requests[requestKey]={fingerprint,result};
    try{await persist(next);}catch{fail('STORAGE_UNAVAILABLE','Registry write failed; no new authority published.','Repair private storage, read back, then retry the same request ID.',7);}
    data=next;
    return {replayed:false,result};
  }
  const controller={
    async execute(command,args={}) {
      validateCommand(command,args,{wire:true});
      if(command==='capabilities')return capabilities();
      if(command==='status'||command==='doctor')return {identity:identity(),...status(),configuration:{publicOrigin,basePath,accountId:accountId??null,guestEnabled,publicTools,registryPersistent:true},limits:capabilities().limits};
      const mutation=['entries.create','entries.bind','entries.disable','links.create','links.revoke'].includes(command);
      if(mutation){
        const work=queue.catch(()=>{}).then(()=>mutate(command,args));queue=work;const receipt=await work;
        if(command==='entries.disable'||command==='links.revoke'){
          try{await onInvalidate();}catch{fail('CLEANUP_PENDING','Authority revoked; active-call cleanup needs retry.','Read auth check, then retry the same request ID to finish cleanup.',8);}
        }
        return {...receipt,...(receipt.result.entry?{entry:entryView(entry(receipt.result.entry))}:{link:command==='links.create'?exportLink(link(receipt.result.link)):linkView(link(receipt.result.link))})};
      }
      if(command==='entries.list')return {entries:data.entries.map(entryView)};
      if(command==='entries.get')return {entry:entryView(entry(args.id))};
      if(command==='sessions.status')return {entry:entryView(entry(args.entry)),callsCreatedByCommand:0};
      if(command==='links.list'){entry(args.entry);return {links:data.links.filter(l=>l.entry===args.entry).map(linkView)};}
      if(command==='links.export')return {link:exportLink(link(args.id))};
      return {link:linkView(link(args.id))};
    },
    resolve(phoneValue){const row=findPhone(phoneValue);if(!row||!effective(row)||entry(row.entry).kind!=='guest')return null;return {row,entry:entry(row.entry),access:access(row)};},
    active(phoneValue){const row=findPhone(phoneValue);return Boolean(row&&effective(row));},
    entryId(phoneValue){return findPhone(phoneValue)?.entry??null;},
    invitation(id){const row=data.links.find(l=>l.id===id);if(!row||!effective(row)||entry(row.entry).kind!=='feishu')return null;const e=entry(row.entry);return publicOrigin+basePath+'/feishu?phone='+feishuConversationPhone(e.account,e.chat);},
    async close(){await queue.catch(()=>{});await lock.close();await unlink(file+'.lock');},
  };
  return controller;
}

export async function listenVoiceAgentControl({socketPath,controller}) {
  if(!socketPath?.startsWith('/'))throw Error('Absolute CLI socket required');
  await privateDirectory(dirname(socketPath));
  // Do not steal an existing or stale socket from another service/checkout.
  try{await lstat(socketPath);throw Error('CLI socket already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
  const server=createServer(async(req,res)=>{
    const reply=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
    if(req.method!=='POST'||req.url!=='/v1')return reply(404,{schema:CLI_SCHEMA,ok:false,error:{code:'NOT_FOUND',message:'Unknown control endpoint.',next:'Use v-voice capabilities.',exitCode:4}});
    try {
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)throw new VoiceCliError('INVALID_ARGUMENT','Request too large.','Use bounded command arguments.');}
      let body;try{body=JSON.parse(raw);}catch{throw new VoiceCliError('INVALID_ARGUMENT','Invalid JSON.','Use the CLI.');}
      if(!body||typeof body!=='object'||Array.isArray(body))throw new VoiceCliError('INVALID_ARGUMENT','Invalid envelope.','Use the CLI.');
      if(Object.keys(body??{}).some(k=>!['command','args'].includes(k)))throw new VoiceCliError('INVALID_ARGUMENT','Unsupported envelope fields.','Use the CLI.');
      const result=await controller.execute(body.command,body.args);
      reply(200,{schema:CLI_SCHEMA,ok:true,result});
    }catch(error){const known=error instanceof VoiceCliError;reply(known?400:503,{schema:CLI_SCHEMA,ok:false,error:known?{code:error.code,message:error.message,next:error.next,exitCode:error.exitCode}:{code:'SERVICE_UNAVAILABLE',message:'Voice control unavailable.',next:'Inspect service readiness and private registry permissions.',exitCode:7}});}
  });
  server.requestTimeout=5000;server.headersTimeout=5000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o600);}
  catch(error){server.close();throw error;}
  return {close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await unlink(socketPath).catch(e=>{if(e.code!=='ENOENT')throw e;});}};
}
