// Narrow adapter over the existing H5 call-state attributes and controls.
// No audio, tokens, account or session identifiers cross this bridge. Markdown
// crosses only when the user chooses the existing document download button.
(() => {
  if (window !== top || !window.VVoiceHost || window.__vVoiceAndroid) return;
  window.__vVoiceAndroid = true;
  const send = value => VVoiceHost.postMessage(JSON.stringify(value));
  const tracks = new Set();
  if (navigator.mediaDevices?.getUserMedia) {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await capture(constraints);
      for (const track of stream.getTracks()) { tracks.add(track); track.addEventListener('ended', () => tracks.delete(track), {once:true}); }
      return stream;
    };
  }
  let previous = '';
  function report() {
    const state = document.body?.dataset.callState ?? 'idle';
    const muted = document.body?.dataset.microphoneMuted === 'true';
    const fingerprint = state + ':' + muted;
    if (fingerprint === previous) return;
    const wasActive = previous && !previous.startsWith('idle:'); previous = fingerprint;
    if (state === 'idle' && wasActive) { for(const track of tracks) track.stop(); tracks.clear(); }
    send({type:'state',state,muted});
  }
  let lastObscured;
  function presentation() {
    const obscured = document.body?.dataset.reading === 'true' || !!document.getElementById('changelogDialog')?.open ||
      !!document.querySelector('.sheet[aria-modal="true"]');
    if (obscured !== lastObscured) { lastObscured=obscured;send({type:'presentation',obscured}); }
  }
  // Android back dismisses the current H5 surface before backgrounding a call.
  // Use its own controls so React/reader state remains the single owner.
  window.__vVoiceAndroidBack = () => {
    if(document.getElementById('changelogDialog')?.open){document.getElementById('changelogClose')?.click();return true;}
    if(document.querySelector('.sheet[aria-modal="true"]')){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;}
    if(document.getElementById('modelMenu')){document.getElementById('modelTrigger')?.click();return true;}
    if(document.body?.dataset.reading === 'true'){document.getElementById('readerBack')?.click();return true;}
    if(document.getElementById('textToggle')?.getAttribute('aria-expanded')==='true'){document.getElementById('textToggle').click();return true;}
    return false;
  };
  const observe = () => {
    const style=document.createElement('style');style.textContent='.ios-binding-trigger{display:none!important}';document.head.append(style);
    new MutationObserver(report).observe(document.body,{attributes:true,attributeFilter:['data-call-state','data-microphone-muted']});report();
    new MutationObserver(presentation).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-reading','open']});presentation();
  };
  if(document.body)observe();else document.addEventListener('DOMContentLoaded',observe,{once:true});
  VVoiceHost.onmessage = event => {
    let value;try{value=JSON.parse(event.data);}catch{return;}
    if(value.type==='hangup')document.getElementById('stop')?.click();
    if(value.type==='mute')document.getElementById('mute')?.click();
  };
  window.addEventListener('pagehide',()=>{for(const track of tracks)track.stop();tracks.clear();send({type:'state',state:'idle',muted:false});});
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('#readerDownload');
    if(!target || !target.href.startsWith('blob:') || !event.isTrusted)return;
    event.preventDefault();
    void fetch(target.href).then(response=>response.text()).then(text=>{
      if(text.length<=500000)send({type:'saveDocument',text,title:document.getElementById('readerTitle')?.textContent?.slice(0,100)??'V 的方案'});
    }).catch(()=>{});
  },true);
})();
