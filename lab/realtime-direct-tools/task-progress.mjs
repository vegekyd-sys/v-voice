// Fixed host facts only. Never forward args, outputs, paths or model reasoning.
const stages = Object.freeze({
  memory_search:['memory','正在查记忆','记忆查询已返回'],
  memory_get:['memory','正在读取记忆原文','记忆原文已返回'],
  read:['background','正在读取资料','资料读取已返回'],
  web_search:['web','正在搜索资料','资料搜索已返回'],
  x_search:['web','正在搜索资料','资料搜索已返回'],
  web_fetch:['web','正在读取网页','网页读取已返回'],
  feishu_calendar:['calendar','正在处理日程','日程操作已返回'],
});
const preparationStages=Object.freeze({
  preparing_workspace:'正在准备任务环境',
  preparing_context:'正在读取任务上下文',
  starting_model:'正在等待后台模型响应',
});
export function createTaskProgress({runId,onUpdate=()=>{},now=Date.now}) {
  const pending=new Map(),completed=new Set(),startedAt=now();let closed=false,last='',sequence=0;
  const emit=(activity,text)=>{
    if(closed||text===last)return;
    last=text;onUpdate({runId,kind:'activity',activity,text,sequence:++sequence,startedAt,elapsedMs:Math.max(0,now()-startedAt),completedSteps:completed.size});
  };
  return {
    accepted(){if(!sequence)emit('background','任务已接收，等待后台执行');},
    consume(event){
      if(closed||event?.event!=='agent'||event.payload?.runId!==runId)return;
      const p=event.payload,d=p.data??{};
      if(p.stream==='run_status'&&Object.hasOwn(preparationStages,d.phase)){
        emit('background',preparationStages[d.phase]);return;
      }
      if(p.stream==='lifecycle'&&d.phase==='start'){emit('background','后台已开始处理');return;}
      if(p.stream!=='tool'||typeof d.toolCallId!=='string'||!d.toolCallId)return;
      const stage=stages[d.name]??['background','正在执行操作','操作已返回'];
      if(d.phase==='start'){
        if(completed.has(d.toolCallId)||pending.has(d.toolCallId))return;
        pending.set(d.toolCallId,stage);emit(stage[0],stage[1]);
      } else if(d.phase==='result'){
        if(completed.has(d.toolCallId))return;
        // Only count calls observed starting on this exact run.
        if(!pending.delete(d.toolCallId))return;
        completed.add(d.toolCallId);
        const next=[...pending.values()].at(-1);
        emit(next?.[0]??stage[0],next?.[1]??(d.isError||d.result?.isError?'操作返回错误，等待后台处理':stage[2]+'，正在整理'));
      }
    },
    close(){closed=true;pending.clear();completed.clear();},
  };
}
