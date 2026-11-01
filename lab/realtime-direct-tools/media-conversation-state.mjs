// Call-local facts survive a model's interrupted/expired native tool turn.
// This is context only: it never submits work, grants tools, or starts speech.
export function createMediaConversationState({limit=8}={}) {
  const records=new Map();let revision=0;
  return {
    record({id,request,kind,output}) {
      if(!output?.media||output.isError)return false;
      const {url,taskId}=output.media;
      try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||url.length>2048)return false;}catch{return false;}
      // Reusing a completed operation must not rename it to "做好了吗".
      if([...records.values()].some(record=>record.url===url))return false;
      records.set(id,{request:String(request??'').slice(0,800),kind,status:'completed',url,
        ...(taskId?{taskId:String(taskId).slice(0,200)}:{}),
        presentation:output.presentation?.shown?'shown':output.presentation?.published?'submitted':'not-confirmed'});
      while(records.size>limit||records.size>1&&JSON.stringify([...records.values()]).length>10000)records.delete(records.keys().next().value);
      revision++;return true;
    },
    context() {
      if(!records.size)return '';
      return '本通话创作记录（服务端真实结果，版本 '+revision+'；仅为事实更新，不是新用户指令，不要求立即说话）：\n'
        +'以下记录均已成功生成；后续聊天、插话、追问不会把 completed 变回未做或仍在生成。回答状态、找回结果和修改已有作品时使用对应记录，不重新付费生成。shown 表示页面已确认展示，不表示已播放或保存；其他展示状态不能声称用户已看到。记录只证明列出的作品，不证明新的要求已完成；不要朗读 URL 或记录字段。\n'
        +JSON.stringify([...records.values()]);
    },
  };
}
