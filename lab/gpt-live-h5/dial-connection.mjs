// A call owns this socket from admission to hangup. Never retry an ambiguous
// allocation on the HTTP path: the first attempt may already own a live call.
export function createDialConnection({url,signal,Socket=WebSocket,timeoutMs=30000}) {
  const socket=new Socket(url);socket.binaryType='arraybuffer';
  let settled=false,adopted=false,failure=null,resolveReservation,rejectReservation;
  const pending=[];let pendingBytes=0;
  const reservation=new Promise((resolve,reject)=>{resolveReservation=resolve;rejectReservation=reject;});
  void reservation.catch(()=>{});
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const fail=error=>{failure=error;cleanup();if(!settled){settled=true;rejectReservation(error);}socket.close();};
  const abort=()=>fail(new DOMException('拨号已取消','AbortError'));
  const timer=setTimeout(()=>fail(Error('拨号超时，请重新拨号')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  socket.onmessage=event=>{
    try {
      if(typeof event.data!=='string'||event.data.length>1024*1024)throw Error('拨号响应无效');
      const value=JSON.parse(event.data);
      if(value.type==='dial.error')throw Error('暂时无法接通，请重新拨号');
      if(!settled){
        if(value.type!=='reservation'||value.dialVersion!==2||value.transport!=='gateway-relay'||typeof value.voiceSessionId!=='string'||!value.voiceSessionId)throw Error('拨号响应无效');
        settled=true;clearTimeout(timer);resolveReservation(value);return;
      }
      // The reservation promise resumes in a microtask. Retain any ready/audio
      // frames that arrive before the audio adapter takes ownership.
      pendingBytes+=event.data.length;
      if(pending.length>=128||pendingBytes>1024*1024)throw Error('拨号响应积压，请重新拨号');
      pending.push(event);
    }catch(error){fail(error);}
  };
  socket.onerror=()=>fail(Error('实时语音连接失败'));
  socket.onclose=()=>{failure??=Error('实时语音连接已关闭');cleanup();if(!settled){settled=true;rejectReservation(failure);}};
  if(signal?.aborted)abort();
  return {socket,reservation,
    adopt(){
      if(adopted)throw Error('拨号连接已被接管');adopted=true;cleanup();
      if(failure){socket.onclose?.({});return;}
      for(const event of pending)socket.onmessage?.(event);
      pending.length=0;pendingBytes=0;
    },
    dispose(){if(!adopted)abort();else socket.close();},
  };
}
