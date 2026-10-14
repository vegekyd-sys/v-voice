import {createVoiceDeliveryOwner} from './delivery.mjs';
import {GPT_LIVE_CALL_INSTRUCTIONS} from '../../lab/gpt-live-h5/instructions.mjs';
import {V_FRONTEND_PERSONA} from '../../lab/gpt-live-h5/persona.mjs';

export const VOICE_GPT_PROVIDER = 'v-voice-gpt-live';
// Product policy belongs to this immutable Voice artifact, not Talk globals.
export function createVoiceGptProvider({getBase,isConfigured,reservations=new Map()}) {
  const provider = {
    id:VOICE_GPT_PROVIDER,label:'V GPT Live',defaultModel:'gpt-live-1-codex',models:['gpt-live-1-codex'],
    capabilities:{transports:['webrtc'],inputAudioFormats:[],outputAudioFormats:[],supportsBrowserSession:true,supportsBargeIn:true,supportsToolCalls:false,handlesAgentConsult:true},
    resolveConfig:ctx=>{const base=prepare(ctx.cfg);return {...(base.resolveConfig?.(ctx)??ctx.rawConfig),model:'gpt-live-1-codex'};},
    isConfigured:ctx=>{const base=prepare(ctx.cfg);return isConfigured({...ctx,provider:base,surface:'browser-session',model:'gpt-live-1-codex'});},
    createBridge(){throw Error('Voice GPT provider supports browser WebRTC only');},
    async createBrowserSession(request){
      const base=prepare(request.cfg);
      if(request.model!=='gpt-live-1-codex'||typeof base?.createBrowserSession!=='function')throw Error('Unsupported Voice GPT browser contract');
      // Decorate delivery only; keep the real runner and host authority. The Gateway
      // remains responsible for session admission, Agent tools and credentials.
      const delivery=createVoiceDeliveryOwner({onTranscript:request.gatewayControl?.onTranscript,onBackendResult:request.gatewayControl?.onBackendResult});
      let secret;
      const control=request.gatewayControl?{...request.gatewayControl,
        onTranscript:(...args)=>delivery.transcript(...args),
        onBackendResult:value=>delivery.result(value),
        onClose:(...args)=>{delivery.close();if(secret)reservations.delete(secret);request.gatewayControl.onClose?.(...args);},
      }:undefined;
      const session=await base.createBrowserSession({...request,
        runAgentConsult:params=>request.runAgentConsult(delivery.begin(params)),
        ...(control?{gatewayControl:control}:{}),instructions:`${GPT_LIVE_CALL_INSTRUCTIONS.split('\n\n').filter(block=>!block.startsWith('Call-action priority:')&&!block.startsWith('End-call host tool:')).join('\n\n')}\n\n通话主机独立判断完整用户道别并执行挂断，不排队等待后台任务。普通挂断只结束语音，已经由主机接纳的后台任务继续执行；用户要求进展或结果发群时，保留完整的发送要求。用户明确结束电话时不要新委派后台，只简短告别。说停下或插话时立即让出，不取消后台工作。\n\n${V_FRONTEND_PERSONA}`});
      if(typeof session.clientSecret!=='string'||!request.ownerConnId)throw Error('Voice reservation requires a host owner');
      secret=session.clientSecret;
      reservations.set(session.clientSecret,{ownerConnId:request.ownerConnId,delivery});
      return session;
    },
    async cancelBrowserSession(request,session){
      const base=prepare(request.cfg);
      if(typeof base?.cancelBrowserSession!=='function')throw Error('Voice GPT provider cleanup contract unavailable');
      return base.cancelBrowserSession(request,session);
    },
  };
  function prepare(cfg){
    const base=getBase(cfg);
    if(!base)throw Error('Configured OpenAI voice provider unavailable');
    // Preserve the base descriptor's opaque host extension capabilities. Do not
    // name, implement or alter private hooks; OpenClaw owns auth and teardown.
    for(const key of Object.getOwnPropertySymbols(base))Object.defineProperty(provider,key,Object.getOwnPropertyDescriptor(base,key));
    return base;
  }
  return provider;
}
