// GPT Live 1.1 has the voice service, not the browser, as its media peer, so the service presents the
// ChatGPT login when it creates the call. It is the Gateway's login: read here by the very call the
// Gateway's own GPT Live One makes for its browser sessions, so the profile, its order and its renewal
// stay OpenClaw's. Nothing is kept or renewed here, and the token is never logged.
const expiry=token=>{try{const exp=JSON.parse(Buffer.from(String(token).split('.')[1],'base64url').toString()).exp;return Number.isFinite(exp)?exp*1000:null;}catch{return null;}};
const AGENT_ID=/^[a-z0-9][a-z0-9_-]{0,63}$/u;

export function createVoiceGptAuth({resolveToken,resolveIdentity,resolveAgentDir,resolveDefaultAgentId}){
  if([resolveToken,resolveIdentity,resolveAgentDir,resolveDefaultAgentId].some(value=>typeof value!=='function'))throw Error('Host auth contract unavailable');
  return async function read({cfg,agentId}={}){
    // (The agent whose profile store holds the login; the host's default when none is named.)
    const agent=typeof agentId==='string'&&AGENT_ID.test(agentId)?agentId:resolveDefaultAgentId(cfg);
    const access=await resolveToken({provider:'openai',cfg,agentDir:resolveAgentDir(cfg,agent),profileTypes:['oauth'],includeExternalCliAuth:false});
    if(typeof access!=='string'||!access)throw Error('ChatGPT login unavailable');
    const accountId=resolveIdentity({access})?.accountId;
    if(typeof accountId!=='string'||!accountId)throw Error('ChatGPT login has no account');
    const expires=expiry(access);
    return {access,accountId,...(expires===null?{}:{expires})};
  };
}
