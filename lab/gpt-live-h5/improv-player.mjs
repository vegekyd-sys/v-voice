// The playback peer belongs to the call. The lesson board can collapse, move
// to another sheet or reopen while Makaron continues recording the same peer.
export function createImprovPlayer({context,update,ended,notice,archive=()=>{}}){
  let current, callerSpeaking=false, hostSpeaking=false, outputMuted=false;
  function mix(show) {
    if(!show?.gain)return;
    const duck=callerSpeaking || hostSpeaking;
    const level=outputMuted || show.muted ? 0 : duck ? 0.18 : 0.85;
    const gain=show.gain.gain;
    if(!show.mixed)gain.value=level;
    else gain.setTargetAtTime(level,context.currentTime,level===0?0.008:duck?0.025:0.09);
    show.mixed=true;
  }
  function attachSound(show,stream) {
    if(show.stream===stream)return;
    disconnectSound(show);
    show.stream=stream;
    if(!stream || !context)return;
    // Use the call's unlocked output. Flipping a lesson page or muting the
    // preview must never disable the provider track shared with the recorder.
    const bind=()=>{
      const track=stream.getAudioTracks().find(t=>t.readyState==='live');
      if(current!==show || !track || show.track===track)return;
      show.source?.disconnect();show.track=track;
      show.gain??=context.createGain();
      if(!show.mixed)show.gain.connect(context.destination);
      mix(show);
      show.source=context.createMediaStreamSource(new MediaStream([track]));
      show.source.connect(show.gain);
    };
    show.bind=bind;stream.addEventListener('addtrack',bind);bind();
  }
  function disconnectSound(show) {
    if(show.bind)show.stream?.removeEventListener('addtrack',show.bind);
    show.source?.disconnect();show.gain?.disconnect();
    show.gain=show.source=show.track=show.bind=null;show.mixed=false;
  }
  function publish(show) {
    update({id:show.id,stream:show.stream,muted:!!show.muted,imageUrl:show.imageUrl,cue:show.cue,note:show.note,focus:show.focus});
  }
  function keep(show) {
    if(!show.stream && !show.recording)return;
    const video=show.frame.contentDocument?.querySelector('video');
    archive({id:show.id,shape:video?.videoWidth/video?.videoHeight || show.shape, poster:show.poster || show.imageUrl, recording:show.recording, done:!!show.done, caption:show.cue?.text});
  }
  function detach(show) {
    disconnectSound(show);
    if(current===show){current=null;update(null);}
  }
  function close(show){
    window.removeEventListener('message',show.listener);
    clearTimeout(show.cleanup);show.frame.remove();detach(show);
  }
  function finish(){
    const show=current;
    if(!show)return;
    keep(show);detach(show);
    show.frame.contentWindow?.postMessage({id:show.id,action:'end'},location.origin);
    ended(show.id);
    show.cleanup=setTimeout(()=>{show.done=true;keep(show);close(show);},45000);
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
    const show={id:event.id,imageUrl:event.imageUrl,frame,listener:e=>{
      if(e.source!==frame.contentWindow || e.origin!==location.origin || e.data?.source!=='makaron-director' || e.data.id!==event.id)return;
      if(e.data.action==='stopped'){const v=frame.contentDocument?.querySelector('video');show.shape=v?.videoWidth/v?.videoHeight;show.poster=e.data.poster;keep(show);disconnectSound(show);return;}
      if(e.data.action==='recorded' && e.data.blob instanceof Blob && e.data.blob.size && !show.recording){
        show.recording=URL.createObjectURL(e.data.blob);keep(show);return;
      }
      if(e.data.action==='ended'){
        show.done=true;keep(show);
        if(current===show){ended(event.id);notice(e.data.failed?'直播连接失败，可以重新开播':'直播结束，通话继续',e.data.failed);}
        close(show);return;
      }
      if(current!==show)return;
      if(e.data.action==='playing'){attachSound(show,frame.contentDocument.querySelector('video')?.srcObject);publish(show);}
      if(e.data.action==='direction'){
        if(e.data.state==='playing' && Number.isInteger(e.data.version) && e.data.version>(show.version||0)){
          show.version=e.data.version;show.cue={version:e.data.version,text:String(e.data.text||'').slice(0,2000),rtp:e.data.rtpTimestamp};show.note='';
        } else if(e.data.state==='sent')return;
        else if(e.data.state==='rejected')show.note='这条指令未被采用';
        publish(show);
      }
    }};
    current=show;window.addEventListener('message',show.listener);
    publish(show);frame.src=url.href;document.body.append(frame);
  }
  return {receive,finish,
    toggleSound(){if(current){current.muted=!current.muted;mix(current);publish(current);}},
    setOutputMuted(value){outputMuted=value;mix(current);},
    setHostSpeaking(value){hostSpeaking=value;mix(current);},
    setCallerSpeaking(value){callerSpeaking=value;mix(current);},
  };
}
