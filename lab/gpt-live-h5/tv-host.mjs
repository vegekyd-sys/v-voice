import {resolveStatus} from './call-view.mjs';

export function tvDefaultModel(models = []) {
  return {model:'seeduplex', available:models.some(model=>model.id==='seeduplex'&&model.available===true)};
}

// A projection of the shared page, never a second call engine or an identity bridge.
// Native hosts may echo owner + generation to reject queued actions from an old page/call.
export function installTvHost({view, window, actions, onError = () => {}}) {
  if (new URLSearchParams(window.location.search).get('tv') !== '1') return null;
  const document = window.document;
  document.documentElement.dataset.tv = 'true';
  const owner = window.crypto.randomUUID();
  let revision = 0, generation = 0, last = 'idle', snapshot;
  const overlay=new URLSearchParams(window.location.search).get('tvOverlay')==='1';
  if(overlay)document.documentElement.dataset.tvOverlay='true';
  const shell=new URLSearchParams(window.location.search).get('tvShell')==='1';
  let layout = shell ? 'medium' : 'full';
  document.documentElement.dataset.tvPresented=String(!(shell&&new URLSearchParams(window.location.search).get('tvSurface')==='1'));
  const listeners = new Set();
  const launchRequests = new Set();
  let audio = Object.freeze({levels: [], source: 'none'}), lastSample = 0, clearTimer;
  let inputLevels=[],outputLevels=[],inputEnvelope=0,outputEnvelope=0,inputEnergy=0,outputEnergy=0,observations=0,wasMuted=false,wasOutputMuted=false;
  document.documentElement.dataset.tvLayout = layout;
  const validOwner = expected => expected === undefined || Boolean(expected && expected.owner === owner && expected.generation === generation);
  const focusable = () => [...((document.querySelector?.('dialog[open], .board-viewer[aria-modal="true"]') ?? (view.get().reading?document.getElementById?.('contentReader'):document))?.querySelectorAll?.('button,a[href],input,select,textarea,[tabindex]') ?? [])].filter(e => {
    const r = e.getBoundingClientRect();
    return !e.disabled && e.tabIndex >= 0 && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth && !e.closest('[inert], .board-page[aria-hidden="true"]') && visibleInBoard(e, r);
  });
  function visibleInBoard(element, rect) {
    const region = element.closest('.board-scroll');
    if (!region || region === element) return true;
    const frame = region.getBoundingClientRect();
    return rect.bottom > frame.top && rect.top < frame.bottom && rect.right > frame.left && rect.left < frame.right;
  }
  function nearest(active, items, direction) {
    const r = active.getBoundingClientRect();
    let best = null, score = Infinity;
    for (const item of items) {
      if (item === active) continue;
      const t = item.getBoundingClientRect();
      const dx = t.x + t.width / 2 - r.x - r.width / 2, dy = t.y + t.height / 2 - r.y - r.height / 2;
      const forward = direction === 'up' ? -dy : direction === 'down' ? dy : direction === 'left' ? -dx : dx;
      const cross = direction === 'up' || direction === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (forward > 3 && forward >= cross * .6 && forward + cross * 3 < score) {
        best = item;
        score = forward + cross * 3;
      }
    }
    return best;
  }
  // In the small overlay Android keeps key focus on the native surface. The
  // WebView remembers the selected button, but does not always paint :focus.
  let markedDockButton;
  const focus = item => {
    item?.focus({preventScroll:true});
    markedDockButton?.removeAttribute('data-remote-focus');
    markedDockButton = layout === 'medium' && item?.closest?.('.tv-dock-actions') ? item : null;
    markedDockButton?.setAttribute('data-remote-focus', '');
    return true;
  };
  const focusPrimary = () => {
    if(view.get().reading){document.getElementById?.('readerBody')?.focus({preventScroll:true});return;}
    const items = focusable();
    focus(items.find(e => e.hasAttribute('data-tv-primary')) ?? items.find(e => e.id === 'start') ?? items[0]);
  };
  const commitLayout = () => {
    document.documentElement.dataset.tvLayout=layout;
    delete document.documentElement.dataset.tvTransition;
    window.scrollTo?.(0,0);
    view.set({tvLayout:layout});
    window.requestAnimationFrame?.(() => {
      if (!focusable().includes(document.activeElement)) focusPrimary();
    });
  };
  let hostBounds, companionBounds, enteringAvatar, flight, avatarAnimation, landing;
  const avatar = () => document.querySelector?.('.call-page .avatar');
  function finishFlight() {
    avatarAnimation?.cancel();
    avatarAnimation = null;
    flight?.remove();
    flight = null;
    delete document.documentElement.dataset.tvEntering;
  }
  const setLayout = (value, expected) => {
    if (!validOwner(expected) || !['compact','medium','full'].includes(value)) return false;
    // The call UI requests compact as soon as it sees idle. Keep the full native
    // surface until the on-screen portrait reaches the desktop, including on a slow TV.
    if(value==='compact'&&landing&&document.documentElement.dataset.tvLanding==='moving')return true;
    if(value===layout&&view.get().tvLayout===value)return true;
    finishFlight();
    enteringAvatar = null;
    if (overlay && shell && value === 'full' && hostBounds && layout !== 'full') {
      const rect = avatar()?.getBoundingClientRect();
      if (rect?.width && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        const toScreen = hostBounds.width / window.innerWidth;
        enteringAvatar = {x:hostBounds.x+rect.left*toScreen, y:hostBounds.y+rect.top*toScreen,
          size:rect.width*toScreen, windowWidth:hostBounds.width};
        const image=document.getElementById?.('avatar');
        if (!window.VTVPortrait&&image?.naturalWidth) {
          const ghost=document.createElement('canvas');
          ghost.width=ghost.height=Math.min(512,image.naturalWidth);
          try {
            ghost.getContext('2d').drawImage(image,0,0,ghost.width,ghost.height);
            ghost.className='tv-landing-portrait';
            ghost.setAttribute('aria-hidden','true');
            Object.assign(ghost.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.width+'px'});
            document.body.appendChild(ghost);
            flight=ghost;
            document.documentElement.dataset.tvEntering='true';
          } catch { ghost.remove(); }
        }
      }
    }
    layout = value;
    if(shell&&!overlay){document.activeElement?.blur?.();document.documentElement.dataset.tvTransition='true';}
    else if (!enteringAvatar) commitLayout();
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
    speaker: state.call === 'connected',
    end: state.call !== 'idle',
  });
  const api = Object.freeze({
    primeDial(requestId){
      if(!/^launch-[a-zA-Z0-9-]{8,64}$/.test(requestId)||view.get().call!=='idle'||!available(view.get()).dial)return false;
      return actions.primeDial?.(requestId)===true;
    },
    requestDial(requestId, expected) {
      if(typeof requestId!=='string'||!/^launch-[a-zA-Z0-9-]{8,64}$/.test(requestId)||!validOwner(expected))return false;
      if(launchRequests.has(requestId))return true;
      if(view.get().call!=='idle'){launchRequests.add(requestId);if(launchRequests.size>128)launchRequests.delete(launchRequests.values().next().value);return true;}
      if(!available(view.get()).dial)return false;
      launchRequests.add(requestId);
      if(launchRequests.size>128)launchRequests.delete(launchRequests.values().next().value);
      if(actions.dialFromHome){Promise.resolve(actions.dialFromHome(requestId)).catch(onError);return true;}
      return api.action('dial',expected);
    },
    get snapshot() {
      const element=document.activeElement;
      const focus=element?.getAttribute?.('data-tv-control')??({textToggle:'compose',steerText:'input',steer:'send',readerBack:'reader-back',readerBody:'reader-body',mute:'mute',stop:'end'})[element?.id];
      const state=view.get();
      const mic=window.__gptLiveDuplexDiagnostics?.microphone;
      return Object.freeze({...snapshot,portraitOrigin:enteringAvatar??null,landing:document.documentElement.dataset.tvLanding==='moving',reading:state.reading===true,
        microphone:Object.freeze({driver:state.call==='idle'?'none':mic?.kind==='tv-array-microphone'?'tv-array':'browser',
          channels:mic?.kind==='tv-array-microphone'&&[4,6].includes(mic.channels)?mic.channels:null,
          acousticEchoTestPassed:false}),
        failureCode:/^[A-Z0-9_]{1,64}$/.test(state.failureCode??'')?state.failureCode:null,
        hasDocument:[...(state.transcript.history??[]),...(state.transcript.current??[])].some(row=>row.document===true),
        meter:Object.freeze({source:audio.source,peak:Math.max(0,...audio.levels)}),
        viewport:Object.freeze({width:Math.round(window.innerWidth??0),height:Math.round(window.innerHeight??0)}),
        focus:['dial','end','mute','speaker','expand','fold','compact','return','compose','input','send','reader-back','reader-body'].includes(focus)?focus:null});
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
      if (enteringAvatar && bounds?.width === enteringAvatar.windowWidth) return false;
      if (Number.isFinite(bounds?.x) && Number.isFinite(bounds?.y)) {
        hostBounds = bounds;
        if(value!=='full') companionBounds = bounds;
      }
      if(value==='compact' && landing){landing.remove();landing=null;delete document.documentElement.dataset.tvLanding;}
      if(shell&&Number.isFinite(bounds?.width)&&bounds.width>=48&&bounds.width<=7680) {
        const width=value==='full'?Math.max(1200,bounds.width):bounds.width;
        const scale=value==='full'?bounds.width/width:1;
        const viewport=document.querySelector?.('meta[name="viewport"]');
        const content=`width=${Math.round(width)},initial-scale=${scale},viewport-fit=cover`;
        if(viewport&&viewport.getAttribute('content')!==content)viewport.setAttribute('content',content);
      }
      const from = enteringAvatar;
      if(from&&window.VTVPortrait)document.documentElement.dataset.tvEntering='true';
      enteringAvatar = null;
      commitLayout();
      if (from && bounds) {
        const ghost=flight;
        const expectedWidth=Math.max(1200,bounds.width);
        function start(width) {
          const scale=width/bounds.width;
          return {x:(from.x-bounds.x)*scale,y:(from.y-bounds.y)*scale,size:from.size*scale};
        }
        if(ghost){
          const origin=start(expectedWidth);
          Object.assign(ghost.style,{left:origin.x+'px',top:origin.y+'px',width:origin.size+'px',height:origin.size+'px'});
        }
        let frames=0;
        const animate=()=>{
          if(layout!=='full'||flight!==ghost)return;
          // The meta viewport and the React layout commit on different compositor frames.
          if(++frames<3 || (Math.abs(window.innerWidth-expectedWidth)>2 && frames<12)){
            window.requestAnimationFrame(animate);return;
          }
          const face=avatar(), rect=face?.getBoundingClientRect();
          if(!rect?.width||!face.animate){finishFlight();return;}
          if(window.VTVPortrait){
            window.VTVPortrait.move(rect.left/window.innerWidth,rect.top/window.innerWidth,rect.width/window.innerWidth);
            // An older native window can already have collapsed before its callback.
            window.setTimeout(()=>{if(layout==='full'&&document.documentElement.dataset.tvEntering)finishFlight();},3000);
            return;
          }
          const origin=start(window.innerWidth);
          const translate=(x,y,scale)=>`translate3d(${x}px,${y}px,0) scale(${scale})`;
          const frameset=ghost ? [
            {transform:'none'},{transform:translate(rect.left-origin.x,rect.top-origin.y,rect.width/origin.size)},
          ] : [
            {transformOrigin:'0 0',transform:translate(origin.x-rect.left,origin.y-rect.top,origin.size/rect.width)},
            {transformOrigin:'0 0',transform:'none'},
          ];
          avatarAnimation=(ghost??face).animate(frameset,{duration:380,easing:'cubic-bezier(.32,0,.2,1)',fill:'both'});
          if(ghost)avatarAnimation.finished.then(()=>{if(flight===ghost)finishFlight();},()=>{});
          document.querySelector?.('.chat-panel')?.animate?.([{opacity:0},{opacity:1}],{duration:270});
        };
        window.requestAnimationFrame?.(animate);
      }
      return true;
    },
    landPortrait() {
      if (!overlay || layout!=='full' || !companionBounds || !hostBounds || landing ||
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      finishFlight();
      const rect=avatar()?.getBoundingClientRect(),picture=document.getElementById('avatar');
      if(!rect?.width || !picture?.animate) return;
      // Keep only the current portrait while the call releases its media and the board unmounts.
      const ghost=document.createElement('canvas');
      ghost.className='tv-landing-portrait';ghost.setAttribute('aria-hidden','true');
      // Keep the decoded frame that is actually on screen. Reopening an animated WebP
      // here can leave the overlay empty while the desktop already shows through.
      const pixels=Math.min(512,Math.ceil(rect.width*(window.devicePixelRatio||1)));
      ghost.width=ghost.height=pixels;
      try{ghost.getContext('2d').drawImage(picture,0,0,pixels,pixels);}catch{return;}
      Object.assign(ghost.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
      document.body.appendChild(ghost);landing=ghost;
      document.documentElement.dataset.tvLanding='moving';
      const scale=window.innerWidth/hostBounds.width;
      const x=(companionBounds.x+companionBounds.width-80-hostBounds.x)*scale-rect.left;
      const y=(companionBounds.y+30-hostBounds.y)*scale-rect.top;
      const target=`translate3d(${x}px,${y}px,0) scale(${64*scale/rect.width})`;
      const finish=()=>{if(landing===ghost){ghost.style.transform=target;document.documentElement.dataset.tvLanding='arrived';setLayout('compact');}};
      // Let Chromium composite the starting circle before releasing the layer to its animator.
      window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>{
        if(landing!==ghost||document.documentElement.dataset.tvLanding!=='moving')return;
        const motion=ghost.animate([{transform:'translate3d(0,0,0) scale(1)'},{transform:target}],
          {duration:440,easing:'cubic-bezier(.35,0,.2,1)',fill:'forwards'});
        motion.finished.then(finish,finish);
      }));
      window.setTimeout(finish,1100);
    },
    finishEnter:finishFlight,
    focusPrimary,
    passiveFocus(focused){if(overlay)document.documentElement.dataset.tvPassiveFocused=String(focused===true);},
    reveal(){if(overlay)document.documentElement.dataset.tvRevealed='true';return true;},
    present(expected) {
      if(!validOwner(expected))return false;
      document.documentElement.dataset.tvPresented='true';
      // Home has already expanded its local portrait at the initial click.
      // Paint the matching large frame before handing ownership to this page.
      if(overlay&&layout==='medium')document.documentElement.dataset.tvRevealed='true';
      return true;
    },
    back() {
      const dialog = document.querySelector?.('dialog[open]');
      if (dialog) { dialog.dispatchEvent(new window.Event('cancel', {cancelable:true})); dialog.close(); return 'handled'; }
      const viewerClose = document.querySelector?.('.board-viewer .board-enlarged-close');
      if (viewerClose) { viewerClose.click(); return 'handled'; }
      if (view.get().reading) { document.getElementById?.('readerBack')?.click(); return 'handled'; }
      if (shell && view.get().call === 'idle' && layout !== 'full') return 'exit';
      if (layout === 'full') { setLayout(overlay ? 'compact' : 'medium'); return 'handled'; }
      if (layout === 'medium') { setLayout('compact'); return 'handled'; }
      return 'exit';
    },
    navigate(direction) {
      if (!['up','down','left','right'].includes(direction)) return false;
      // The compact window is still an Activity. Explicitly hand idle navigation
      // back to Home; consuming it here traps the remote on a dead portrait.
      if(shell&&view.get().call==='idle'&&layout!=='full')return 'exit';
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
      const active = document.activeElement;
      const items = focusable();
      const region = layout === 'full' && !view.get().reading
        ? items.find(item => item.matches?.('.board-page[data-current] .board-scroll'))
        : null;
      // The full TV has a lesson column and a call column. Cross at the reading
      // surfaces, even when the nearest button by distance is on another row.
      const board = region?.closest('.board');
      const inBoard = board?.contains(active);
      const chat = items.find(item => item.matches?.('.turns[role="log"]'));
      if (region) {
        if (active?.matches?.('.tv-return') && direction === 'down') return focus(region);
        if (active?.closest?.('.board-top') && direction === 'down') return focus(region);
        const pager = active?.closest?.('.board-dots');
        if (pager) {
          if (direction === 'up') return focus(region);
          const adjacent = direction === 'left' ? active.previousElementSibling
            : direction === 'right' ? active.nextElementSibling ?? chat : null;
          return adjacent ? focus(adjacent) : true;
        }
        if (active === region && direction === 'left') {
          const currentPage = items.find(item => item.matches?.('.board-dots [aria-current="page"]'));
          if (currentPage) return focus(currentPage);
        }
        if (active === region && direction === 'right' && chat) return focus(chat);
        if (active === chat && direction === 'left') return focus(region);
      }
      const scroller = region?.contains(active) ? region : active;
      if (region && scroller === region && active !== region) {
        const sibling = nearest(active, items.filter(item => item !== region && region.contains(item)), direction);
        if (sibling) return focus(sibling);
        if (direction === 'right' && chat) return focus(chat);
      }
      if (scroller?.matches?.('.turns[role="log"], .board-scroll') && ['up','down'].includes(direction)) {
        const down = direction === 'down';
        if (down ? scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1 : scroller.scrollTop > 1) {
          if (region && scroller === region) focus(region);
          scroller.scrollBy({top: (down ? 1 : -1) * scroller.clientHeight * .8, behavior: 'instant'});
          return true;
        }
      }
      if (region && scroller === region && (direction === 'up' || direction === 'down')) {
        const edge = direction === 'up' ? items.find(item => item.closest('.board-top'))
          : items.find(item => item.matches?.('.board-dots [aria-current="page"]')) ?? chat;
        if (edge) return focus(edge);
      }
      if (!items.includes(active)) { focusPrimary(); return true; }
      const best = nearest(active, items, direction);
      if (region && !inBoard && direction === 'left' && (!best || board.contains(best))) return focus(region);
      if(!best&&overlay&&layout==='medium')return 'exit';
      if(best){focus(best);if(layout==='full')best.scrollIntoView({block:'nearest'});}
      return true;
    },
    // Measured RMS only; no recordings, provider-arrival envelope or animation generator.
    observeAudio({input=0,output=0,at=Date.now()}={}) {
      if(view.get().call!=='connected')return;
      if(lastSample&&(at-lastSample>350||at<lastSample))clearAudio();
      const safe=value=>Number.isFinite(value)?Math.min(1,Math.max(0,value)):0;
      inputEnergy+=(view.get().muted?0:safe(input))**2;outputEnergy+=(view.get().outputMuted?0:safe(output))**2;observations++;
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
      if (!['dial', 'mute', 'speaker', 'end'].includes(name)) return false;
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
    if(state.call!=='connected'&&last==='connected'||state.muted&&!wasMuted||state.outputMuted!==wasOutputMuted)clearAudio();
    wasMuted=state.muted;wasOutputMuted=state.outputMuted;
    last = state.call;
    const status = resolveStatus(state);
    const label = state.call === 'idle'
      ? state.homeNoteTone === 'error' ? state.homeNote : state.dial.disabled ? '正在准备' : '准备通话'
      : state.call === 'dialing' ? '正在连接'
      : state.call === 'ending' ? '正在结束'
      : ['error', 'warn', 'action'].includes(status?.kind) ? status.text
      : state.muted ? '麦克风已静音' : status?.text ?? '通话中';
    snapshot = Object.freeze({version: 1, owner, generation, revision: ++revision, layout,
      call: state.call, model:state.model??null, muted: state.muted === true, outputMuted:state.outputMuted===true, label: String(label).slice(0, 48),
      actions: Object.freeze(available(state))});
  };
  update();
  view.subscribe(update);
  window.vVoiceTV = api;
  view.set({tvHost:true,tvLayout:layout});
  window.addEventListener?.('pagehide',()=>{clearTimeout(clearTimer);listeners.clear();},{once:true});
  return api;
}
