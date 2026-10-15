// Model adapters select only their authenticated owner transport. OpenClaw's
// existing realtime task controller owns status/steering/follow-up execution.
export const VOICE_TASK_CONTROL_MODES = ['status','steer','followup','cancel'];
export const VOICE_TASK_CONTROL_POLICY = '正在执行的后台任务使用 openclaw_agent_control：status 查询进度，steer 修改原任务或补充条件，followup 在原任务当前步骤之后追加工作，cancel 仅在用户明确取消时使用。不要为了修改或补充重新 delegate_to_v，也不要说只能等旧任务完成。只有真实返回 ok=true、queued=true 才能说条件已交给原任务；这仅代表接受，不代表后台已应用或工作已完成。失败时如实说明未接受，不口头承诺已修改。普通插话和闲聊不修改、取消任务。';
export const VOICE_TASK_CONTROL_TOOL = {type:'function',name:'openclaw_agent_control',description:VOICE_TASK_CONTROL_POLICY,
 parameters:{type:'object',additionalProperties:false,properties:{mode:{type:'string',enum:VOICE_TASK_CONTROL_MODES},text:{type:'string',description:'当前用户的真实修改、补充、追加、进度或取消请求，保留准确条件。'}},required:['mode','text']}};
export function validateVoiceTaskControl({mode,text}={}) {
 if(!VOICE_TASK_CONTROL_MODES.includes(mode)||typeof text!=='string'||!text.trim()||text.length>2000)throw Error('无效的后台任务控制请求');
 return {mode,text:text.trim()};
}
export async function controlVoiceTask({gateway,sessionKey,runId,voiceSessionId,native=false},input) {
 const params=validateVoiceTaskControl(input);
 if(!native&&!runId)return {ok:false,active:false,queued:false,reason:'no_active_run',message:'当前电话没有正在执行的后台任务。'};
 const result=await gateway.request(native?'talk.client.steer':'voice.product.task-control',native?{sessionKey,...params}:{sessionKey,runId,voiceSessionId,...params},{timeoutMs:15000});
 if(['steer','followup'].includes(params.mode)&&result?.ok===true&&result.queued!==true)return {...result,ok:false,reason:'not_accepted',message:'后台没有确认接受这次条件。'};
 return {...result,...(result?.queued===true?{applied:false,instruction:'原任务已接受条件，尚未确认应用。不要说修改已经完成，也不要重新启动任务。'}:{})};
}
