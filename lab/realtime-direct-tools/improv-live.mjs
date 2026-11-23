import {randomUUID} from 'node:crypto';

export const IMPROV_TOOL = {
  type: 'function', name: 'improv_live',
  description: '通话内即兴直播。只有用户明确请你开一场娱乐直播时才 start。从刚聊的话题取一个具体的梗，写一幕有动作和意外的虚构开场。镜头提示只写可见场景，不含私人信息。用户指定用屏幕上的图开场时带 openingImage，当前这张填 current，指定素材填它的编号。等工具确认提交后再说正在连接。直播中观众的评论、疑问正常接话；明确指挥画面才 direct。想留下眼前一刻用 keep，结束直播用 end，继续通话。图片、短片、查找真实直播仍走原路径。返回 requested 表示已交给屏幕，不代表已经播出。',
  parameters: {type:'object', additionalProperties:false, required:['action'], properties:{
    action:{type:'string',enum:['start','direct','keep','end']}, shot:{type:'string',description:'start 或 direct 的镜头描述，最多 600 字'},
    openingImage:{type:'string',description:'仅 start，用户指定的屏幕参考图，current 或本次电话中的图片编号'}
  }}
};

// A second admission check before a billable session. The model chooses the action;
// a quoted example, a search for a broadcast, or an ordinary video request cannot open one.
const invitation = /^(?:(?:小?[vV维]|好[呀啊的]?|然后|接着|再|那(?:就)?|请|你|能不能|能|可以|现在|帮我[们]?|给(?:我[们]?|大家|咱们))[，,、\s]*)*(?:来|开(?:启|始)?|搞|整|做|办|播)(?:个|一场|一段|场|一回|一次|一个|一期|点)?(?:[^“”「」。？！?]{1,24}的)?(?:即兴|娱乐|趣味|惊喜|互动)?直播(?:什么的|给我们看看|好不好|好吗)?(?:[吧啊呀呗嘛吗么啦！!。？?～~\s]*|[，,：:].{1,160})$/u;
function invited(text) {
  if (typeof text !== 'string') return false;
  // A topic can precede the invitation in the same utterance. Quoted speech
  // and questions about someone else's invitation are left to conversation.
  const line = text.trim();
  if (/[“”「」"‘’]|(?:他说|她说|比如说|举个例子|如果|假如|假设|举例|先别|不要开|不用开|别开|取消开播)/u.test(line)) return false;
  const last = line.split(/[，,。！!]/u).filter(Boolean).at(-1)?.trim() ?? '';
  const afterImage = last.replace(/^(?:请|你|可以|能不能|帮我|就)*(?:用|拿|以)(?:这|那|刚才|刚做|刚画|屏幕上)[^，。？！?]{0,18}?(?:图片|照片|海报|图)(?:来|去|作为开场|当开场)?/u, '');
  return invitation.test(line) || invitation.test(afterImage);
}

export function openingImageFor({action, openingImage}, text) {
  if (action !== 'start' || !invited(text)) return '';
  if (/(?:不用|不要|别用|不需要)[^，。,.]{0,8}(?:图|照片|海报)/u.test(text)) return '';
  return openingImage || (/(?:用|拿|以|让)[^，。？！?]{0,20}(?:这张|那张|图片|照片|海报|幅图|张图)/u.test(text) ? 'current' : '');
}

export function createImprovShow({key, fetcher = fetch}) {
  let show = null, lastStart = null, closed = false;
  const finish = () => {
    clearTimeout(show?.timer);
    show?.cancel.abort();
    show = null;
  };
  return {
    command({action, shot}, turn, send, imageUrl = '') {
      if (closed) throw Error('这通电话已结束');
      if (['start','direct'].includes(action) && (typeof shot !== 'string' || !shot.trim() || shot.length > 600)) throw Error('需要一句简短的镜头描述');
      if (action === 'start') {
        if (show || turn === lastStart) throw Error('这次开场已经提交');
        if (!invited(turn?.text)) throw Error('还没听清用户是否想现在开播，可以自然地问一句。');
        lastStart = turn;
        show = {id:randomUUID(), cancel:new AbortController(), submitted:false, session:null,
          timer:setTimeout(finish,95000).unref()};
      }
      if (!show) throw Error('当前没有直播');
      const id = show.id;
      send({type:'improv.live', id, action, ...(action === 'start' && imageUrl ? {imageUrl} : {}), ...(['start','direct'].includes(action) ? {shot:shot.trim()} : {})});
      if (action === 'end') finish();
      return {requested:true, action};
    },
    end(id) { if (id !== show?.id) return false; finish(); return true; },
    close() { closed = true; finish(); },
    async proxy(id, target, body, signal) {
      const current = show;
      if (!current || id !== current.id) return [409,{error:'直播已经结束'}];
      const endpoint = 'minimax/h3-max/director', bridge = 'https://wma.fal.run';
      let input;
      if (target === bridge+'/session' && body?.app_id === endpoint && body.type === 'offer' && typeof body.sdp === 'string' && body.sdp) {
        if (current.submitted) return [409,{error:'直播连接已经提交'}];
        current.submitted = true;
        input = {app_id:endpoint, type:'offer', sdp:body.sdp};
      } else if (target === bridge+'/ice' && body?.app_id === endpoint) input = {app_id:endpoint};
      else if (target === 'https://fal.run/'+endpoint+'/ice') input = {};
      else if (target === bridge+'/session/heartbeat' && current.session && body?.session_id === current.session) input = {session_id:current.session};
      else return [400,{error:'直播请求无效'}];
      try {
        const res = await fetcher(target, {method:'POST',redirect:'error',headers:{authorization:'Key '+key,'content-type':'application/json'},
          body:JSON.stringify(input),signal:AbortSignal.any([current.cancel.signal,signal,AbortSignal.timeout(90000)])});
        if (!res.ok) { await res.body?.cancel(); return [502,{error:'直播服务暂时不可用'}]; }
        const data = await res.json();
        if (current !== show) return [409,{error:'直播已经结束'}];
        if (target === bridge+'/session') {
          current.session = data.session_id;
          clearTimeout(current.timer);
          current.timer = setTimeout(finish,125000).unref();
        }
        return [200,data];
      } catch { return [502,{error:'直播连接已中断'}]; }
    }
  };
}
