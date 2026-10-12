import {buildLarkReadArgv,calendarReadArgs} from './lark-readonly.mjs';
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'};
export const TOOLS=[
 {type:'function',name:'read',description:'直接读取工作目录中的文件。文件名区分大小写，AGENTS.md 是指引文件；可用 offset/limit 分页。',parameters:object({path:str,offset:{type:'integer',minimum:1,maximum:100000},limit:{type:'integer',minimum:1,maximum:300}},['path'])},
 {type:'function',name:'exec',description:'短、明确的原生执行操作。command 是完整命令，timeoutSeconds 是超时秒数。需要长时间等待、反复轮询或用户要求后端模型执行时用 delegate_to_v；本工具不调用后端语言模型。返回 running/sessionId 时用 process 跟进。外部写入需用户授权。',parameters:object({command:str,timeoutSeconds:{type:'integer',minimum:1,maximum:300}},['command'])},
 {type:'function',name:'process',description:'跟进本通电话发起的执行会话。poll 查询，timeout 最大5000毫秒；长时间等待交给 delegate_to_v。用户明确取消时用 cancel_task。不可管理其他电话的进程。',parameters:object({action:{type:'string',enum:['poll','log']},sessionId:str,timeout:{type:'integer',minimum:1,maximum:5000}},['action','sessionId'])},
 {type:'function',name:'memory_search',description:'搜索天意的 V/OpenClaw 个人记忆。关于家庭、个人偏好、项目历史的问题先查实际记录。',parameters:object({query:str,maxResults:{type:'integer',minimum:1,maximum:8}},['query'])},
 {type:'function',name:'web_search',description:'通过 OpenClaw 搜索互联网，查询当前新闻、价格和公开资料。',parameters:object({query:str,count:{type:'integer',minimum:1,maximum:5}},['query'])},
 {type:'function',name:'web_fetch',description:'通过 OpenClaw 读取搜索结果的公开网页，核对原文。',parameters:object({url:str},['url'])},
 {type:'function',name:'feishu_calendar',description:'查询天意本人的飞书日程。默认查今天；不是微信日历。start/end 是上海时区 ISO 时间或 YYYY-MM-DD。只查询，不创建或修改。',parameters:object({start:str,end:str})},
 {type:'function',name:'lark_read',description:'在语音服务本地查询本人的飞书资料。只读白名单：calendar +agenda/+get/+search-event/+freebusy、contact +search-user、im +chat-search/+messages-search、drive +search、task +get-my-tasks。argv 是命令参数数组，不含 lark-cli；不传 --as/--format，系统固定 user/json。支持 --help 查询这些命令用法。禁止写入、发送、删除、授权或输出文件；写操作需用户明确授权后交 delegate_to_v。',parameters:object({argv:{type:'array',items:str,minItems:2,maxItems:42}},['argv'])},
 {type:'function',name:'current_time',description:'获取当前上海时间，用于解释今天、明天和周末。',parameters:object({})},
 {type:'function',name:'delegate_to_v',description:'真正调用个人 V 的后端语言模型。没有合适直接工具时，即使只是发一条飞书消息、改一个日程或写文档，也必须交给它；图片视频生成、多步调研、跨资料整合、规划和长时间任务同样交给它。语音模型没有这个能力不是拒绝理由。用户要求交给后端模型或后台处理时必须用本工具；即使用户给出了命令也不能只口头委派然后自己 exec/process。简单明确查询直接用原生工具。V 会自主继续全部步骤，返回公开进展和最终结果；等待时仍可聊天，不重复派发同一任务。context 传递用户条件和已有资料，不能扩大授权。',parameters:object({question:str,context:str},['question'])},
 {type:'function',name:'cancel_task',description:'仅当用户明确取消的对象与仍在执行的当前后台任务相同时调用。已完成的旧视频或图片不能用取消另一个无关任务代替；目标不清楚先澄清。普通插话、闲聊或补充条件不表示取消。只取消本次电话发起的任务。',parameters:object({})},
 {type:'function',name:'openclaw_tool',description:'直接执行 OpenClaw 工具，不调用另一个语言模型。可用工具和用法以本次会话提供的目录为准。飞书日历用 feishu_calendar，其他飞书只读查询用本地 lark_read；不要经 Gateway exec 执行 lark-cli。写操作交 delegate_to_v 且外部写入遵守用户授权，禁止自行确认。arguments 是原工具参数的 JSON 字符串。',parameters:object({tool:str,arguments:str},['tool','arguments'])},
 {type:'function',name:'end_call',description:'结束当前电话。用户向你告别，例如“好了，那我们就聊到这里”“拜拜啦”“今天先这样，下次再聊”，立即调用本工具，不只口头告别，也不等用户再次要求挂断。先理解上下文：讨论挂断功能、引用别人的告别、转话题继续提问或取消一个任务都不要挂断。调用成功后简短告别，系统等待真实告别音频播完才关闭。',parameters:object({})}
];
export function validateTool(name,args){
 const tool=TOOLS.find(t=>t.name===name);if(!tool)throw Error('不支持这个工具');
 if(!args||typeof args!=='object'||Array.isArray(args))throw Error('工具参数必须是对象');
 for(const key of Object.keys(args))if(!(key in tool.parameters.properties))throw Error('未知工具参数');
 for(const key of tool.parameters.required)if(!(key in args))throw Error('缺少工具参数');
 for(const [key,value] of Object.entries(args)){
  const spec=tool.parameters.properties[key];
  if(spec.type==='string'&&(typeof value!=='string'||!value.trim()||value.length>16000))throw Error('无效文字参数');
  if(spec.enum&&!spec.enum.includes(value))throw Error('不支持这个动作');
  if(spec.type==='array'&&(!Array.isArray(value)||value.length<spec.minItems||value.length>spec.maxItems||value.some(v=>typeof v!=='string'||!v||v.length>4000)))throw Error('无效命令参数数组');
  if(spec.type==='integer'&&(!Number.isInteger(value)||value<spec.minimum||value>spec.maximum))throw Error('无效数字参数');
 }
 if(name==='web_fetch'){const u=new URL(args.url);if(u.protocol!=='https:'&&u.protocol!=='http:')throw Error('只读取网页');}
 if(name==='feishu_calendar')for(const value of Object.values(args))if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))throw Error('无效日程日期');
 if(name==='lark_read')buildLarkReadArgv(args.argv);
 return args;
}
export function createToolExecutor({invoke,allowedTools,calendar,larkRead,delegate}){return async(name,args,callId,signal)=>{
 validateTool(name,args);
 if(name==='current_time')return {timezone:'Asia/Shanghai',now:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})};
 if(name==='end_call')return {accepted:true,instruction:'简短告别，然后结束本次电话。'};
 if(name==='cancel_task')return {cancelRequested:true};
 if(name==='delegate_to_v'){if(!delegate)throw Error('V 后台委派尚未就绪');return delegate({...args,callId,signal});}
 if(name==='feishu_calendar') {
  if(!calendar)throw Error('语音本地飞书日历未配置；不要改用 Gateway exec。');
  calendarReadArgs(args);
  return calendar(args,callId,signal);
 }
 if(name==='lark_read') {
  if(!larkRead)throw Error('语音本地飞书只读工具未配置；不要改用 Gateway exec。');
  return larkRead(args,callId,signal);
 }
 if(name==='openclaw_tool') {
  if(!allowedTools?.has(args.tool))throw Error('本会话没有这个 OpenClaw 工具');
  const nativeArgs=JSON.parse(args.arguments);
  if(!nativeArgs||typeof nativeArgs!=='object'||Array.isArray(nativeArgs))throw Error('原工具参数必须是对象');
  return invoke(args.tool,nativeArgs,callId,signal);
 }
 return invoke(name,args,callId,signal);
};}
// Tool transport success is separate from the CLI's actual business result.
// Native exec may append its exit annotation after otherwise valid JSON.
export function calendarOutcome(output){
 let value;const text=(output?.details?.aggregated??(output?.content??[]).filter(b=>b.type==='text').map(b=>b.text??'').join('\n')).replace(/\n\n\(Command exited with code \d+\)\s*$/u,'').trim();
 try{value=JSON.parse(text);}catch{}
 const ok=output?.isError!==true&&output?.details?.exitCode===0&&value?.ok===true;
 return {ok,message:ok?'':String(value?.error?.message??'命令未成功返回有效日程结果').slice(0,500)};
}
/** Cache by provider call_id and reject conflicting replays before executing. */
export function createCallDispatcher(execute){const cache=new Map();return (item)=>{
 if(item.type!=='function_call'||!item.call_id||typeof item.arguments!=='string')throw Error('不是原生工具调用');
 const key=item.call_id,signature=JSON.stringify([item.name,item.arguments]);
 if(cache.has(key)){if(cache.get(key).signature!==signature)throw Error('工具调用身份冲突');return cache.get(key).promise;}
 const promise=Promise.resolve().then(()=>execute(item.name,JSON.parse(item.arguments),key));cache.set(key,{signature,promise});return promise;
};}

// A registry miss is a tool lookup error, not proof of OS process exit.
export function processExited(output) {
 if(!output||output.isError||output.content?.some(b=>b.type==='text'&&/No session found/i.test(b.text??'')))return false;
 const d=output.details;
 return ['completed','killed','cancelled'].includes(d?.status)||d?.status==='failed'&&(Number.isInteger(d.exitCode)||typeof d.exitSignal==='string'&&/^SIG[A-Z0-9]+$/.test(d.exitSignal)||Number.isInteger(d.exitSignal)&&d.exitSignal>0);
}
