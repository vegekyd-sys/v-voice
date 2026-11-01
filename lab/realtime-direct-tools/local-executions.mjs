import {randomUUID} from 'node:crypto';

export const LOCAL_EXECUTION_POLICY='exec 返回 running/sessionId 后必须用 process(action=poll, sessionId=实际返回的ID, timeout=5000) 继续读取原执行，直到完成或失败；不能只口头承诺等待。期间可以正常回答用户插话，回答后继续查询尚未结束的原执行。最终工具结果返回后，根据真实结果主动用一句自然的话说明完成或失败，不复述轮询过程。只在结果明确 running 时说仍在执行；不猜测渲染、上传等细分进度。工具报错不属于静默轮询：工具明确 not-started/submission=not-submitted 时，下一轮必须先用自己组织的一句语音告诉用户尚未提交以及原因，再在同一轮调用工具纠正参数后首次提交；不能跳过失败说明直接调用工具，不能说正在生成或重新生成。submission=unknown 表示没有拿到最终结果，不能断言生成失败、未生成或还在生成，也不能建议重新试一次；有原任务ID时只查询原任务，没有可查询ID时明确说明无法确认，不能自动重提、换模型或重新付费。如果原执行结束时你没有在跟进，服务会用你提交时写的 completionLine 或 failureLine 告诉用户，结果也会进入对话；之后不要再通报一次，直接回应用户。';

// Doubao has no event that starts a model turn (response.create, a user item, a
// late tool result and input commit are all silent once the caller has spoken).
// So the model writes its own words up front and they are used only if needed.
const EXECUTION_FINISHED_FALLBACK={done:'刚才那个有结果了，要我说说吗？',failed:'刚才那个没拿到结果，要我说说情况吗？'};
const ownLine=value=>{const line=typeof value==='string'?value.trim():'';return line&&line.length<=120&&!/https?:|voice-exec-|[\r\n]/u.test(line)?line:'';};
export const executionFinishedLine=(result,{completionLine,failureLine}={})=>result?.isError?ownLine(failureLine)||EXECUTION_FINISHED_FALLBACK.failed:ownLine(completionLine)||EXECUTION_FINISHED_FALLBACK.done;
// What the conversation needs to act on the result later; never spoken.
export function executionResultFacts(result) {
  const text=result?.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n')??result?.error??'';
  return JSON.stringify({status:result?.isError?result.status??'failed':'completed',...(result?.isError?{submission:result.submission}:{}),...(result?.media?{media:result.media}:{}),...(result?.presentation?{presentation:result.presentation}:{}),...(!result?.media&&text?{output:text.slice(0,600)}:{})});
}

export function executionFailureResult(error) {
  const previous=error?.isError?error:{},details=previous.details??{};
  const message=String(previous.error??previous.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n')??error?.message??error);
  const submission=previous.submission??details.submission??error?.submission??'unknown';
  const code=details.code??error?.code,notSubmitted=submission==='not-submitted';
  const status=notSubmitted?'not-started':'failed',retryable=notSubmitted&&code==='invalid_arguments';
  return {...previous,isError:true,status,submission,error:message,content:previous.content??[{type:'text',text:message}],details:{...details,status,submission,...(code?{code}:{}),retryable},
    instruction:notSubmitted?'先明确告知用户本次还没有开始、没有提交。'+(retryable?'可以根据错误纠正原请求的参数后首次提交；不要把参数修正说成“重新做”“重新生成”或“还在生成”。':'说明启动失败，不自动重试。'):'执行结果未确认。主动说明没有拿到最终结果、目前无法确认完成；不能断言生成失败、未生成或还在生成，不能建议再试一次，不重新提交或重复付费。'};
}

// The same exec -> running/sessionId -> process contract used by Gateway exec.
// Entries are execution handles, not model memory or conversation instructions.
export function createLocalExecutions({yieldMs=1000,maxJobs=128,settleMs=2500,now=Date.now}={}) {
  const jobs=new Map();
  const running=job=>({status:'running',sessionId:job.id,content:[{type:'text',text:'执行仍在进行。用 process(action="poll", sessionId="'+job.id+'", timeout=5000) 继续读取原执行结果；不要重新执行命令。'}],details:{status:'running',sessionId:job.id}});
  const result=job=>{if(job.done){job.readFinal=true;return job.announced?{...job.result,instruction:'这个结果已经告诉过用户，不要再通报一次，直接回应用户当前的话。'}:job.result;}return running(job);};
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
    // A finished execution nobody is following. Taken at most once; process can still read it.
    takeUnread(accept=()=>true) {
      for(const job of jobs.values()){
        if(!job.done||job.readFinal||job.announced||job.controller.signal.aborted||now()-job.doneAt<settleMs||!accept(job.metadata))continue;
        job.announced=true;
        return {id:job.id,result:job.result,metadata:job.metadata};
      }
      return null;
    },
    metadata:id=>jobs.get(id)?.metadata,
    start(factory,{signal,metadata}={}) {
      signal?.throwIfAborted();
      for(const [id,job] of jobs){if(jobs.size<maxJobs)break;if(job.done&&(job.readFinal||job.announced||job.controller.signal.aborted))jobs.delete(id);}
      if(jobs.size>=maxJobs)throw Error('本通话正在执行的任务过多');
      const controller=new AbortController(),job={id:'voice-exec-'+randomUUID(),controller,metadata,done:false};
      const abort=()=>controller.abort(signal.reason);signal?.addEventListener('abort',abort,{once:true});
      jobs.set(job.id,job);
      job.completion=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return factory(controller.signal);}).then(
        result=>{job.result=result?.isError?executionFailureResult(result):result;},
        error=>{job.result=executionFailureResult(error);},
      ).finally(()=>{job.done=true;job.doneAt=now();signal?.removeEventListener('abort',abort);});
      return read(job,yieldMs,signal);
    },
    poll(id,{timeout=1000,signal,action='poll'}={}) {
      const job=jobs.get(id);if(!job)throw Error('只能查询本通话返回的执行 sessionId');
      return read(job,action==='log'?0:timeout,signal);
    },
    async cancelAll(){for(const job of jobs.values())if(!job.done)job.controller.abort(Error('本通话执行等待已结束；供应商状态未确认，不重新生成'));await Promise.all([...jobs.values()].map(job=>job.completion));},
  };
}
