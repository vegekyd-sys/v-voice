import {getRealtimeVoiceProvider,resolveConfiguredRealtimeVoiceProvider} from 'openclaw/plugin-sdk/realtime-voice';
import {createVoiceGptProvider} from './provider.mjs';
export default {
 id:'v-voice-gpt-live',name:'V Voice GPT Live adapter',
 register(api){api.registerRealtimeVoiceProvider(createVoiceGptProvider({
  getBase:cfg=>getRealtimeVoiceProvider('openai',cfg),
  isConfigured:ctx=>{try{return Boolean(resolveConfiguredRealtimeVoiceProvider({configuredProviderId:'openai',cfg:ctx.cfg,agentId:ctx.agentId,surface:'browser-session',providerConfigOverrides:ctx.providerConfig}).provider);}catch{return false;}},
 }));},
};
