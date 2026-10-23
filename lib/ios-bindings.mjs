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
export const IOS_BINDING_TTL_MS=5*60*1000;
export const IOS_DEVICE_TTL_MS=90*24*60*60*1000;

/** One-use browser handoffs and revocable per-device grants. No OAuth cookie or
 * entry-wide bearer leaves the browser; stored grants contain token hashes only. */
export function createIosBindings({file,basePath,publicOrigin,now=Date.now,permits=()=>false}={}) {
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
  const valid=(grant,binding)=>Boolean(grant&&!grant.revoked&&grant.expiresAt>now()&&grant.entry===binding.id&&same(grant.fingerprint,fingerprint(binding))&&permits(grant.principal,binding));
  const sweep=()=>{for(const [key,row] of pending)if(row.expiresAt<=now())pending.delete(key);};
  const accessFor=(row,binding)=>createVoiceAccess(row.tokenHash,basePath,now,{entry:binding.id});
  const cookieId=(req,binding)=>{
    const name=binding.id==='tianyi'?'v_voice_access':`v_voice_${binding.id}`;
    const value=String(req.headers.cookie??'').split(/;\s*/u).find(v=>v.startsWith(name+'='));
    try{return decodeURIComponent(value?.slice(name.length+1)??'').split('.')[0];}catch{return '';}
  };
  return {
    issue(binding,principal){
      sweep();if(!permits(principal,binding))throw Error('当前会话尚未开放 App 绑定。');
      if(pending.size>=512)throw Error('绑定请求较多，请稍后再试。');
      const token=randomBytes(32).toString('base64url'),expiresAt=now()+IOS_BINDING_TTL_MS;
      pending.set(digest(token),{entry:binding.id,principal,fingerprint:fingerprint(binding),expiresAt});
      const url=new URL(publicOrigin+basePath+'/');if(binding.id!=='tianyi')url.searchParams.set('phone',binding.id);url.hash='bind='+token;
      return {bindingUrl:url.href,expiresAt,conversation:conversation(binding)};
    },
    async redeem(binding,token){
      sweep();if(!tokenValid(token))throw Error('绑定链接无效或已过期，请重新生成。');
      const key=digest(token),row=pending.get(key);
      if(!row||row.entry!==binding.id||row.fingerprint!==fingerprint(binding)||!permits(row.principal,binding))throw Error('绑定链接无效或已过期，请重新生成。');
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
      const row=grants.get(cookieId(req,binding));if(!valid(row,binding))return null;
      const visitor=accessFor(row,binding).read(req);return visitor?{...visitor,deviceId:row.id}:null;
    },
    list(binding,principal){if(!permits(principal,binding))return [];return [...grants.values()].filter(row=>valid(row,binding)&&JSON.stringify(row.principal)===JSON.stringify(principal)).map(({id,createdAt,expiresAt})=>({id,createdAt,expiresAt}));},
    async revoke(binding,principal,id){const row=grants.get(id);if(!valid(row,binding)||JSON.stringify(row.principal)!==JSON.stringify(principal))return false;row.revoked=true;await save();return true;},
    flush:()=>writes,
  };
}
