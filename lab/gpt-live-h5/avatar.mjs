import { avatarPicture } from './avatar-catalog.mjs';
import { AVATAR_POSES, AVATAR_SEQUENCES, HOME_AVATAR_FILE } from './avatar-state.mjs';

export const MAX_REACTION_DWELL_MS = 5000;
export const THINKING_POSE_DWELL_MS = MAX_REACTION_DWELL_MS;

// Decode before swapping; old/failed downloads never resurrect retired tasks.
export function createAvatarRenderer({ image, previous, load, reducedMotion = () => false, onPose = () => {} }) {
  let version = 0, desired = null, closed = false, fade = null;
  return {
    async show(pose, frame = 0, evidence = {}) {
      const file = AVATAR_SEQUENCES[pose]?.[frame];
      if (closed || !file || desired === file) return;
      desired = file;
      const request = ++version;
      let src;
      try { src = await load(file); } catch { src = null; }
      if (closed || request !== version) return;
      if (!src) { desired = null; return; }
      fade?.cancel(); fade = null;
      if (previous && !reducedMotion() && image.getAttribute('src') !== src && typeof previous.animate === 'function') {
        previous.src = image.src; previous.hidden = false;
        image.src = src;
        const current = fade = previous.animate([{opacity:1},{opacity:0}], {duration:280,easing:'ease-out'});
        current.onfinish = () => { if (fade === current) { previous.hidden = true; fade = null; } };
      } else { image.src = src; if (previous) previous.hidden = true; }
      onPose(pose, frame, evidence);
    },
    dispose() { closed = true; ++version; fade?.cancel(); if (previous) previous.hidden = true; },
  };
}

