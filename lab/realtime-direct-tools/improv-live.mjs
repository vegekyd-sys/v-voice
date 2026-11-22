import {randomUUID} from 'node:crypto';

export const IMPROV_TOOL = {
  type: 'function', name: 'improv_live',
  description: '通话内即兴直播。只有用户明确请你开一场娱乐直播时才 start。从刚聊的话题取一个具体的梗，写一幕有动作和意外的虚构开场。镜头提示只写可见场景，不含私人信息。自然接一句主持词。直播中观众的评论、疑问正常接话；明确指挥画面才 direct。想留下眼前一刻用 keep，结束直播用 end，继续通话。图片、短片、查找真实直播仍走原路径。返回 requested 表示已交给屏幕，不代表已经播出。',
  parameters: {type:'object', additionalProperties:false, required:['action'], properties:{
    action:{type:'string',enum:['start','direct','keep','end']}, shot:{type:'string',description:'start 或 direct 的镜头描述，最多 600 字'}
  }}
};

// A second admission check before a billable session. The model chooses the action;
// a quoted example, a search for a broadcast, or an ordinary video request cannot open one.
const invitation = /^(?:(?:小?[vV维]|好[呀啊的]?|那(?:就)?|请|你|能不能|可以|现在|帮我[们]?|给(?:我[们]?|大家|咱们))[，,、\s]*)*(?:来|开(?:启|始)?|搞|整|做|办|播)(?:个|一场|一段|场|一回|一次|一个|一期|点)?(?:[^“”「」。？！?]{1,24}的)?(?:即兴|娱乐|趣味|惊喜|互动)?直播(?:[吧啊呀呗嘛吗么啦！!。？?～~\s]*|[，,：:].{1,160})$/u;
export function createImprovShow({key, fetcher = fetch}) {
  let show = null, lastStart = null, closed = false;
  const finish = () => {
    clearTimeout(show?.timer);
    show?.cancel.abort();
    show = null;
  };
  return {
    command({action, shot}, turn, send) {
      if (closed) throw Error('这通电话已结束');
      if (['start','direct'].includes(action) && (typeof shot !== 'string' || !shot.trim() || shot.length > 600)) throw Error('需要一句简短的镜头描述');
      if (action === 'start') {
        if (show || turn === lastStart) throw Error('这次开场已经提交');
        if (!invitation.test(turn?.text?.trim() ?? '')) throw Error('需要明确的开播邀请，例如「给我们来场直播」。');
        lastStart = turn;
        show = {id:randomUUID(), cancel:new AbortController(), submitted:false, session:null,
          timer:setTimeout(finish,95000).unref()};
      }
      if (!show) throw Error('当前没有直播');
      const id = show.id;
      send({type:'improv.live', id, action, ...(['start','direct'].includes(action) ? {shot:shot.trim()} : {})});
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
