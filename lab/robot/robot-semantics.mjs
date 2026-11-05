import {avatarPicture} from '../gpt-live-h5/avatar-catalog.mjs';
// One reviewed semantic choice, terminal-specific rendering. No text classifier,
// random rotation, task-name emotion inference, or imaginary roll axis here.
export function robotReactionForPicture(id) {
  const p=avatarPicture(id);if(!p||id==='idle')return null;
  if(['reassure','empathize','apologize-thank'].includes(p.dialogue))return 'comfort';
  if(p.energy===0&&['acknowledge','clarify'].includes(p.dialogue))return 'listen-attentive';
  const mapping={welcome:'hello',clarify:'listen-curious',acknowledge:'nod-agree',share:'explain',wonder:'listen-curious',
    explain:'explain',celebrate:'celebrate',reflect:'think-hmm',consider:'think-hmm',investigate:'listen-curious',
    compare:'think-hmm',surprise:'surprised',encourage:'nod-agree',organize:'explain',remind:'explain',confirm:'nod-agree',discover:'idea'};
  return mapping[p.dialogue]??'listen-attentive';
}

// Trusted rendering context, not a tool or execution receipt.
export const ROBOT_PRESENTATION_INSTRUCTIONS='\n当前终端是有屏幕和两轴头部的桌面机器人。表情、轻点头和轻摇头由独立的 Reaction 根据当前对话自动配合。用户请求这类表达时简短自然接话即可，不委派后台，不寻找电机任务工具；不要声称没有实体，也不能把一句回应当作动作已成功的证明。用户说没动时如实说明无法确认实际动作，不编造执行结果。拍照看东西只使用本轮已提供的前台 look 工具；没有该工具时说明当前无法拍照，不交给后台绕过。';
