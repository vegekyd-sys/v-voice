// A show owns its silent video transport. Closing it never touches the call's microphone.
export function createImprovPlayer({open, update, ended, keep, notice}) {
  let show = null;
  function finish(message) {
    const old = show;
    if (!old) return;
    show = null;
    clearTimeout(old.timer);
    clearTimeout(old.noteTimer);
    try { old.handle?.send({type:'stop'}); } catch {}
    void old.handle?.close().catch(() => {});
    update(null);
    ended(old.id);
    if (message) notice(message);
  }
  function publish(current, patch) {
    current.view = {...current.view, ...patch};
    update(current.view);
    if (patch.note) {
      clearTimeout(current.noteTimer);
      current.noteTimer = setTimeout(() => { if (show === current) publish(current,{note:''}); },4000);
    }
  }
  function direct(current, shot) {
    if (!current.configured) { current.queued = shot; return; }
    current.handle.send({type:'prompt', prompt_version:++current.version, prompt:shot, replan:true});
    publish(current,{note:'正在调整镜头'});
  }
  async function receive({id, action, shot}) {
    if (action !== 'start') {
      if (id !== show?.id) return;
      if (action === 'end') finish();
      else if (action === 'keep') keep();
      else if (action === 'direct') {
        try { direct(show,shot); } catch { finish('画面连接已中断，通话继续'); }
      }
      return;
    }
    if (show) return;
    const current = show = {id,version:1,view:{id,stream:null,note:''}};
    publish(current,{});
    current.timer = setTimeout(() => { if (show === current) finish('第一幕未能及时开场，通话继续'); },95000);
    try {
      const handle = await open(id,{
        onMedia(stream) { if (show === current) publish(current,{stream}); },
        onData(raw) {
          if (show !== current) return;
          let event; try { event = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
          if (event?.type === 'configured' && !current.configured) {
            current.configured = true;
            clearTimeout(current.timer);
            current.timer = setTimeout(() => { if (show === current) finish('这一场直播结束了'); },120000);
            if (current.queued) { try { direct(current,current.queued); } catch { finish('调整镜头失败'); } }
          } else if (event?.type === 'prompt_rejected' && event.prompt_version === current.version) publish(current,{note:'这个镜头未被采用'});
          else if (event?.type === 'prompt_applied' && event.prompt_version === current.version) publish(current,{note:'新镜头正在生成'});
          else if (event?.type === 'stream_exhausted') finish('这一场直播结束了');
          else if (event?.type === 'error') finish('这场直播暂时无法继续');
        },
        onState(state) { if (show === current && state === 'closed') finish('直播连接已结束'); },
        onError() { if (show === current) finish('直播暂时连不上，通话继续'); }
      });
      void handle.ready.catch(() => { if (show === current) finish('直播暂时连不上，通话继续'); });
      if (show !== current) { await handle.close(); return; }
      current.handle = handle;
      handle.send({type:'configure',protocol_version:1,prompt_version:1,prompt:shot,resolution:'768p',aspect_ratio:'16:9',memory:12});
    } catch { if (show === current) finish('直播暂时连不上，通话继续'); }
  }
  return {receive, finish, keep};
}
