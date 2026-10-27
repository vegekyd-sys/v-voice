import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {parseFeishuConversationPhone} from './feishu-conversation-directory.mjs';
const equal=(a,b)=>{const x=Buffer.from(a??''),y=Buffer.from(b??'');return x.length===y.length&&timingSafeEqual(x,y);};
const cookie=req=>String(req.headers.cookie??'').split(/;\s*/u).find(p=>p.startsWith('v_feishu_confirm='))?.slice(17);
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/u.test(value);
const key=()=>randomBytes(32).toString('base64url');
const fail=(reason='unavailable')=>{throw Object.assign(Error('confirmation_unavailable'),{confirmationReason:reason});};
export function createFeishuCardConfirmation({appId,appSecret,accountId,basePath,api,admit,complete,now=Date.now,action='v.voice.confirm.v1'}) {
  if(!['v.voice.confirm.v1','v.voice.confirm.private.v1'].includes(action))throw Error('Invalid confirmation action');
  const pending=new Map(),chatRate=new Map();
  const sweep=()=>{for(const [id,row] of pending)if(row.expiresAt<=now())pending.delete(id);for(const [id,times] of chatRate){const active=times.filter(t=>t>now());if(active.length)chatRate.set(id,active);else chatRate.delete(id);}};
  const owned=(req,state)=>{sweep();const row=pending.get(state);if(!row||!equal(cookie(req),row.browser))fail();return row;};
  const memberName=async(identity)=>{
    let pageToken;const seen=new Set();
    do {
      const params=new URLSearchParams({member_id_type:'open_id',page_size:'100',...(pageToken?{page_token:pageToken}:{})});
      const page=await api('GET',`/open-apis/im/v1/chats/${identity.chatId}/members?${params}`);
      if(!Array.isArray(page?.items))fail();
      const member=page.items.find(m=>m.member_id===identity.openId);
      if(member)return typeof member.name==='string'?member.name.replace(/[\u0000-\u001f\u007f]/gu,' ').trim().slice(0,128):'';
      if(!page.has_more)fail();
      if(!page.page_token||seen.has(page.page_token))fail();seen.add(page.page_token);pageToken=page.page_token;
    }while(true);
  };
  return {
    prepare(req,res,phone) {
      sweep();const target=parseFeishuConversationPhone(phone);
      if(target?.accountId!==accountId||pending.size>=128)fail();
      // One active confirmation per browser. Opening a new request invalidates
      // the previous one, including a callback that is still being checked.
      for(const [state,row] of pending)if(equal(cookie(req),row.browser))pending.delete(state);
      const state=key(),browser=key(),label=['海风','星河','森林','月光','山谷','晨曦'][randomBytes(1)[0]%6]+' · '+randomBytes(2).toString('hex').toUpperCase();
      pending.set(state,{phone,chatId:target.chatId,browser,label,expiresAt:now()+300000,status:'ready'});
      res.setHeader('set-cookie',`v_feishu_confirm=${browser}; Path=${basePath}/; HttpOnly; Secure; SameSite=Strict; Max-Age=300`);
      return {state,label,expiresAt:now()+300000};
    },
    cancel(req,state) { owned(req,state);pending.delete(state); },
    async start(req,state) {
      const row=owned(req,state);
      if(row.status!=='ready')return {status:row.status,label:row.label};
      const recent=chatRate.get(row.chatId)??[];if(recent.length>=3)throw Error('confirmation_rate_limited');
      row.status='sending';chatRate.set(row.chatId,[...recent,now()+60000]);
      try {
        const info=await api('GET','/open-apis/im/v1/chats/'+row.chatId);
        if(!['group','p2p'].includes(info?.chat_mode))fail();
        const card={schema:'2.0',config:{update_multi:true},header:{title:{tag:'plain_text',content:'连接 V 电话身份'},template:'blue'},body:{elements:[
          {tag:'markdown',content:`**仅确认你自己刚打开的电话页面**\n页面标记：**${row.label}**\n确认后，该浏览器可用你的飞书身份访问本会话，并可连接 iOS App。未主动发起、标记不一致或他人转发的请求，请勿确认。5 分钟后失效。`},
          {tag:'button',text:{tag:'plain_text',content:'这是我发起的，确认连接'},type:'primary',behaviors:[{type:'callback',value:{action,request:state}}]},
        ]}};
        const sent=await api('POST','/open-apis/im/v1/messages?receive_id_type=chat_id',{receive_id:row.chatId,msg_type:'interactive',content:JSON.stringify(card),uuid:state.slice(0,32)});
        if(!/^om_[A-Za-z0-9]+$/u.test(sent?.message_id??''))fail();
        row.messageId=sent.message_id;row.status='waiting';
        return {status:'waiting',label:row.label};
      }catch{row.status='failed';throw Error('confirmation_delivery_failed');}
    },
    async callback(raw,signature) {
      if(typeof raw!=='string'||Buffer.byteLength(raw)>4096||!equal(signature,createHmac('sha256',appSecret).update('voice-card-confirm-v1\n'+raw).digest('base64url')))fail('signature');
      let proof;try{proof=JSON.parse(raw);}catch{fail('format');}
      if(proof.version!==1||proof.appId!==appId||proof.accountId!==accountId||!validId(proof.tenantKey)||!/^ou_[A-Za-z0-9]+$/u.test(proof.openId??'')||
        proof.userId!==undefined&&!validId(proof.userId)||!Number.isSafeInteger(proof.issuedAt)||proof.issuedAt<now()-30000||proof.issuedAt>now()+5000)fail('identity_or_timestamp');
      sweep();const row=pending.get(proof.request);
      if(!row)fail('request_missing');
      if(row.chatId!==proof.chatId||row.messageId!==proof.messageId)fail('card_mismatch');
      const actorKey=proof.tenantKey+':'+proof.openId;
      if(row.status==='confirmed'&&row.actorKey===actorKey)return {confirmed:true};
      if(row.status!=='waiting')fail('request_state');row.status='checking';
      try {
        const identity={tenantKey:proof.tenantKey,openId:proof.openId,...(proof.userId?{userId:proof.userId}:{}),dynamic:true};
        await admit(identity,row.phone); // Native Gateway text policy and live membership.
        identity.displayName=await memberName(proof);
        if(pending.get(proof.request)!==row||row.expiresAt<=now())fail();
        row.identity=identity;row.actorKey=actorKey;row.status='confirmed';
        return {confirmed:true};
      }catch(error){if(row.status==='checking')row.status='waiting';fail(error?.code==='FEISHU_CONVERSATION_MEMBERSHIP_REQUIRED'?'membership':'admission');}
    },
    async poll(req,res,state) {
      const row=owned(req,state);
      if(row.status!=='confirmed')return {status:row.status};
      pending.delete(state); // Single redemption, also on failed re-admission.
      const identity=row.identity;
      const result=await complete({tenant_key:identity.tenantKey,open_id:identity.openId,user_id:identity.userId,name:identity.displayName},{phoneId:row.phone},res);
      return {status:'complete',...result};
    },
  };
}
