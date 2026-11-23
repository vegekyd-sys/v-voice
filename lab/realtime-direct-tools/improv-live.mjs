import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

export const IMPROV_TOOL = {
  type: 'function', name: 'improv_live',
  description: '通话内即兴直播。只有用户明确请你开一场娱乐直播时才 start。从刚聊的话题取一个具体的梗，写一幕有动作和意外的虚构开场。镜头提示只写可见场景，不含私人信息。用户指定用屏幕上的图开场时带 openingImage，当前这张填 current，指定素材填它的编号。等工具确认提交后再说正在连接。开播后每句用户语音由 Makaron 分辨剧情、聊天和收播。新的角色、动作或场景自然算下一幕，画面由导演呈现，你可以简短接话。不要重复提交或声称看见尚未播出的改动。想留下眼前一刻用 keep，结束直播用 end，继续通话。图片、短片、查找真实直播仍走原路径。返回 requested 表示已交给屏幕，不代表已经播出。',
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


export function directorCommand(environment=process.env) {
  const binary=environment.VOICE_MAKARON_DIRECTOR_CLI;
  if(!binary?.startsWith('/') || !environment.MAKARON_API_KEY || !environment.MAKARON_DIRECTOR_URL)return null;
  const env=Object.fromEntries(['PATH','LANG','MAKARON_API_KEY','MAKARON_DIRECTOR_URL'].filter(k=>environment[k]).map(k=>[k,environment[k]]));
  return async args=>{
    try{
      const {stdout}=await execute(binary,['director',...args,'--json'],{env,timeout:45000,maxBuffer:65536});
      return JSON.parse(stdout);
    }catch{throw Error('Makaron Director 未确认操作，请查看本场状态');}
  };
}

export function createImprovShow({run}) {
  let show=null,opening=false,closed=false,lastStart,emit;
  const turns=new WeakMap();
  async function stop(id) {
    if(!show || show.id!==id)return false;
    await run(['stop',id]);
    if(show?.id===id){show=null;emit?.({type:'improv.live',id,action:'end'});}
    return true;
  }
  function observe(turn) {
    if(!show || !turn)return Promise.resolve({action:'chat'});
    if(turns.has(turn))return turns.get(turn);
    const id=show.id;
    const result=run(['direct',id,'--host','--turn-id',turn.id||randomUUID(),'--',turn.text]).then(value=>{
      if(value.action==='end' && show?.id===id){show=null;emit({type:'improv.live',id,action:'end'});}
      return value;
    });
    turns.set(turn,result);return result;
  }
  return {
    observe,
    decision:turn=>turns.get(turn),
    async command({action,shot},turn,send,imageUrl=''){
      if(closed)throw Error('这通电话已结束');
      if(action==='start'){
        if(show || opening || turn===lastStart)throw Error('这次开场已经提交');
        if(!invited(turn?.text))throw Error('请先确认是否开播');
        if(!shot?.trim() || shot.length>600)throw Error('需要简短的开场描述');
        opening=true;lastStart=turn;emit=send;
        try{
          const result=await run(['start','--prompt',shot.trim(),'--request-id',randomUUID(),...(imageUrl?['--image',imageUrl]:[])]);
          if(closed){await run(['stop',result.id]);throw Error('这通电话已结束');}
          if(result.phase!=='waiting'||!/^\/director\/player\.html#[a-z0-9-]+\.[a-zA-Z0-9_-]{43}$/.test(result.playerPath))throw Error('Makaron 未返回有效的播放票据');
          show={id:result.id};send({type:'improv.live',action,id:show.id,playerPath:result.playerPath});
        }finally{opening=false;}
      }else if(action==='direct'){return observe(turn);}
      else if(action==='end'){if(!show)return {requested:true,action};const result=await observe(turn);return {requested:result.action==='end',action:result.action};}
      else if(action==='keep'&&show){send({type:'improv.live',action,id:show.id});}
      else throw Error('当前没有直播');
      return {requested:true,action};
    },
    end:stop,
    close(){closed=true;if(show)void stop(show.id).catch(()=>{});}
  };
}
