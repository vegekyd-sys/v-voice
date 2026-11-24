import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

export const IMPROV_TOOL = {
  type: 'function', name: 'improv_live',
  description: '在当前讲解画布开一场可中途改变的娱乐直播。根据整个对话理解用户意图：明确要开播或确认了上一轮的开播提议，直接 start。找现实直播、作图、生成普通视频用相应的其他工具。用户指定首图必须带上画布素材编号、current 或画面序号；用生成的 V 图片时选这幅作品，v 仅代表原始头像。身份或图片有歧义才询问。直播中用户描述的下一幕用 direct，日常聊天直接回答。收播用 end，通话继续。等待回执再报状态，connecting 表示开始连接，不能声称已经出画。回执报错时按错误原文判断：可以换图、先 end 再 start 或如实告诉用户。',
  parameters: {type:'object', additionalProperties:false, required:['action'], properties:{
    action:{type:'string',enum:['start','direct','end']},
    shot:{type:'string',description:'start 写具体开场，direct 写用户指定的下一幕。以图开场时保留图中主体和场景。最多 600 字。'},
    caption:{type:'string',description:'画面下方给观众看的一句镜头说明，口语、不超过 24 字，例如「小橘猫跳上柜台」。不要写画面要求或镜头术语。'},
    openingImage:{type:'string',description:'仅 start。指定作品时用本通电话素材编号（例如 a1、p2），指当前显示或选中图片用 current。纯文字开场可省略。'},
    imagePosition:{type:'integer',minimum:1,maximum:16,description:'仅 start。用户按当前页面顺序指定的第几张图，从 1 起。与 openingImage 二选一。'}
  }}
};

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
    }catch(error){
      // The CLI prints Makaron's own reason as its last stderr line. Hand that
      // reason to the model so it can choose: end first, pick another image, or explain.
      const reason=String(error?.stderr??'').trim().split('\n').at(-1)?.replace(/https?:\/\/\S+/gu,'').trim().slice(0,160);
      throw Error(error?.killed?'Makaron Director 超时未回应，可以稍后重试':reason?'Makaron Director：'+reason:'Makaron Director 未确认操作，请查看本场状态');
    }
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

// Realtime models often fill every optional field: an empty caption, an empty image or
// position 0 on a direction. Those mean "not given", not a different request.
export function improvArguments(args){
  if(!args||typeof args!=='object'||Array.isArray(args))return args;
  const out={...args};
  for(const key of ['shot','caption','openingImage'])if(typeof out[key]==='string'&&!out[key].trim())delete out[key];
  if(out.imagePosition===0||out.imagePosition===null||out.imagePosition==='')delete out.imagePosition;
  if(out.action!=='start'){delete out.openingImage;delete out.imagePosition;}
  if(out.action==='end')delete out.shot;
  return out;
}
export const clip=(text,limit=24)=>{const chars=Array.from(String(text??'').replace(/\s+/gu,' ').trim());return chars.length>limit?chars.slice(0,limit-1).join('')+'…':chars.join('');};
const ENDINGS={time:'本场已到时长上限',failed:'直播连接中断',caller:'用户在画面上结束了直播',call:'通话结束'};
export function createImprovShow({run}) {
  let show=null, starting=null, closed=false, emit, ended=null;
  const directions=new WeakMap(), started=new WeakSet();
  async function stop(id,reason='') {
    if(!show || show.id!==id)return false;
    const result=await run(['stop',id]);
    if(result.phase!=='ended')throw Error('Makaron 尚未确认收播');
    if(show?.id===id){show=null;ended={reason:ENDINGS[reason]??'',at:Date.now()};emit?.({type:'improv.live',id,action:'end'});}
    return true;
  }
  async function start(shot,send,imageUrl,aspect,imageName,caption){
    const result=await run(['start','--prompt',shot,'--request-id',randomUUID(),...(imageUrl && aspect?['--aspect-ratio',aspect]:[]),...(imageUrl?['--image',imageUrl]:[])]);
    if(closed){await run(['stop',result.id]);throw Error('这通电话已结束');}
    if(result.phase!=='waiting'||!/^\/director\/player\.html#[a-z0-9-]+\.[a-zA-Z0-9_-]{43}$/.test(result.playerPath))throw Error('Makaron 未返回有效的播放票据');
    show={id:result.id,imageName}; emit=send; ended=null;
    send({type:'improv.live',action:'start',id:show.id,playerPath:result.playerPath,...(imageUrl?{imageUrl}:{}),...(imageName?{name:clip(imageName,30)}:{}),...(caption?{caption}:{})});
    return {requested:true,action:'start',state:'connecting',openingImageName:imageName};
  }
  return {
    async command({action,shot,caption},turn,send,imageUrl='',aspect='',imageName=''){
      if(closed || !turn)throw Error('需要当前通话内的用户请求');
      const label=clip(caption);
      if(action==='start'){
        if(show){send({type:'improv.live',action:'focus',id:show.id});return {requested:true,action,state:'existing',openingImageName:show.imageName};}
        if(starting)return starting;
        // One show per spoken request; a failed attempt leaves the turn free to retry.
        if(started.has(turn))throw Error('本轮已经开过一场直播，它已结束；需要再开请等用户再次要求');
        if(!shot?.trim() || shot.length>600)throw Error('需要简短的开场描述');
        starting=start(shot.trim(),send,imageUrl,aspect,imageName,label);
        try{const result=await starting;started.add(turn);return result;}finally{starting=null;}
      }
      if(starting)await starting.catch(()=>{});
      if(action==='end'){
        if(show)await stop(show.id,'caller');
        return {requested:true,action,state:'ended'};
      }
      if(action!=='direct')throw Error('不支持的直播操作');
      if(!show)throw Error(ended?'当前没有直播：'+(ended.reason||'上一场已结束')+'。需要的话可以重新开播':'当前没有直播');
      const words=(shot || turn.text)?.trim();
      if(!words || words.length>600)throw Error('需要简短的下一幕描述');
      const id=show.id;
      if(!directions.has(turn))directions.set(turn,run(['direct',id,'--turn-id',String(turn.id||randomUUID()),'--',words]));
      const result=await directions.get(turn);
      if(Number.isInteger(result?.version) && show?.id===id)send({type:'improv.live',action:'label',id,version:result.version,text:label||clip(turn.text)});
      return {...result,instruction:'根据导演回执回应。已提交的下一幕仍需等待在画面中播出。'};
    },
    end:stop,
    close(){closed=true;if(show)void stop(show.id,'call').catch(()=>{});}
  };
}
