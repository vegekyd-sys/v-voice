import {getRealtimeVoiceProvider,resolveConfiguredRealtimeVoiceProvider} from 'openclaw/plugin-sdk/realtime-voice';
import {createVoiceGptProvider} from './provider.mjs';
import {readVoiceTaskResult} from './delivery.mjs';
export default {
 id:'v-voice-gpt-live',name:'V Voice GPT Live adapter',
 register(api){
 const reservations=new Map();
 api.registerGatewayMethod('voice.product.task-result',({params,client,respond})=>{
  try{respond(true,readVoiceTaskResult(reservations,params,client?.connId));}
  catch{respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice result requires its exact authenticated task owner'});}
 },{scope:'operator.read'});
 api.registerGatewayMethod('voice.product.control',({params,client,respond})=>{
  const row=typeof params?.clientSecret==='string'?reservations.get(params.clientSecret):null;
  if(!row||row.ownerConnId!==client?.connId||params?.mode!=='end'){respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice control requires its authenticated reservation owner'});return;}
  try{respond(true,row.delivery.end());}catch{respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice reservation is closed'});}
 },{scope:'operator.write'});
 api.registerRealtimeVoiceProvider(createVoiceGptProvider({reservations,
  getBase:cfg=>getRealtimeVoiceProvider('openai',cfg),
  isConfigured:ctx=>{try{return Boolean(resolveConfiguredRealtimeVoiceProvider({configuredProviderId:'openai',cfg:ctx.cfg,agentId:ctx.agentId,surface:'browser-session',providerConfigOverrides:ctx.providerConfig}).provider);}catch{return false;}},
 }));},
};
