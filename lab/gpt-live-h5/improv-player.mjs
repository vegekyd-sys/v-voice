// The playback peer belongs to the call. The lesson board can collapse, move
// to another sheet or reopen while Makaron continues recording the same peer.
export function createImprovPlayer({update,ended,notice}){
  let current;
  function publish(show) {
    update({id:show.id,stream:show.stream,caption:show.caption,note:show.note,focus:show.focus});
  }
  function detach(show) {
    if(current===show){current=null;update(null);}
  }
  function close(show){
    window.removeEventListener('message',show.listener);
    clearTimeout(show.cleanup);show.frame.remove();detach(show);
  }
  function finish(){
    const show=current;
    if(!show)return;
    detach(show);
    show.frame.contentWindow?.postMessage({id:show.id,action:'end'},location.origin);
    ended(show.id);
    show.cleanup=setTimeout(()=>close(show),45000);
  }
  function receive(event){
    if(event.action!=='start'){
      if(current?.id!==event.id)return;
      if(event.action==='end')finish();
      if(event.action==='focus'){current.focus=(current.focus||0)+1;publish(current);}
      return;
    }
    if(current || typeof event.playerPath!=='string')return;
    const url=new URL('.'+event.playerPath,document.baseURI);
    if(url.origin!==location.origin || !url.pathname.endsWith('/director/player.html'))return;
    url.searchParams.set('embed','1');
    const frame=document.createElement('iframe');frame.hidden=true;frame.title='Makaron Director 直播连接';frame.allow='autoplay';
    const show={id:event.id,frame,listener:e=>{
      if(e.source!==frame.contentWindow || e.origin!==location.origin || e.data?.source!=='makaron-director' || e.data.id!==event.id)return;
      if(e.data.action==='ended'){
        if(current===show){ended(event.id);notice(e.data.failed?'直播连接失败，可以重新开播':'直播结束，通话继续',e.data.failed);}
        close(show);return;
      }
      if(current!==show)return;
      if(e.data.action==='playing'){show.stream=frame.contentDocument.querySelector('video')?.srcObject;publish(show);}
      if(e.data.action==='direction'){
        if(e.data.state==='applied' && Number.isInteger(e.data.version) && e.data.version>(show.version||0)){
          show.version=e.data.version;show.caption=String(e.data.text||'').slice(0,2000);show.note='';
        } else if(e.data.state==='sent')show.note='正在调整镜头';
        else if(e.data.state==='rejected')show.note='这条指令未被采用';
        publish(show);
      }
    }};
    current=show;window.addEventListener('message',show.listener);
    update({id:show.id});frame.src=url.href;document.body.append(frame);
  }
  return {receive,finish};
}
