import {randomUUID} from 'node:crypto';

export const LOCAL_EXECUTION_POLICY='exec 返回 running/sessionId 后可以正常聊天。执行器会在原执行结束且对话空闲时发出 execution.finished 状态事件；这不是用户请求，不增加授权，也不是完成结果。收到后用 process(action=poll, sessionId=事件中的真实ID) 读取最终工具结果，再主动用一句自然的话告知实际完成或失败，不念事件、ID或操作步骤。只在结果明确 running 时说仍在执行；不猜测渲染、上传等细分进度。工具明确 not-started/submission=not-submitted 表示尚未提交，不能说正在生成或重新生成；可按错误纠正原请求的参数后继续。submission=unknown 表示执行结果未知，不能自动重提、换模型或重新付费。';

export const executionFinishedMessage=({sessionId})=>'执行器状态通知（不是用户发言）：'+JSON.stringify({event:'execution.finished',sessionId});

// The same exec -> running/sessionId -> process contract used by Gateway exec.
// Entries are execution handles, not model memory or conversation instructions.
export function createLocalExecutions({yieldMs=1000,maxJobs=128,now=Date.now,notificationRetryMs=15000}={}) {
  const jobs=new Map();
  const running=job=>({status:'running',sessionId:job.id,content:[{type:'text',text:'执行仍在进行。用 process(action="poll", sessionId="'+job.id+'", timeout=5000) 继续读取原执行结果；不要重新执行命令。'}],details:{status:'running',sessionId:job.id}});
  const result=job=>{if(job.done){job.readFinal=true;return job.result;}job.yielded=true;return running(job);};
  const read=async(job,timeout,signal)=>{
    signal?.throwIfAborted();
    if(job.done)return result(job);
    let timer,abort;
    try {
      await Promise.race([job.completion,new Promise((resolve,reject)=>{
        timer=setTimeout(resolve,Math.max(0,Math.min(5000,timeout)));
        abort=()=>reject(signal.reason??Error('执行查询已取消'));
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted)abort();
      })]);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    signal?.throwIfAborted();
    return result(job);
  };
  return {
    has:id=>jobs.has(id),
    metadata:id=>jobs.get(id)?.metadata,
    // Wake the Agent with an execution handle only. It reads the actual result
    // through process; no domain memory, synthetic answer, or result replay.
    takeNotification(accept=()=>true) {
      for(const job of jobs.values()){
        if(!job.done||!job.yielded||job.readFinal||job.controller.signal.aborted||!accept(job.metadata))continue;
        if((job.notifications??0)>=2||job.notifiedAt!==undefined&&now()-job.notifiedAt<notificationRetryMs)continue;
        job.notifiedAt=now();job.notifications=(job.notifications??0)+1;
        return {sessionId:job.id};
      }
      return null;
    },
    start(factory,{signal,metadata}={}) {
      signal?.throwIfAborted();
      for(const [id,job] of jobs){if(jobs.size<maxJobs)break;if(job.done&&(job.readFinal||job.controller.signal.aborted))jobs.delete(id);}
      if(jobs.size>=maxJobs)throw Error('本通话正在执行的任务过多');
      const controller=new AbortController(),job={id:'voice-exec-'+randomUUID(),controller,metadata,done:false};
      const abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});
      jobs.set(job.id,job);
      job.completion=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return factory(controller.signal);}).then(
        result=>{job.result=result;},
        error=>{const message=String(error?.message??error);job.result={isError:true,error:message,content:[{type:'text',text:message}],details:{status:error?.submission==='not-submitted'?'not-started':'failed',submission:error?.submission??'unknown',...(error?.code?{code:error.code}:{}),retryable:error?.submission==='not-submitted'&&error?.code==='invalid_arguments'}};},
      ).finally(()=>{job.done=true;signal?.removeEventListener('abort',abort);});
      return read(job,yieldMs,signal);
    },
    poll(id,{timeout=1000,signal,action='poll'}={}) {
      const job=jobs.get(id);if(!job)throw Error('只能查询本通话返回的执行 sessionId');
      return read(job,action==='log'?0:timeout,signal);
    },
    async cancelAll(){for(const job of jobs.values())if(!job.done)job.controller.abort(Error('本通话执行等待已结束；供应商状态未确认，不重新生成'));await Promise.all([...jobs.values()].map(job=>job.completion));},
  };
}
