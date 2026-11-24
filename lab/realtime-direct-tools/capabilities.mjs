// One place for what differs between voice models, so that everything else is written once.
//
// A call does the same things whichever model speaks: it offers the call's tools, runs them through
// session.mjs, puts lessons and pictures on the board, and gives the model what came back. What a model
// changes is only HOW it takes part, and that is a handful of traits. Shared code asks a trait, never a
// model's name: a capability added once then reaches every model with that trait, and a new model is
// one entry here plus its bridge (transport, audio and its own persona stay with the bridge).
// docs/model-capabilities.md lists what is shared, what still forks, and how to add either.

/**
 * tools:          'function'   — the model is given the tool schemas and calls them itself;
 *                 'delegation' — it hands over one sentence, and gpt-live-router.mjs picks the tool.
 * explains:       'lesson'     — an explanation is the explain_on_board tool: a script read out with the board;
 *                 'speech'     — the model explains in its own words and the board follows what it says.
 * hostToolSpeech: the service speaks around a tool call for the model (cached start/progress lines in its
 *                 voice, or the model told to say one short line first).
 * typedTurns:     a typed message can make the model act (Doubao takes none: the caller is asked instead).
 * compactResults: the service compacts a search before handing it over (a delegation bridge words results itself).
 * nativeDuplex:   full-duplex audio with the provider's own end-of-turn, where no speaker routing is in front.
 */
export const MODEL_TRAITS=Object.freeze({
  seeduplex:Object.freeze({tools:'function',explains:'lesson',hostToolSpeech:true,typedTurns:false,compactResults:true,nativeDuplex:true}),
  grok:Object.freeze({tools:'function',explains:'lesson',hostToolSpeech:false,typedTurns:true,compactResults:false,nativeDuplex:false}),
  'gpt-live-11':Object.freeze({tools:'delegation',explains:'speech',hostToolSpeech:false,typedTurns:true,compactResults:false,nativeDuplex:false}),
});
const PLAIN=Object.freeze({tools:'function',explains:'lesson',hostToolSpeech:false,typedTurns:true,compactResults:false,nativeDuplex:false});
/** A model's traits; one this file does not know takes no part in anything model-specific. */
export const modelTraits=model=>MODEL_TRAITS[model]??PLAIN;

/**
 * What each tool lets V do, in one line, for a model that never sees schemas (a delegation model is told
 * what its backend can do, not how to call it). In the order it is told. A tool offered to a call and
 * missing here is simply not mentioned to such a model; `UNBRIEFED` says which tools are left out on purpose.
 */
export const TOOL_BRIEFS=Object.freeze([
  {tools:['web_search'],line:'搜索：上网查新闻、比分、股价、天气、价格、公开资料，几秒内回来'},
  {tools:['web_fetch'],line:'网页：打开一个网址读原文'},
  {tools:['current_time'],line:'时间：现在的上海时间、日期、星期'},
  {tools:['memory_search'],line:'记忆：用户的个人记忆、家人、偏好、项目历史、以前聊过的事'},
  {tools:['feishu_calendar','lark_read'],line:'飞书：飞书日程和飞书资料（只读）'},
  {tools:['exec'],line:'创作：直接生成或修改一张图片、一个短视频'},
  {tools:['show_content'],line:'上屏：把已有的真实内容放到屏幕上',display:true},
  {tools:['explain_on_board'],line:'讲解：准备一段带画面和真实图片的讲解稿或故事，由你念出来',retell:'讲解：准备查证过的讲解材料和带真实图片的画面，由你用自己的话讲'},
  {tools:['delegate_to_v'],line:'办事：多步调研、写文档、发消息、改日程等长任务或写操作，由后台持续完成'},
  {tools:['cancel_task'],line:'取消：取消正在执行的后台任务'},
  {tools:['send_task_updates'],line:'进展发群：把任务进展和结果发到飞书群'},
  {tools:['end_call'],line:'挂断：结束这通电话'},
].map(Object.freeze));
// Offered to calls but not described to a delegation model, each for a reason: follow-ups the router
// makes itself (process, openclaw_agent_control), tools only function-tool callers use (read,
// openclaw_tool), and device tools of calls that are not on GPT Live today.
export const UNBRIEFED=Object.freeze(['openclaw_agent_control','read','process','openclaw_tool','get_current_location','set_speaker_volume','look']);
/** The lines for the tools a call has, in order; a screen-only tool only where there is a screen. */
export function toolBriefs(names,{display=true,retell=false}={}){
  return TOOL_BRIEFS.filter(brief=>brief.tools.some(name=>names.has(name))&&(display||!brief.display)).map(brief=>retell&&brief.retell?brief.retell:brief.line);
}
