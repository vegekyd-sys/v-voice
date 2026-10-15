import {getRealtimeVoiceProvider,resolveConfiguredRealtimeVoiceProvider,consultRealtimeVoiceAgent} from 'openclaw/plugin-sdk/realtime-voice';
import {createVoiceTasks} from './tasks.mjs';
import {createVoiceGptProvider} from './provider.mjs';
import {readVoiceTaskResult} from './delivery.mjs';
export default {
 id:'v-voice-gpt-live',name:'V Voice GPT Live adapter',
 register(api){
 const reservations=new Map();
 const tasks=createVoiceTasks({consult:consultRealtimeVoiceAgent,agentRuntime:api.runtime.agent,getConfig:()=>api.config,logger:api.logger});
 api.registerGatewayMethod('voice.product.task.start',async({params,client,context,respond})=>{
  let sent=false;
  const started=value=>{if(!sent){sent=true;respond(true,value);}};
  try{await tasks.start(params,client?.connId,started);if(!sent)respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice task failed before admission'});}
  catch{if(!sent)respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice task requires its authenticated owner and bound session'});}
 },{scope:'operator.write'});
 api.registerGatewayMethod('voice.product.task.read',({params,client,respond})=>{
  try{respond(true,tasks.read(params,client?.connId));}catch{respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice task requires its authenticated owner'});}
 },{scope:'operator.read'});
 api.registerGatewayMethod('voice.product.task.cancel',({params,client,respond})=>{
  try{respond(true,tasks.cancel(params,client?.connId));}catch{respond(false,undefined,{code:'INVALID_REQUEST',message:'Voice task requires its authenticated owner'});}
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
 api.registerRealtimeVoiceProvider(createVoiceGptProvider({reservations,
  getBase:cfg=>getRealtimeVoiceProvider('openai',cfg),
  isConfigured:ctx=>{try{return Boolean(resolveConfiguredRealtimeVoiceProvider({configuredProviderId:'openai',cfg:ctx.cfg,agentId:ctx.agentId,surface:'browser-session',providerConfigOverrides:ctx.providerConfig}).provider);}catch{return false;}},
 }));},
};
