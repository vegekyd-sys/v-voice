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