export function mountAvatar(document, window, {onDisplayed=()=>{},owner=()=>null} = {}) {
  const small = window.matchMedia('(max-width: 900px)').matches || window.navigator.connection?.saveData;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cache = new Map(), decoded = new Set();
  const load = file => {
    // The first-screen hero needs Retina detail; reactions keep their existing
    // lightweight mobile/desktop sizes and their existing download schedule.
    const url = './assets/' + (file === AVATAR_POSES.idle ? HOME_AVATAR_FILE : small ? file.replace('-512.webp','-256.webp') : file);
    if (!cache.has(url)) cache.set(url, new Promise(resolve => {
      const preload = new window.Image();
      preload.onload = async () => { try { await preload.decode?.(); decoded.add(file); resolve(url); } catch { cache.delete(url); resolve(null); } };
      preload.onerror = () => { cache.delete(url); resolve(null); };
      preload.src = url;
    }));
    return cache.get(url);
  };
  let anchor = null, displayed = null, task = 'idle', disposed = false;
  let timer, deadline, transitionTimer, approved=[], lastPictureAt = -Infinity, recent = [], phase = 0, fallback = 'listen-5', anchorRevision=null;
  const connected = () => ['connected','ending'].includes(document.body.dataset.callState);
  const fileFor = id => { const p=avatarPicture(id);return p && AVATAR_SEQUENCES[p.scene][p.frame]; };
  const clearTimers = () => {clearTimeout(timer);clearTimeout(deadline);};
  const chooseVariation = () => {
    // Only the Decision's current-context continuations may extend a reaction.
    // There is no implicit exploration/work family that can introduce a globe.
    const ids=approved.filter(id=>id!==displayed?.id);
    const fresh=ids.filter(id=>!recent.slice(-2).includes(id));
    return fresh[0]??ids[0]??(displayed?.id==='listen-5'?'listen-3':'listen-5');
  };
  const show = (id,source='state',revision=null) => {const p=avatarPicture(id);if(p&&!disposed&&!document.hidden)void renderer.show(p.scene,p.frame,{source,revision});};
  const schedule = () => {
    clearTimers();if(disposed||document.hidden||!connected()||!displayed)return;
    const next=chooseVariation();void load(fileFor(next));
    // Preload one compatible neighbor. Start the swap early enough to decode;
    // if its download stalls, use an already decoded calm listening portrait.
    const remaining=Math.max(0,MAX_REACTION_DWELL_MS-(Date.now()-lastPictureAt));
    const dwell=4400+[0,-200,100][phase%3];
    timer=setTimeout(()=>show(next,approved.includes(next)?'continuation':'neutral_fallback'),Math.max(0,Math.min(remaining-500,dwell-(Date.now()-lastPictureAt))));
    deadline=setTimeout(()=>{
      if(Date.now()-lastPictureAt<MAX_REACTION_DWELL_MS)return;
      const neutral=displayed?.id==='listen-5'?'listen-3':'listen-5';
      if(decoded.has(fileFor(neutral)))show(neutral,'asset_fallback');
    },remaining);
  };
  const reportVisible = (id,evidence={}) => {
    if(typeof window.requestAnimationFrame!=='function')return;
    const ownOwner=owner();
    window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>{
      const image=document.getElementById('avatar'),box=image.getBoundingClientRect();
      const expected=fileFor(id)?.replace('-512.webp',small?'-256.webp':'-512.webp');
      if(disposed||owner()!==ownOwner||document.hidden||!connected()||displayed?.id!==id||!image.complete||!image.naturalWidth
        ||!expected||!(image.currentSrc||image.src).endsWith('/'+expected)
        ||box.width<=0||box.height<=0||box.bottom<=0||box.right<=0||box.top>=window.innerHeight||box.left>=window.innerWidth)return;
      try{onDisplayed({clientAt:Date.now(),picture:id,anchor:anchor?.id??null,source:evidence.source??'state',revision:evidence.revision??anchorRevision});}catch{}
    }));
  };
  const renderer = createAvatarRenderer({image:document.getElementById('avatar'),previous:document.getElementById('avatarPrevious'),load,
    reducedMotion:reduced,onPose:(pose,frame,evidence)=>{
      document.body.dataset.avatarPose=pose;
      displayed=avatarPicture(pose==='idle'?'idle':`${pose}-${frame}`);lastPictureAt=Date.now();
      recent.push(displayed.id);recent=recent.slice(-4);phase++;
      document.getElementById('avatar').alt=displayed.label;
      document.body.dataset.avatarReaction=displayed.id;
      const trace=JSON.parse(document.body.dataset.avatarImageTimeline??'[]');
      trace.push({at:lastPictureAt,picture:displayed.id,anchor:anchor?.id??null,...evidence});
      document.body.dataset.avatarImageTimeline=JSON.stringify(trace.slice(-120));
      reportVisible(displayed.id,evidence);
      schedule();
    }});
  const render = () => {
    clearTimers();if(disposed)return;
    if(!connected()){
      anchor=null;anchorRevision=null;approved=[];clearTimeout(transitionTimer);recent=[];delete document.body.dataset.avatarAttention;
      delete document.body.dataset.avatarReaction;show('idle');return;
    }
    // Tiny neutral safety pair, not a download of the entire gallery.
    void load(fileFor('listen-5'));void load(fileFor('listen-3'));
    if(!displayed||displayed.id==='idle')show(anchor?.id??fallback);
    else schedule();
  };
  const observer = new window.MutationObserver(render);
  observer.observe(document.body,{attributes:true,attributeFilter:['data-call-state']});
  const visibility=()=>{render();if(!document.hidden&&displayed)reportVisible(displayed.id,{source:'visibility'});};
  document.addEventListener('visibilitychange',visibility);
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  motion.addEventListener?.('change',render);
  const dispose = () => {disposed=true;clearTimers();clearTimeout(transitionTimer);observer.disconnect();document.removeEventListener('visibilitychange',visibility);motion.removeEventListener?.('change',render);renderer.dispose();};
  window.addEventListener('pagehide',dispose,{once:true});
  render();
  return {
    context(){return {currentPicture:displayed?.id??null,reactionPicture:anchor?.id??displayed?.id??null};},
    select(value){
      const id=typeof value==='string'?value:value?.picture,picture=avatarPicture(id);
      if(!picture||picture.id==='idle'||disposed||!connected())return;
      delete document.body.dataset.avatarAttention;
      const continuations=Array.isArray(value?.continuations)?value.continuations.filter(id=>avatarPicture(id)&&id!=='idle'):[];
      approved=[...new Set([picture.id,...continuations])];
      // Same-meaning captions cannot restart a frame's five-second deadline.
      if(anchor?.id===picture.id){schedule();return;}
      clearTimeout(transitionTimer);
      const apply=()=>{anchor=picture;anchorRevision=value?.revision??null;show(id,'decision',typeof value==='object'?value.revision??null:null);};
      // A spoken reply's start/end shouldn't erase the user's reaction after
      // a few hundred ms. New user meaning always takes priority immediately.
      const delay=value?.beat?.startsWith('assistant')?Math.max(0,1600-(Date.now()-lastPictureAt)):0;
      if(delay)transitionTimer=setTimeout(apply,delay);else apply();
    },
    attend(){
      if(disposed||!connected())return;
      clearTimeout(transitionTimer);anchor=null;anchorRevision=null;approved=[];
      document.body.dataset.avatarAttention='user';
      fallback='listen-5';show('listen-5','attention');
    },
    show(activity){
      const next=Object.hasOwn(AVATAR_POSES,activity)?activity:'idle';
      if(next===task)return;task=next;fallback=task==='idle'?'listen-5':`${task}-0`;
      // Real work supplies a fallback until a contextual reaction arrives;
      // it cannot erase an empathic response to the person speaking.
      if(!anchor&&connected())show(fallback);
    },
    expression(value){
      if(!anchor&&connected()&&['focused','curious','bright','calm'].includes(value))show(value==='curious'?'listen-1':'listen-5');
    },dispose,
  };
}
