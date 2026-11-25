// A lesson the voice model promised and never asked for. Doubao answering at once ("好，我讲讲。" within
// 100 ms of the caller's last word) sometimes ends that reply without the explain_on_board call (call
// c58fea83 of 11/25: three times in four minutes; the page showed only a title and V said nothing more
// until the caller asked "出来了没有？"). The line is the one the model is told to say only when it calls
// the lesson, so the lesson it promised is started for it: once per turn of the caller, and only when no
// tool at all was called in that turn. (Doubao takes no typed turn: a nudge sent to it does nothing.)
const PROMISE=/^(?:好|好的|好呀|嗯|行|可以|没问题|ok)[，,、。！!～~\s]*(?:那)?我(?:来|就|再)?(?:给你|跟你|给你们|跟你们)?讲讲/iu;
/** Whether V's whole reply is only the line that goes with calling the lesson tool. */
export const promisesLesson=text=>{const value=String(text??'').trim();return Array.from(value).length<=30&&PROMISE.test(value)&&!/[?？]/u.test(value);};
export function createLessonPromiseRecovery({state,start,audit=()=>{},now=Date.now,settleMs=1500}) {
  let turn=0,invoked=false,asked='',promise=null;
  return {
    user(text){turn++;invoked=false;promise=null;asked=String(text??'').trim();},
    started(){invoked=true;promise=null;},
    assistant(text){if(!invoked&&!promise&&asked&&promisesLesson(text))promise={turn,at:now()};},
    tick(){
      // (The call can still come a moment after the line: 2ec71f66 said it first and called three seconds later.)
      if(!promise||invoked||promise.turn!==turn||now()-promise.at<settleMs)return;
      const s=state();
      if(!s.current||s.ending||s.routed||!s.offered||s.explaining){promise=null;invoked=true;return;}
      if(s.userSpeaking)return;
      promise=null;invoked=true;
      audit({type:'lesson.promise-recovery'});
      start(asked);
    },
  };
}
