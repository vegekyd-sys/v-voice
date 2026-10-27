import {connectFeishuClient} from './feishu-client-login.mjs';
// DOM-visible diagnostics let a read-only browser inspector observe timings.
// Only stage names and milliseconds are included; no speech or call identity.
const visibleTimingStages = new Set([
  'voice.entry.start', 'voice.entry.failed', 'voice.status.start',
  'voice.status.inline', 'voice.status.complete', 'voice.dial.ready',
  'voice.dial.requested', 'voice.microphone.ready', 'voice.reservation.ready',
  'voice.connection.ready',
]);
export function publishVoiceTiming() {
  if (typeof document === 'undefined' || typeof performance === 'undefined') return;
  const nav = performance.getEntriesByType?.('navigation')[0];
  const fcp = performance.getEntriesByName?.('first-contentful-paint')[0];
  const marks = (performance.getEntriesByType?.('mark') ?? [])
    .filter(entry => visibleTimingStages.has(entry.name))
    .map(entry => ({ name: entry.name, ms: Math.round(entry.startTime * 10) / 10 }));
  document.documentElement.dataset.voiceTiming = JSON.stringify({
    ttfbMs: nav ? Math.round(nav.responseStart * 10) / 10 : null,
    fcpMs: fcp ? Math.round(fcp.startTime * 10) / 10 : null, marks,
  });
  try {
    const profile=JSON.parse(window.sessionStorage.getItem('voice-entry-profile')??'null');
    if(profile&&Date.now()-profile.startedAt<120000){
      const ready=marks.find(m=>m.name==='voice.dial.ready');
      document.documentElement.dataset.voiceLoginTiming=JSON.stringify({...profile,...(ready?{totalToDialMs:Math.round(performance.timeOrigin+ready.ms-profile.startedAt)}:{})});
      if(ready){
        window.sessionStorage.removeItem('voice-entry-profile');
        const stages=profile.stages.map(({name,ms})=>({name,ms}));
        const server={};
        for(const part of (profile.stages.find(s=>s.name==='identity.confirmed')?.serverTiming??'').split(',')){
          const match=/^\s*(app_token|code_exchange|user_info|conversation);dur=([0-9.]+)\s*$/u.exec(part);
          if(match)server[match[1]]=Number(match[2]);
        }
        // Aggregate timing only. Never send codes, identities, URLs or content.
        void fetch('./api/entry-timing',{method:'POST',headers:{'content-type':'application/json'},keepalive:true,
          body:JSON.stringify({outcome:profile.outcome,totalToDialMs:Math.round(performance.timeOrigin+ready.ms-profile.startedAt),stages,server})}).catch(()=>{});
      }
    }
  } catch {}
}
export function markVoiceTiming(name) {
  performance.mark?.(name);
  publishVoiceTiming();
}
const timingObserverKey=Symbol.for('v-voice.entry-paint-observer');
if (typeof window !== 'undefined' && window.document && window.PerformanceObserver && !window[timingObserverKey]) {
  window[timingObserverKey]=true;
  const observer = new window.PerformanceObserver(() => publishVoiceTiming());
  observer.observe({ type: 'paint', buffered: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}

// Start the existing entry authorization/status request independently of the
// audio, avatar and Markdown module graph. No microphone or call is started.
export function startVoiceEntry({ location, fetch: request, replaceState, initialStatus, identity, mark = () => {} }) {
  return (async () => {
    try {
      mark('voice.entry.start');
      const phone = new URLSearchParams(location.search).get('phone');
      const query = phone ? `phone=${encodeURIComponent(phone)}` : 'entry=tianyi';
      const access = new URLSearchParams(location.hash.slice(1)).get('access');
      if (access) {
        const response = await request(`./api/access?${query}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          credentials: 'same-origin', body: JSON.stringify({ access }),
        });
        const value = await response.json();
        if (!response.ok) throw Object.assign(new Error(value.error ?? '暂时无法连接 V，请稍后重试。'),{publicHref:value.publicHref});
        const search = new URLSearchParams(location.search);
        if (!phone) search.set('entry', 'tianyi');
        replaceState(`${location.pathname}?${search}`);
      }
      if(identity){const verified=await identity;if(verified)initialStatus=verified;}
      mark('voice.status.start');
      if (!access && initialStatus && typeof initialStatus.ready === 'boolean') {
        mark('voice.status.inline');
        mark('voice.status.complete');
        return { status: initialStatus };
      }
      const response = await request(`./api/status?${query}`);
      const status = await response.json();
      if (!response.ok) throw Object.assign(new Error(status.error ?? '暂时无法连接 V，请稍后重试。'),{publicHref:status.publicHref});
      mark('voice.status.complete');
      return { status };
    } catch (error) {
      // Resolve failure as data: the main module can be late or unavailable,
      // and a standalone preload must never leave an unhandled rejection.
      mark('voice.entry.failed');
      return { error: error.message ?? '暂时无法连接 V，请稍后重试。',...(typeof error.publicHref==='string'?{publicHref:error.publicHref}:{}) };
    }
  })();
}

function initialEntryStatus() {
  try { return JSON.parse(window.document.getElementById('voiceEntryStatus')?.textContent ?? 'null'); }
  catch { return null; }
}

function entryIdentity() {
  try {
    const element=window.document.getElementById('login-config');
    return element?connectFeishuClient({config:JSON.parse(element.textContent),window,document:window.document}).ready:null;
  } catch {return null;}
}

export const entryStartup = typeof window !== 'undefined' && window.document
  ? window[Symbol.for('v-voice.entry-startup')] ??= startVoiceEntry({ initialStatus: initialEntryStatus(), identity:entryIdentity(), location: window.location, fetch: (...args) => fetch(...args),
    replaceState: url => window.history.replaceState(null, '', url),
    mark: markVoiceTiming })
  : null;
