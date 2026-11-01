import {randomUUID} from 'node:crypto';

// The same exec -> running/sessionId -> process contract used by Gateway exec.
// Entries are execution handles, not model memory or conversation instructions.
export function createLocalExecutions({yieldMs=1000,maxJobs=128}={}) {
  const jobs=new Map();
  const running=job=>({status:'running',sessionId:job.id,content:[{type:'text',text:'执行仍在进行。用 process(action="poll", sessionId="'+job.id+'", timeout=5000) 继续读取原执行结果；不要重新执行命令。'}],details:{status:'running',sessionId:job.id}});
  const read=async(job,timeout,signal)=>{
    signal?.throwIfAborted();
    if(job.done)return job.result;
    let timer,abort;
    try {
      await Promise.race([job.completion,new Promise((resolve,reject)=>{
        timer=setTimeout(resolve,Math.max(0,Math.min(5000,timeout)));
        abort=()=>reject(signal.reason??Error('执行查询已取消'));
        signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted)abort();
      })]);
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    return job.done?job.result:running(job);
  };
  return {
    has:id=>jobs.has(id),
    metadata:id=>jobs.get(id)?.metadata,
    start(factory,{signal,metadata}={}) {
      signal?.throwIfAborted();
      for(const [id,job] of jobs){if(jobs.size<maxJobs)break;if(job.done)jobs.delete(id);}
      if(jobs.size>=maxJobs)throw Error('本通话正在执行的任务过多');
      const controller=new AbortController(),job={id:'voice-exec-'+randomUUID(),controller,metadata,done:false};
      const abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});
      jobs.set(job.id,job);
      job.completion=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return factory(controller.signal);}).then(
        result=>{job.result=result;},
        error=>{job.result={isError:true,content:[{type:'text',text:error.message}],details:{status:'failed'}};},
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
