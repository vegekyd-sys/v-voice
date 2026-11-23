import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

export const IMPROV_TOOL = {
  type: 'function', name: 'improv_live',
  description: '通话内即兴直播。只有用户明确请你开一场娱乐直播时才 start。从刚聊的话题取一个具体的梗，写一幕有动作和意外的虚构开场。镜头提示只写可见场景，不含私人信息。用户指定用屏幕上的图开场时带 openingImage，“用这个”“用它”也指当前画面，填 current，指定素材填它的编号。以图开场时保留图中人物、场景与构图，再让动作发展。等工具确认提交后再说正在连接。开播后每句用户语音由 Makaron 分辨剧情、聊天和收播。新的角色、动作或场景自然算下一幕，画面由导演呈现，你可以简短接话。不要重复提交或声称看见尚未播出的改动。结束直播用 end，继续通话。图片、短片、查找真实直播仍走原路径。返回 requested 表示已交给屏幕，不代表已经播出。',
  parameters: {type:'object', additionalProperties:false, required:['action'], properties:{
    action:{type:'string',enum:['start','direct','end']}, shot:{type:'string',description:'start 或 direct 的镜头描述，最多 600 字'},
    openingImage:{type:'string',description:'仅 start，用户指定的屏幕参考图，current 或本次电话中的图片编号'}
  }}
};

