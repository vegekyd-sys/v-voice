// Repair a dropped model continuation, never execute or authorize a command.
// One nudge per human turn, and only for an unfulfilled explicit commitment.
export function createMediaTurnRecovery({state,resume,audit=()=>{},now=Date.now,settleMs=1200}) {
  let turn=0,invoked=false,attempted=false,promise=null;
  const committed=text=>{
    const value=String(text??'').trim();
    return value.length<260&&/^(?:好|没问题|可以|我来|我会|我这就|那我|这就|马上|就让)/u.test(value)
      &&/(?:做|生成|制作|画|动起来|调整)/u.test(value)&&/(?:图片|出图|视频|短片|画面|动起来|动效|动画|这张图)/u.test(value)
      &&!/[?？]|要不要|如果|需要的话|建议|已经|做好了|生成好了|完成了|做不了|不能|无法/u.test(value);
  };
  return {
    user(){turn++;invoked=false;attempted=false;promise=null;},
    started(){invoked=true;promise=null;},
    assistant(text){if(!invoked&&!attempted)promise=committed(text)?{turn,at:now()}:null;},
    tick(){
      if(!promise||attempted||invoked||promise.turn!==turn||now()-promise.at<settleMs)return;
      const s=state();
      if(!s.current||s.ending||s.routed){promise=null;return;}
      if(s.pending||s.playing||s.responseActive||s.userSpeaking)return;
      attempted=true;promise=null;
      resume('系统执行检查（不是新的用户请求，也不增加授权）：你刚才答应了图片或视频创作，但本轮没有发起创作工具。请依据真实用户原要求和已有授权继续未完成步骤；若只是咨询或仍缺必要条件就澄清。不要再只口头答应、不要重复接话；已有或状态未知的任务只能继续原任务，不能重复付费生成。');
      audit({type:'media.unfulfilled-promise-recovery'});
    },
  };
}
