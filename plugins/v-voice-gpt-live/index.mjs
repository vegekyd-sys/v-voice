import * as realtimeVoiceSDK from 'openclaw/plugin-sdk/realtime-voice';
const {getRealtimeVoiceProvider,resolveConfiguredRealtimeVoiceProvider,consultRealtimeVoiceAgent,controlRealtimeVoiceAgentRun}=realtimeVoiceSDK;
import {createVoiceTasks} from './tasks.mjs';
import {createVoiceGptProvider} from './provider.mjs';
import {readVoiceTaskResult} from './delivery.mjs';
import {createVoiceGptAuth} from './auth.mjs';
export default {
 id:'v-voice-gpt-live',name:'V Voice GPT Live adapter',
 register(api){
 const caller=client=>client?.internal?.voiceActor?JSON.stringify([client.connId,client.internal.voiceActor.accountId,client.internal.voiceActor.openId,client.internal.voiceActor.sessionKey]):client?.connId;
 const reservations=new Map();
 const deviceContexts=realtimeVoiceSDK.registerRealtimeVoiceDeviceContext?.(api,{reservations});
 const tasks=createVoiceTasks({consult:consultRealtimeVoiceAgent,control:controlRealtimeVoiceAgentRun,agentRuntime:api.runtime.agent,getConfig:()=>api.config,logger:api.logger,subscribe:fn=>api.runtime.events.onAgentEvent(fn)});
 api.registerGatewayMethod('voice.product.task.start',async({params,client,context,respond})=>{
  let sent=false;
  const started=value=>{if(!sent){sent=true;respond(true,value);}};
  try{await tasks.start(params,caller(client),started,client?.internal?.voiceActor);if(!sent)respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice task failed before admission'});}
  catch{if(!sent)respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice task requires its authenticated owner and bound session'});}
 },{scope:'operator.write'});
 api.registerGatewayMethod('voice.product.task.read',({params,client,respond})=>{
  try{respond(true,tasks.read(params,caller(client)));}catch{respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice task requires its authenticated owner'});}
 },{scope:'operator.read'});
 api.registerGatewayMethod('voice.product.task.lookup',({params,client,respond})=>{
  try{respond(true,tasks.lookup(params,caller(client)));}catch{respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice task requires its authenticated owner'});}
 },{scope:'operator.read'});
 api.registerGatewayMethod('voice.product.task.cancel',async({params,client,respond})=>{
  try{respond(true,await tasks.cancel(params,caller(client)));}catch{respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice task requires its authenticated owner'});}
 },{scope:'operator.write'});
 api.registerGatewayMethod('voice.product.task.control',async({params,client,respond})=>{
  try{respond(true,await tasks.control(params,caller(client)));}catch{respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice control requires its exact authenticated task owner'});}
 },{scope:'operator.write'});
 api.registerGatewayMethod('voice.product.task-result',({params,client,respond})=>{
  try{respond(true,readVoiceTaskResult(reservations,params,client?.connId));}
  catch{respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice result requires its exact authenticated task owner'});}
 },{scope:'operator.read'});
 api.registerGatewayMethod('voice.product.control',({params,client,respond})=>{
  const row=typeof params?.clientSecret==='string'?reservations.get(params.clientSecret):null;
  if(!row||row.ownerConnId!==client?.connId||params?.mode!=='end'){respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice control requires its authenticated reservation owner'});return;}
  try{respond(true,row.delivery.end());}catch{respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice reservation is closed'});}
 },{scope:'operator.write'});
 // The Gateway's ChatGPT login for the voice service's own calls (GPT Live 1.1): see auth.mjs. The host's
 // calls are loaded when first asked for, so a host without them still loads this plugin and its provider;
 // only a connection with the admin scope (the voice service's) is answered.
 let voiceAuth=null;
 const loadVoiceAuth=()=>voiceAuth??=Promise.all([import('openclaw/plugin-sdk/provider-auth'),import('openclaw/plugin-sdk/agent-scope-runtime')])
  .then(([auth,scope])=>createVoiceGptAuth({resolveToken:auth.resolveProviderAuthProfileApiKey,resolveIdentity:auth.resolveOpenAICodexAuthIdentity,resolveAgentDir:scope.resolveAgentDir,resolveDefaultAgentId:scope.resolveDefaultAgentId}))
  .catch(error=>{voiceAuth=null;throw error;});
 api.registerGatewayMethod('voice.product.gpt-live-auth',async({params,respond})=>{
  try{respond(true,await (await loadVoiceAuth())({cfg:api.config,agentId:params?.agentId}));}
  catch{respond(false,undefined,{code:'UNAVAILABLE',message:'ChatGPT login unavailable'});}
 },{scope:'operator.admin'});
 api.registerRealtimeVoiceProvider(createVoiceGptProvider({reservations,deviceContexts,
  getBase:cfg=>getRealtimeVoiceProvider('openai',cfg),
  isConfigured:ctx=>{try{return Boolean(resolveConfiguredRealtimeVoiceProvider({configuredProviderId:'openai',cfg:ctx.cfg,agentId:ctx.agentId,surface:'browser-session',providerConfigOverrides:ctx.providerConfig}).provider);}catch{return false;}},
 }));},
};
