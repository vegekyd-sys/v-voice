import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

export const IMPROV_TOOL = {
  type: 'function', name: 'improv_live',
  description: '在当前讲解画布开一场可中途改变的娱乐直播。根据整个对话理解用户意图：明确要开播或确认了上一轮的开播提议，直接 start。找现实直播、作图、生成普通视频用相应的其他工具。用户指定首图必须带上画布素材编号、current 或画面序号；用生成的 V 图片时选这幅作品，v 仅代表原始头像。身份或图片有歧义才询问。直播中用户描述的下一幕用 direct，日常聊天直接回答。收播用 end，通话继续。等待回执再报状态，connecting 表示开始连接，不能声称已经出画。',
  parameters: {type:'object', additionalProperties:false, required:['action'], properties:{
    action:{type:'string',enum:['start','direct','end']},
    shot:{type:'string',description:'start 写具体开场，direct 写用户指定的下一幕。以图开场时保留图中主体和场景。最多 600 字。'},
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
  let show=null, starting=null, lastStart, closed=false, emit;
  const directions=new WeakMap();
  async function stop(id) {
    if(!show || show.id!==id)return false;
    const result=await run(['stop',id]);
    if(result.phase!=='ended')throw Error('Makaron 尚未确认收播');
    if(show?.id===id){show=null;emit?.({type:'improv.live',id,action:'end'});}
    return true;
  }
  async function start(shot,send,imageUrl,aspect,imageName){
    const result=await run(['start','--prompt',shot,'--request-id',randomUUID(),...(imageUrl && aspect?['--aspect-ratio',aspect]:[]),...(imageUrl?['--image',imageUrl]:[])]);
    if(closed){await run(['stop',result.id]);throw Error('这通电话已结束');}
    if(result.phase!=='waiting'||!/^\/director\/player\.html#[a-z0-9-]+\.[a-zA-Z0-9_-]{43}$/.test(result.playerPath))throw Error('Makaron 未返回有效的播放票据');
    show={id:result.id,imageName}; emit=send;
    send({type:'improv.live',action:'start',id:show.id,playerPath:result.playerPath,...(imageUrl?{imageUrl}:{})});
    return {requested:true,action:'start',state:'connecting',openingImageName:imageName};
  }
  return {
    async command({action,shot},turn,send,imageUrl='',aspect='',imageName=''){
      if(closed || !turn)throw Error('需要当前通话内的用户请求');
      if(action==='start'){
        if(show){send({type:'improv.live',action:'focus',id:show.id});return {requested:true,action,state:'existing',openingImageName:show.imageName};}
        if(starting)return starting;
        if(lastStart===turn)throw Error('本轮的开播请求已经处理');
        if(!shot?.trim() || shot.length>600)throw Error('需要简短的开场描述');
        lastStart=turn;
        starting=start(shot.trim(),send,imageUrl,aspect,imageName);
        try{return await starting;}finally{starting=null;}
      }
      if(starting)await starting;
      if(action==='end'){
        if(show)await stop(show.id);
        return {requested:true,action,state:'ended'};
      }
      if(action!=='direct'||!show)throw Error('当前没有直播');
      const words=(shot || turn.text)?.trim();
      if(!words || words.length>600)throw Error('需要简短的下一幕描述');
      if(!directions.has(turn))directions.set(turn,run(['direct',show.id,'--turn-id',String(turn.id||randomUUID()),'--',words]));
      const result=await directions.get(turn);
      return {...result,instruction:'根据导演回执回应。已提交的下一幕仍需等待在画面中播出。'};
    },
    end:stop,
    close(){closed=true;if(show)void stop(show.id).catch(()=>{});}
  };
}
