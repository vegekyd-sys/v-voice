import {resolveStatus} from './call-view.mjs';

// A projection of the shared page, never a second call engine or an identity bridge.
// Native hosts may echo owner + generation to reject queued actions from an old page/call.
export function installTvHost({view, window, actions, onError = () => {}}) {
  if (new URLSearchParams(window.location.search).get('tv') !== '1') return null;
  window.document.documentElement.dataset.tv = 'true';
  const owner = window.crypto.randomUUID();
  let revision = 0, generation = 0, last = 'idle', snapshot;
  const available = state => ({
    dial: state.call === 'idle' && !state.dial.disabled,
    mute: state.call === 'connected',
    end: state.call !== 'idle',
  });
  const api = Object.freeze({
    get snapshot() { return snapshot; },
    action(name, expected) {
      if (!['dial', 'mute', 'end'].includes(name)) return false;
      if (expected !== undefined && (!expected || expected.owner !== owner || expected.generation !== generation)) return false;
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
    last = state.call;
    const status = resolveStatus(state);
    const label = state.call === 'idle'
      ? state.homeNoteTone === 'error' ? '连接未就绪' : state.dial.disabled ? '正在准备' : '准备通话'
      : state.call === 'dialing' ? '正在连接'
      : state.call === 'ending' ? '正在结束'
      : ['error', 'warn', 'action'].includes(status?.kind) ? status.text
      : state.muted ? '麦克风已静音' : status?.text ?? '通话中';
    snapshot = Object.freeze({version: 1, owner, generation, revision: ++revision,
      call: state.call, muted: state.muted === true, label: String(label).slice(0, 48),
      actions: Object.freeze(available(state))});
  };
  update();
  view.subscribe(update);
  window.vVoiceTV = api;
  return api;
}
