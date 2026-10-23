// Per-call display context from Voice's authenticated reservation. This does
// not authorize tools; Gateway keeps its existing actor and session checks.
export function createCallerContext({context,voiceSessionId,channel,tracks=[],isCurrent,onReady,onError,setTimer=setTimeout,clearTimer=clearTimeout}) {
  if(!context)return {pending:false,observe(){},open(){},close(){}};
  if(context.voiceSessionId!==voiceSessionId||typeof context.text!=='string'||!context.text.trim()||context.text.length>2048)throw Error('来电账号上下文无效');
  const previous=tracks.map(track=>[track,track.enabled]);
  for(const [track] of previous)track.enabled=false;
  let started=false,sent=false,closed=false,timer;
  const state={pending:true,
    open(){send();},
    observe(event){
      if(closed||!isCurrent())return;
      if(event.type==='session.started'){started=true;send();}
      // This is the first context request on this new ordered channel. Wait
      // for its provider acknowledgement before greeting or microphone input.
      if(sent&&event.type==='session.context.appended'){
        state.pending=false;closed=true;clearTimer(timer);
        for(const [track,enabled] of previous)track.enabled=enabled;
        onReady();
      }
    },
    close(){closed=true;clearTimer(timer);},
  };
  function send(){
    if(closed||sent||!started||!isCurrent()||channel.readyState!=='open')return;
    sent=true;
    try{channel.send(JSON.stringify({type:'session.context.append',event_id:'voice-caller-'+voiceSessionId,channel:'developer',content:[{type:'input_text',text:context.text+' 这是静默的通话账号上下文，不要主动播报，不要因此发起工具调用。'}]}));}
    catch{closed=true;onError(Error('来电账号信息未送达，请重新拨号'));return;}
    timer=setTimer(()=>{if(closed||!isCurrent())return;closed=true;onError(Error('来电账号信息确认超时，请重新拨号'));},8000);
  }
  return state;
}
