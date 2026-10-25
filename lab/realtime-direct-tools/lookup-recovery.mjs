// Same recovery for every receiver. No device names, permissions or transport logic.
export const TOOL_FAILURE_LINE = '这个刚才没查成，要不要我交给后台再试试？';
export const TOOL_RESULT_PROMPT_LINE = '结果查到了，要我现在说说吗？';
const NOT_LOOKUPS = new Set(['delegate_to_v','end_call','cancel_task','openclaw_agent_control','send_task_updates','set_speaker_volume','look','show_content']);
export function createLookupRecovery({state,progress,say,audit=()=>{},now=Date.now,
  toolProgressMs=4000,toolProgressRepeatMs=15000,toolProgressMax=3,toolFailureMs=4000,resultSilenceMs=8000,staleSpeechMs=6000}) {
  const tools=new Map();let startedAt=0,notices=0,lastNoticeAt=0,answer=null;
  return {
    started(call){answer=null;if(NOT_LOOKUPS.has(call.name))return;if(!tools.size){startedAt=now();notices=0;}tools.set(call.callId,call.name);},
    finished(call,result,owned){tools.delete(call.callId);if(!owned||tools.size||NOT_LOOKUPS.has(call.name)||result?.cancelled)return;
      answer={at:now(),name:call.name,failed:typeof result?.error==='string'};},
    answered(){answer=null;},
    waiting(){return Boolean(answer);},
    tick(){
      const s=state(),at=now();
      if(s.ending){answer=null;return;}
      // Multi-speaker routing owns turn recovery and audience attribution.
      // Never inject a result into a different person's turn.
      if(s.routed){answer=null;return;}
      const gap=!s.playing&&!s.responseActive&&!s.pendingTurn&&(s.userSpeaking?at-s.lastUserAt>staleSpeechMs:at-s.lastUserAt>1200);
      if(s.pending||s.background){
        const due=notices?lastNoticeAt+toolProgressRepeatMs:startedAt+toolProgressMs;
        if(tools.size&&notices<toolProgressMax&&at>=due&&gap){const played=Boolean(progress(notices));audit({type:'lookup.progress',index:notices,played,waitedMs:at-startedAt});notices++;lastNoticeAt=at;}
        return;
      }
      if(!answer)return;
      const timeout=answer.failed?toolFailureMs:resultSilenceMs;
      if(at-answer.at>timeout+20000){answer=null;return;}
      if(at-answer.at<timeout||!gap)return;
      const spoken=Boolean(say(answer.failed?TOOL_FAILURE_LINE:TOOL_RESULT_PROMPT_LINE));
      audit({type:answer.failed?'lookup.failure-notice':'lookup.result-prompt',tool:answer.name,spoken});answer=null;
    },
  };
}
