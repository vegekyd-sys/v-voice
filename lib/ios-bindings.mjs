import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createVoiceAccess} from '../lab/gpt-live-h5/access.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const tokenValid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/u.test(value);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fingerprint=binding=>digest(JSON.stringify([binding.id,binding.sessionKey,binding.callerId,binding.accountId,binding.accessToken]));
const conversation=binding=>({name:binding.displayName??'我的 V',kind:binding.kind});
const cookieEntry=entry=>/^[a-z0-9_-]{1,64}$/u.test(entry)?entry:'ios-'+digest(entry).slice(0,40);
export const IOS_BINDING_TTL_MS=5*60*1000;
export const IOS_DEVICE_TTL_MS=90*24*60*60*1000;
export class IosBindingAuthorizationError extends Error {}
export function iosAppDownload(value) {
  if(!value)return null;
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)throw Error('Invalid iOS app download URL');
  if(url.host==='testflight.apple.com'&&/^\/join\/[A-Za-z0-9]+$/u.test(url.pathname))return {url:url.href,label:'通过 TestFlight 下载'};
  if(url.host==='apps.apple.com'&&/\/id\d+$/u.test(url.pathname))return {url:url.href,label:'从 App Store 下载'};
  throw Error('iOS app download requires an Apple TestFlight or App Store link');
}

/** One-use browser handoffs and revocable per-device grants. No OAuth cookie or
 * entry-wide bearer leaves the browser; stored grants contain token hashes only. */