// A second admission check before a billable session. The model chooses the action;
// a quoted example, a search for a broadcast, or an ordinary video request cannot open one.
const invitation = /^(?:(?:小?[vV维]|好[呀啊的]?|然后|接着|再|那(?:就)?|请|你|能不能|能|可以|现在|帮我[们]?|给(?:我[们]?|大家|咱们))[，,、\s]*)*(?:来|开(?:启|始)?|搞|整|做|办|播)(?:个|一场|一段|场|一回|一次|一个|一期|点)?(?:[^“”「」。？！?]{1,24}的)?(?:即兴|娱乐|趣味|惊喜|互动)?直播(?:什么的|给我们看看|好不好|好吗)?(?:[吧啊呀呗嘛吗么啦！!。？?～~\s]*|[，,：:].{1,160})$/u;
export function invited(text) {
  if (typeof text !== 'string') return false;
  // A topic can precede the invitation in the same utterance. Quoted speech
  // and questions about someone else's invitation are left to conversation.
  const line = text.trim();
  if (/[“”「」"‘’]|(?:他说|她说|比如说|举个例子|如果|假如|假设|举例|先别|不要开|不用开|别开|取消开播)/u.test(line)) return false;
  const last = line.split(/[，,。！!]/u).filter(Boolean).at(-1)?.trim() ?? '';
  const afterImage = last.replace(/^(?:请|你|可以|能不能|帮我|就)*(?:用|拿|以)(?:这|那|刚才|刚做|刚画|屏幕上)[^，。？！?]{0,18}?(?:图片|照片|海报|图)(?:来|去|作为开场|当开场)?/u, '');
  if (/怎么|如何|教程|能否开直播的|(?:找|搜|看|打开)[^，。]{0,10}(?:直播间|直播链接|比赛直播)|没(?:有)?(?:成功|开)|开不了|不(?:要|用|想|能)?(?:再)?(?:开|直播)|别(?:再)?(?:开|直播)|结束直播|停止直播/u.test(line)) return false;
  return invitation.test(line) || invitation.test(afterImage) ||
    /(?:^|[，,。\s]|我们|咱们|给我|帮我|现在|请|直接|开始|那就|小何|作为首帧|当开场|图|照片|画面)(?:来|搞|开(?:启|始)?|做|整)(?:一?[场个段次]|一下)?(?:即兴|娱乐|互动|马卡龙)?直播(?:一下|吧|啦|呗|好吗|吗|[，。？！!?\s]|$)/u.test(line) ||
    /(?:^|[，,。\s]|请|现在|直接|那就|图片|照片|图|开场|首帧|形象)(?:来)?开播(?:吧|啦|呗|好吗|吗|了|[，。？！!?\s]|$)/u.test(line);
}

// A self-contained opening when the voice model only answers aloud. Only
// scene instructions from this invitation belong in the provider prompt.
export function openingShot(words, image) {
  const scene = words.split(/[，,。！!？?]/u).map(part=>part.trim())
    .filter(part=>part && !/直播|开播|不用图|不要图|^(?:小何|小V|谢谢|好了|好吧)$/iu.test(part))
    .filter(part=>/场景|镜头|画面|拍|看到|出现|走|飞|跑|变成|站在|一[只座辆场群]|故事/u.test(part))
    .join('，').slice(0,420);
  if (image) {
    const instructions=words.split(/直播|开播/u).at(-1)?.replace(/^[吧啊呀好吗呢什么的？?！!，,。\s]+/u,'').trim();
    return '从这张图开始，保留原来的人物、场景和构图。'+(instructions || scene || '让画面中的主体自然动起来。').slice(0,420);
  }
  return scene || '一辆玩具火车开进微缩剧场，帷幕升起，一个纸做的月亮向观众鞠躬。';
}

export function openingImageFor({action, openingImage}, text) {
  if (action !== 'start' || !invited(text)) return '';
  if (/纯文字|只用文字|(?:不用|不要|别用|不需要)[^，。,.]{0,8}(?:图|照片|海报)/u.test(text)) return '';
  if (/(?:你的|你自己的|小何的|V的)(?:形象|头像|照片|图)/iu.test(text)) return 'v';
  if (/(?:用|拿|以|接着|照着|从|根据)(?:刚刚|刚才|画面上|屏幕上)?(?:这个|这幅|这张|它|这幅画)|(?:这个|它)(?:当|做|作为)(?:首帧|开场)/u.test(text)) return 'current';
  if (/(?:用|拿|以|让)[^，。？！?]{0,30}(?:这张|那张|图片|照片|海报|幅图|张图)/u.test(text)) {
    return /这张|刚(?:才)?(?:画|生成|上传)|我上传/u.test(text) ? 'current' : /^[ap]\d+$/.test(openingImage) ? openingImage : 'current';
  }
  return openingImage === 'current' || /^(?:[ap]\d+|v)$/.test(openingImage) ? openingImage : '';
}


export function directorCommand(environment=process.env) {
  const binary=environment.VOICE_MAKARON_DIRECTOR_CLI;
  if(!binary?.startsWith('/') || !environment.MAKARON_API_KEY || !environment.MAKARON_DIRECTOR_URL)return null;
  let endpoint;
  try {endpoint=new URL(environment.MAKARON_DIRECTOR_URL);} catch {return null;}
  if (endpoint.username || endpoint.password || !(endpoint.protocol==='https:' ||
      endpoint.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))) return null;
  const env=Object.fromEntries(['PATH','LANG','MAKARON_API_KEY','MAKARON_DIRECTOR_URL'].filter(k=>environment[k]).map(k=>[k,environment[k]]));
  const run = async args=>{
    try{
      const {stdout}=await execute(binary,['director','--json',...args],{env,timeout:45000,maxBuffer:65536});
      return JSON.parse(stdout);
    }catch{throw Error('Makaron Director 未确认操作，请查看本场状态');}
  };
  run.uploadReference = async (bytes, contentType) => {
    const ext = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[contentType];
    if (!ext || !bytes.length || bytes.length > 8 * 1024 * 1024) throw Error('参考图格式或大小不支持');
    const signed = await fetch(new URL('/api/storage/upload-url',endpoint.origin),{
      method:'POST', redirect:'error', signal:AbortSignal.timeout(20000),
      headers:{authorization:'Bearer '+env.MAKARON_API_KEY,'content-type':'application/json'},
      body:JSON.stringify({filename:'reference.'+ext,contentType})
    });
    if (!signed.ok) throw Error('参考图上传授权失败');
    const {uploadUrl,token,publicUrl}=await signed.json();
    if (![uploadUrl,publicUrl].every(address=>new URL(address).protocol==='https:') || !token) throw Error('上传地址无效');
    const uploaded=await fetch(uploadUrl,{method:'PUT',redirect:'error',signal:AbortSignal.timeout(45000),headers:{'content-type':contentType,authorization:'Bearer '+token},body:bytes});
    if (!uploaded.ok) throw Error('参考图上传失败');
    return publicUrl;
  };
  return run;
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
    const result=run(['direct',id,'--host','--turn-id',String(turn.id||randomUUID()),'--',turn.text]).then(value=>{
      if(value.action==='end' && show?.id===id){show=null;emit({type:'improv.live',id,action:'end'});}
      return value;
    });
    turns.set(turn,result);return result;
  }
  return {
    observe,
    get active(){return Boolean(show || opening);},
    decision:turn=>turns.get(turn),
    async command({action,shot},turn,send,imageUrl='',aspect=''){
      if(closed)throw Error('这通电话已结束');
      if(action==='start'){
        if(!invited(turn?.text))throw Error('请先确认是否开播');
        if(show){send({type:'improv.live',action:'focus',id:show.id});return {requested:true,action};}
        if(opening || turn===lastStart)return {requested:opening,action};
        if(!shot?.trim() || shot.length>600)throw Error('需要简短的开场描述');
        opening=true;lastStart=turn;emit=send;
        try{
          const prompt=imageUrl ? openingShot(turn.text,true) : shot.trim();
          const result=await run(['start','--prompt',prompt,'--request-id',randomUUID(),...(imageUrl && aspect?['--aspect-ratio',aspect]:[]),...(imageUrl?['--image',imageUrl]:[])]);
          if(closed){await run(['stop',result.id]);throw Error('这通电话已结束');}
          if(result.phase!=='waiting'||!/^\/director\/player\.html#[a-z0-9-]+\.[a-zA-Z0-9_-]{43}$/.test(result.playerPath))throw Error('Makaron 未返回有效的播放票据');
          show={id:result.id};send({type:'improv.live',action,id:show.id,playerPath:result.playerPath,...(imageUrl?{imageUrl}:{})});
        }finally{opening=false;}
      }else if(action==='direct'){const result=await observe(turn);return {...result,instruction:'只确认收到用户指定的动作，不播报画面、不添加新的角色或情节。'};}
      else if(action==='end'){if(!show)return {requested:true,action};const result=await observe(turn);return {requested:result.action==='end',action:result.action};}
      else throw Error('当前没有直播');
      return {requested:true,action};
    },
    end:stop,
    close(){closed=true;if(show)void stop(show.id).catch(()=>{});}
  };
}
