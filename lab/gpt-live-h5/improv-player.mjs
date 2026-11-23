// The playback peer belongs to the call. The lesson board can collapse, move
// to another sheet or reopen while Makaron continues recording the same peer.
export function createImprovPlayer({update,ended,keep,notice}){
  let current;
  function close(){
    if(!current)return;
    window.removeEventListener('message',current.listener);
    clearTimeout(current.cleanup);current.frame.remove();current=null;update(null);
  }
  function finish(){
    if(!current || current.closing)return;
    current.closing=true;
    current.frame.contentWindow?.postMessage({id:current.id,action:'end'},location.origin);
    ended(current.id);
    current.cleanup=setTimeout(close,30000);
  }
  function receive(event){
    if(event.action!=='start'){
      if(current?.id!==event.id)return;
      if(event.action==='end')finish();
      if(event.action==='keep')keep();
      return;
    }
    if(current || typeof event.playerPath!=='string')return;
    const url=new URL('.'+event.playerPath,document.baseURI);
    if(url.origin!==location.origin || !url.pathname.endsWith('/director/player.html'))return;
    url.searchParams.set('embed','1');
    const frame=document.createElement('iframe');frame.hidden=true;frame.title='Makaron Director 直播连接';frame.allow='autoplay';
    const show={id:event.id,frame,listener:e=>{
      if(e.source!==frame.contentWindow || e.origin!==location.origin || e.data?.source!=='makaron-director' || e.data.id!==event.id)return;
      if(e.data.action==='playing')update({id:event.id,stream:frame.contentDocument.querySelector('video')?.srcObject});
      if(e.data.action==='ended'){ended(event.id);close();notice('直播结束，通话继续');}
    }};
    current=show;window.addEventListener('message',show.listener);
    update({id:show.id});frame.src=url.href;document.body.append(frame);
  }
  return {receive,finish,keep};
}