export function createIosBindings({file,basePath,publicOrigin,now=Date.now,permits=()=>false,canonicalPhone=phone=>phone,legacyBinding=()=>null}={}) {
  const pending=new Map(),grants=new Map();let writes=Promise.resolve();
  if(file){try{
    const stat=lstatSync(file),mode=stat.mode&0o777;if(!stat.isFile()||stat.size>2_000_000||mode&0o077)throw Error('iOS binding store must be private');
    const data=JSON.parse(readFileSync(file,'utf8'));if(data.version!==1||!Array.isArray(data.grants))throw Error('Invalid iOS binding store');
    for(const row of data.grants){if(!/^[a-f0-9]{32}$/u.test(row.id??'')||!/^[a-f0-9]{64}$/u.test(row.tokenHash??'')||typeof row.entry!=='string'||!Number.isFinite(row.expiresAt))throw Error('Invalid iOS device grant');grants.set(row.id,row);}
  }catch(error){if(error.code!=='ENOENT')throw error;}}
  const save=()=>{
    if(!file)return Promise.resolve();
    const bytes=JSON.stringify({version:1,grants:[...grants.values()]})+'\n';
    const work=writes.catch(()=>{}).then(async()=>{await mkdir(dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomBytes(6).toString('hex')+'.tmp';await writeFile(tmp,bytes,{mode:0o600,flag:'wx'});await rename(tmp,file);});writes=work;return work;
  };
  const matches=(grant,binding)=>{
    if(grant.entry===binding.id)return same(grant.fingerprint,fingerprint(binding));
    const legacy=canonicalPhone(grant.entry)===binding.id?legacyBinding(grant.entry):null;
    return Boolean(legacy&&legacy.sessionKey===binding.sessionKey&&same(grant.fingerprint,fingerprint(legacy)));
  };
  const samePrincipal=(a,b)=>a?.type===b?.type&&(a?.type==='feishu'?a.tenantKey===b.tenantKey&&a.openId===b.openId:a?.type==='guest'?a.visitorId===b.visitorId:a?.entry===b?.entry);
  const valid=(grant,binding)=>Boolean(grant&&!grant.revoked&&grant.expiresAt>now()&&matches(grant,binding)&&permits(grant.principal,binding));
  const sweep=()=>{for(const [key,row] of pending)if(row.expiresAt<=now())pending.delete(key);};
  const accessFor=row=>createVoiceAccess(row.tokenHash,basePath,now,{entry:cookieEntry(row.entry)});
  const cookieId=(req,binding)=>{
    const entry=cookieEntry(binding.id),name=entry==='tianyi'?'v_voice_access':`v_voice_${entry}`;
    const value=String(req.headers.cookie??'').split(/;\s*/u).find(v=>v.startsWith(name+'='));
    try{return decodeURIComponent(value?.slice(name.length+1)??'').split('.')[0];}catch{return '';}
  };
  return {
    canonicalPhone(phone){
      if(!/^ios-[a-f0-9]{40}$/u.test(phone??''))return phone;
      const row=[...pending.values(),...grants.values()].find(r=>cookieEntry(r.entry)===phone);
      return canonicalPhone(row?.entry??phone);
    },
    // Resolve only a verified device/one-use grant before dynamic Gateway
    // admission. An entry URL or browser identity field is never sufficient.
    principalFor(req,entry,exchange) {
      sweep();let row;
      if(exchange?.token&&tokenValid(exchange.token))row=pending.get(digest(exchange.token));
      else if(exchange?.deviceAccess&&tokenValid(exchange.deviceAccess))row=[...grants.values()].find(g=>same(g.tokenHash,digest(exchange.deviceAccess)));
      else row=[...grants.values()].find(g=>canonicalPhone(g.entry)===entry&&cookieId(req,{id:g.entry})===g.id&&accessFor(g).read(req));
      if(!row||row.revoked||row.expiresAt<=now()||canonicalPhone(row.entry)!==entry)return null;
      // Do not even admit a removed or changed legacy binding at the Gateway.
      if(row.entry!==entry){const legacy=legacyBinding(row.entry);if(!legacy||!same(row.fingerprint,fingerprint(legacy)))return null;}
      return structuredClone(row.principal);
    },
    issue(binding,principal){
      sweep();if(!permits(principal,binding))throw Error('当前会话尚未开放 App 绑定。');
      if(pending.size>=512)throw Error('绑定请求较多，请稍后再试。');
      const token=randomBytes(32).toString('base64url'),expiresAt=now()+IOS_BINDING_TTL_MS;
      pending.set(digest(token),{entry:binding.id,principal,fingerprint:fingerprint(binding),expiresAt});
      // Existing native clients accept 8–64 lowercase URL-safe phone IDs.
      // A non-secret alias names the conversation; the grant still authorizes it.
      const url=new URL(publicOrigin+basePath+'/');if(binding.id!=='tianyi')url.searchParams.set('phone',cookieEntry(binding.id));url.hash='bind='+token;
      const appUrl=new URL('vvoice://settings/bind');appUrl.hash=new URLSearchParams({url:url.href}).toString();
      return {bindingUrl:url.href,appUrl:appUrl.href,expiresAt,conversation:conversation(binding)};
    },
    async redeem(binding,token){
      sweep();if(!tokenValid(token))throw new IosBindingAuthorizationError('绑定链接无效或已过期，请重新生成。');
      const key=digest(token),row=pending.get(key);
      if(!row||!matches(row,binding)||!permits(row.principal,binding))throw new IosBindingAuthorizationError('绑定链接无效或已过期，请重新生成。');
      pending.delete(key);
      if([...grants.values()].filter(g=>!g.revoked&&g.expiresAt>now()).length>=1000)throw Error('绑定设备已达上限，请先移除旧设备。');
      const deviceAccess=randomBytes(32).toString('base64url'),id=randomBytes(16).toString('hex');
      const grant={id,entry:binding.id,principal:row.principal,fingerprint:row.fingerprint,tokenHash:digest(deviceAccess),createdAt:now(),expiresAt:now()+IOS_DEVICE_TTL_MS};
      grants.set(id,grant);try{await save();}catch(error){grants.delete(id);throw error;}
      return {deviceAccess,expiresAt:grant.expiresAt,conversation:conversation(binding)};
    },
    authorize(binding,deviceAccess,res){
      if(!tokenValid(deviceAccess))return null;
      const hash=digest(deviceAccess),row=[...grants.values()].find(g=>same(g.tokenHash,hash));
      if(!valid(row,binding))return null;
      const visitor=accessFor(row,binding).issue(res,{id:row.id});
      return {ok:true,conversation:conversation(binding),expiresAt:row.expiresAt,cookieExpiresAt:visitor.expiresAt};
    },
    read(req,binding){
      const row=[...grants.values()].find(g=>cookieId(req,{id:g.entry})===g.id&&valid(g,binding));if(!row)return null;
      const visitor=accessFor(row,binding).read(req);return visitor?{...visitor,deviceId:row.id}:null;
    },
    list(binding,principal){if(!permits(principal,binding))return [];return [...grants.values()].filter(row=>valid(row,binding)&&samePrincipal(row.principal,principal)).map(({id,createdAt,expiresAt})=>({id,createdAt,expiresAt}));},
    async revoke(binding,principal,id){const row=grants.get(id);if(!valid(row,binding)||!samePrincipal(row.principal,principal))return false;row.revoked=true;await save();return true;},
    flush:()=>writes,
  };
}
