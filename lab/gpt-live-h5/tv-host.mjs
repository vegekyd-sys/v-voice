import {resolveStatus} from './call-view.mjs';

// A projection of the shared page, never a second call engine or an identity bridge.
// Native hosts may echo owner + generation to reject queued actions from an old page/call.
export function installTvHost({view, window, actions, onError = () => {}}) {
  if (new URLSearchParams(window.location.search).get('tv') !== '1') return null;
  const document = window.document;
  document.documentElement.dataset.tv = 'true';
  const owner = window.crypto.randomUUID();
  let revision = 0, generation = 0, last = 'idle', snapshot;
  const shell=new URLSearchParams(window.location.search).get('tvShell')==='1';
  let layout = shell ? 'medium' : 'full';
  const listeners = new Set();
  let audio = Object.freeze({levels: [], source: 'none'}), lastSample = 0, clearTimer;
  let inputLevels=[],outputLevels=[],inputEnvelope=0,outputEnvelope=0,inputEnergy=0,outputEnergy=0,observations=0,wasMuted=false;
  document.documentElement.dataset.tvLayout = layout;
  const validOwner = expected => expected === undefined || Boolean(expected && expected.owner === owner && expected.generation === generation);
  const focusable = () => [...((document.querySelector?.('dialog[open]') ?? (view.get().reading?document.getElementById?.('contentReader'):document))?.querySelectorAll?.('button,a[href],input,select,textarea,[tabindex]') ?? [])].filter(e => {
    const r = e.getBoundingClientRect();
    return !e.disabled && e.tabIndex >= 0 && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth && !e.closest('[inert]');
  });
  const focusPrimary = () => {
    if(view.get().reading){document.getElementById?.('readerBody')?.focus({preventScroll:true});return;}
    const items = focusable();
    (items.find(e => e.hasAttribute('data-tv-primary')) ?? items.find(e => e.id === 'start') ?? items[0])?.focus({preventScroll:true});
  };
  const commitLayout = () => {
    document.documentElement.dataset.tvLayout=layout;
    delete document.documentElement.dataset.tvTransition;
    window.scrollTo?.(0,0);
    view.set({tvLayout:layout});
    window.requestAnimationFrame?.(focusPrimary);
  };
  const setLayout = (value, expected) => {
    if (!validOwner(expected) || !['compact','medium','full'].includes(value)) return false;
    if(value===layout&&view.get().tvLayout===value)return true;
    layout = value;
    if(shell){document.activeElement?.blur?.();document.documentElement.dataset.tvTransition='true';}
    else commitLayout();
    update();
    return true;
  };
  const clearAudio = () => {
    inputLevels=[];outputLevels=[];inputEnvelope=outputEnvelope=inputEnergy=outputEnergy=observations=lastSample=0;
    audio=Object.freeze({levels:[],source:'none'}); for(const listener of listeners)listener();
  };
  const available = state => ({
    dial: state.call === 'idle' && !state.dial.disabled,
    mute: state.call === 'connected',
    end: state.call !== 'idle',
  });
  const api = Object.freeze({
    get snapshot() {
      const element=document.activeElement;
      const focus=element?.getAttribute?.('data-tv-control')??({textToggle:'compose',steerText:'input',steer:'send',readerBack:'reader-back',readerBody:'reader-body',mute:'mute',stop:'end'})[element?.id];
      const state=view.get();
      return Object.freeze({...snapshot,reading:state.reading===true,
        hasDocument:[...(state.transcript.history??[]),...(state.transcript.current??[])].some(row=>row.document===true),
        meter:Object.freeze({source:audio.source,peak:Math.max(0,...audio.levels)}),
        viewport:Object.freeze({width:Math.round(window.innerWidth??0),height:Math.round(window.innerHeight??0)}),
        focus:['dial','end','mute','expand','fold','compact','return','compose','input','send','reader-back','reader-body'].includes(focus)?focus:null});
    },
    // Only this lightweight surface subscribes to the 10 Hz visual meter.
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getAudio() { return audio; },
    setLayout,
    // Native acknowledges only after its WebView has the requested window bounds.
    commitLayout(value,expected,bounds) {
      if(value!==layout||!validOwner(expected))return false;
      // Android density otherwise gives a 1080p TV only ~912 CSS pixels.
      // Full pages use the original desktop layout at a wider CSS viewport;
      // compact/medium windows retain their established island scale.
      if(shell&&Number.isFinite(bounds?.width)&&bounds.width>=100&&bounds.width<=7680) {
        const width=value==='full'?Math.max(1600,bounds.width):bounds.width;
        const scale=value==='full'?bounds.width/width:1;
        const viewport=document.querySelector?.('meta[name="viewport"]');
        const content=`width=${Math.round(width)},initial-scale=${scale},viewport-fit=cover`;
        if(viewport&&viewport.getAttribute('content')!==content)viewport.setAttribute('content',content);
      }
      commitLayout();return true;
    },
    focusPrimary,
    back() {
      const dialog = document.querySelector?.('dialog[open]');
      if (dialog) { dialog.dispatchEvent(new window.Event('cancel', {cancelable:true})); dialog.close(); return 'handled'; }
      if (view.get().reading) { document.getElementById?.('readerBack')?.click(); return 'handled'; }
      if (layout === 'full') { setLayout('medium'); return 'handled'; }
      if (layout === 'medium') { setLayout('compact'); return 'handled'; }
      return 'exit';
    },
    navigate(direction) {
      if (!['up','down','left','right'].includes(direction)) return false;
      if(direction==='right'&&document.activeElement?.id==='steerText') {document.getElementById?.('steer')?.focus({preventScroll:true});return true;}
      if(direction==='left'&&document.activeElement?.id==='steer') {document.getElementById?.('steerText')?.focus({preventScroll:true});return true;}
      if(view.get().reading) {
        const active=document.activeElement,inDock=Boolean(active?.closest?.('#readerDock'));
        const inBody=active?.id==='readerBody'||Boolean(active?.closest?.('#readerBody'));
        if(inBody&&['up','down'].includes(direction)) {
          const body=document.getElementById?.('readerBody');
          if(body){body.scrollBy({top:(direction==='down'?1:-1)*Math.max(120,body.clientHeight*.8),behavior:'smooth'});return true;}
        }
        if(inBody&&direction==='left'){document.getElementById?.('readerBack')?.focus({preventScroll:true});return true;}
        if(direction==='right'&&(inBody||active?.id==='readerDownload')) {
          document.getElementById?.('textToggle')?.focus({preventScroll:true});return true;
        }
        if((direction==='up'&&inDock&&active?.tagName!=='INPUT')||(direction==='down'&&['readerBack','readerDownload'].includes(active?.id))) {
          document.getElementById?.('readerBody')?.focus({preventScroll:true});return true;
        }
      }
      const items=focusable(), active=document.activeElement;
      if (!items.includes(active)) { focusPrimary(); return true; }
      const r=active.getBoundingClientRect(); let best=null,score=Infinity;
      for(const item of items) {
        if(item===active)continue;
        const t=item.getBoundingClientRect(),dx=t.x+t.width/2-r.x-r.width/2,dy=t.y+t.height/2-r.y-r.height/2;
        const forward=direction==='up'?-dy:direction==='down'?dy:direction==='left'?-dx:dx;
        const cross=direction==='up'||direction==='down'?Math.abs(dx):Math.abs(dy);
        if(forward>3&&forward>=cross*.6&&forward+cross*3<score){best=item;score=forward+cross*3;}
      }
      if(best){best.focus({preventScroll:true});if(layout==='full')best.scrollIntoView({block:'nearest'});}
      return true;
    },
    // Measured RMS only; no recordings, provider-arrival envelope or animation generator.
    observeAudio({input=0,output=0,at=Date.now()}={}) {
      if(view.get().call!=='connected')return;
      if(lastSample&&(at-lastSample>350||at<lastSample))clearAudio();
      const safe=value=>Number.isFinite(value)?Math.min(1,Math.max(0,value)):0;
      inputEnergy+=(view.get().muted?0:safe(input))**2;outputEnergy+=safe(output)**2;observations++;
      if(at-lastSample<99)return;
      lastSample=at;
      const follow=(value,previous)=>value>=previous?value:value*.75+previous*.25;
      inputEnvelope=follow(Math.sqrt(inputEnergy/observations),inputEnvelope);
      outputEnvelope=follow(Math.sqrt(outputEnergy/observations),outputEnvelope);
      // Same fixed mapping and short release as IslandPresentation.swift.
      const quantize=rms=>rms>.003?Math.round(Math.min(100,(rms/.24)**.75*100)):0;
      inputLevels=[...inputLevels.slice(-23),quantize(inputEnvelope)];
      outputLevels=[...outputLevels.slice(-23),quantize(outputEnvelope)];
      inputEnergy=outputEnergy=observations=0;
      const recent=values=>values.slice(-2).some(v=>v>0),any=values=>values.some(v=>v>0);
      const source=recent(outputLevels)?'output':!view.get().muted&&recent(inputLevels)?'input':any(outputLevels)?'output':!view.get().muted&&any(inputLevels)?'input':'none';
      audio=Object.freeze({levels:Object.freeze(source==='output'?[...outputLevels]:source==='input'?[...inputLevels]:[]),source});
      for(const listener of listeners)listener();
      clearTimeout(clearTimer);clearTimer=setTimeout(clearAudio,450);clearTimer.unref?.();
    },
    action(name, expected) {
      if (!['dial', 'mute', 'end'].includes(name)) return false;
      if (!validOwner(expected)) return false;
      if (!available(view.get())[name]) return false;
      try {
        // Keep the original user gesture for microphone/playback permission.
        Promise.resolve(actions[name]()).catch(onError);
        return true; // Request accepted; completion is reflected by the shared view.
      } catch (error) { onError(error); return false; }
    },
  });
  const update = () => {
    const state = view.get();
    if (state.call !== 'idle' && last === 'idle') generation++;
    if(state.call!=='connected'&&last==='connected'||state.muted&&!wasMuted)clearAudio();
    wasMuted=state.muted;
    last = state.call;
    const status = resolveStatus(state);
    const label = state.call === 'idle'
      ? state.homeNoteTone === 'error' ? '连接未就绪' : state.dial.disabled ? '正在准备' : '准备通话'
      : state.call === 'dialing' ? '正在连接'
      : state.call === 'ending' ? '正在结束'
      : ['error', 'warn', 'action'].includes(status?.kind) ? status.text
      : state.muted ? '麦克风已静音' : status?.text ?? '通话中';
    snapshot = Object.freeze({version: 1, owner, generation, revision: ++revision, layout,
      call: state.call, muted: state.muted === true, label: String(label).slice(0, 48),
      actions: Object.freeze(available(state))});
  };
  update();
  view.subscribe(update);
  window.vVoiceTV = api;
  view.set({tvHost:true,tvLayout:layout});
  window.addEventListener?.('pagehide',()=>{clearTimeout(clearTimer);listeners.clear();},{once:true});
  return api;
}
