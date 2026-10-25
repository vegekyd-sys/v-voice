// The phone-first call page. V is the subject: a large portrait whose light
// shows speaking, listening and thinking; one short status line; and the
// current turn of the conversation below it. All state comes from call-view.mjs.
import React, {memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal, flushSync} from 'react-dom';
import {clock, resolveStatus, splitTurns} from '../call-view.mjs';

const Icon = ({d, children}) => <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{d ? <path d={d} /> : children}</svg>;
const PHONE = 'm8.5 3.5 2.1 4.4-2.3 2.3a15.5 15.5 0 0 0 5.5 5.5l2.3-2.3 4.4 2.1v3a2 2 0 0 1-2.2 2C10.4 20 4 13.6 3.5 5.7a2 2 0 0 1 2-2.2h3Z';
const HANG = 'M3 11.8c5.1-4.4 12.9-4.4 18 0v3.7l-4.5.5-.7-3.2a12.3 12.3 0 0 0-7.6 0l-.7 3.2-4.5-.5v-3.7Z';
const SPARK = 'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1';
const ACTIVITY_ICON = {
  web: <Icon><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></Icon>,
  memory: <Icon d="M12 4.5c-1.6-1.4-4.4-1.2-5.6.7-1.7.2-2.9 1.9-2.4 3.6-1.2 1.2-1.1 3.3.3 4.3-.3 1.9 1.3 3.6 3.2 3.4.9 1.7 3.1 2.3 4.5 1.2m0-13.2c1.6-1.4 4.4-1.2 5.6.7 1.7.2 2.9 1.9 2.4 3.6 1.2 1.2 1.1 3.3-.3 4.3.3 1.9-1.3 3.6-3.2 3.4-.9 1.7-3.1 2.3-4.5 1.2m0-13.2v13.2" />,
  calendar: <Icon><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M8 3v4m8-4v4M3.5 10h17" /></Icon>,
  background: <Icon d={SPARK} />,
};
const ACTIVITY_NAME = {memory: '查记忆', web: '查资料', calendar: '查日程', background: '后台处理'};

function useView(view) {
  return useSyncExternalStore(view.subscribe, view.get, view.get);
}
function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
function useViewport() {
  const read = () => ({width: window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight});
  const [size, setSize] = useState(read);
  useEffect(() => {
    // iOS keeps 100dvh when the keyboard opens; size the page to what is
    // actually visible so the text field and call controls stay above it.
    const update = () => {
      const next = read();
      document.documentElement.style.setProperty('--voice-height', next.height + 'px');
      setSize(next);
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => { window.visualViewport?.removeEventListener('resize', update); window.removeEventListener('resize', update); };
  }, []);
  return size;
}

// avatar.mjs owns these image elements (decode-before-swap, display reports).
// They render once and React never touches their attributes again.
const Portrait = memo(function Portrait() {
  return (
    <div id="portrait" className="portrait">
      <img id="avatar" width="1024" height="1024" decoding="async" fetchPriority="high" src="./assets/v-operator-home-1024.webp" alt="V" />
      <img id="avatarPrevious" alt="" hidden />
    </div>
  );
});

function Avatar({onTap, tone, label}) {
  return (
    <div className="avatar" data-tone={tone ?? undefined} onClick={onTap} role={onTap ? 'button' : undefined}
      aria-label={label} tabIndex={onTap ? 0 : undefined}
      onKeyDown={onTap ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onTap(); } } : undefined}>
      <span className="avatar-aura" aria-hidden="true" />
      <div className="avatar-face"><Portrait /></div>
    </div>
  );
}

function StatusLine({status, onTask, actions}) {
  if (!status) return <div className="status" aria-hidden="true" />;
  const who = status.who;
  const content = (
    <>
      {status.spinner && <span className="status-spinner" aria-hidden="true" />}
      <span className="status-text">{status.text}{who && <> <b className="status-who" data-tone={who.tone}>{who.label}</b></>}</span>
      {status.time && <span className="status-time">{status.time}</span>}
      {status.tappable && <span className="status-chevron" aria-hidden="true">›</span>}
    </>
  );
  return (
    <div id="status" className="status" data-tone={status.tone} data-key={status.key} role="status" title={status.full} aria-label={status.full}>
      {status.tappable
        ? <button type="button" className="status-open" onClick={onTask} aria-haspopup="dialog">{content}</button>
        : content}
      {status.action && <button type="button" className="status-action" onClick={event => { event.stopPropagation(); actions[status.action]?.(); }}>{status.actionLabel}</button>}
    </div>
  );
}

function Turn({row, options, quiet}) {
  const text = useRef(null);
  const assistant = row.role === 'assistant';
  useLayoutEffect(() => {
    if (assistant) options.renderAssistant(text.current, row);
    else text.current.textContent = row.text;
  }, [row.text, row.complete, row.key]);
  useEffect(() => { if (row.document && !quiet) options.onDocumentShown?.(row.callId); }, [row.document, row.callId, quiet]);
  const label = row.speaker + (row.listenOnly ? ' · 仅倾听' : '');
  return (
    <article className={`turn ${row.role}`} data-key={row.key} data-streaming={String(!row.complete)}
      data-tone={row.speakerId ? row.speakerTone : undefined} data-listen-only={row.listenOnly ? 'true' : undefined}
      data-document={row.document ? 'true' : undefined}>
      <span className="turn-who">{label}</span>
      <div className="turn-text" ref={text} />
    </article>
  );
}

function Conversation({state, options, history, setHistory, onOverflow, wide}) {
  const turns = splitTurns(state.transcript);
  const scroller = useRef(null), pinned = useRef(true);
  const all = [...turns.earlier, ...turns.now];
  const firstNow = turns.now[0]?.key;
  const lastText = all.at(-1)?.text;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pinned.current) el.scrollTop = el.scrollHeight;
    // Latch: shrinking the portrait makes room, which must not grow it back
    // mid-turn (that would oscillate). A new turn resets it.
    if (!history && el.scrollHeight > el.clientHeight + 2) onOverflow();
  });
  useEffect(() => { pinned.current = true; }, [firstNow, history]);
  const onScroll = () => {
    const el = scroller.current;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  if (!all.length) return <div className="conversation" />;
  return (
    <div className="conversation" data-history={String(history)}>
      {!wide && (all.length > turns.now.length || history)
        ? <button type="button" className="conversation-toggle" onClick={() => setHistory(!history)} aria-expanded={history}>{history ? '收起' : '全部'}</button>
        : null}
      {!history && turns.earlier.length > 0 && (
        <div className="earlier" aria-label="之前的对话">
          {turns.earlier.slice(-3).map(row => <Turn key={row.key} row={row} options={options} quiet />)}
        </div>
      )}
      <div ref={scroller} onScroll={onScroll} className={history ? 'turns all' : 'turns now'} role="log" aria-live="polite" aria-label={history ? '全部对话' : '当前这一轮'}>
        {(history ? all : turns.now).map(row => <Turn key={row.key} row={row} options={options} />)}
      </div>
    </div>
  );
}

function Controls({state, actions, onHeight}) {
  const input = useRef(null), box = useRef(null);
  // The page floats these controls over the conversation and reserves their
  // height below the latest line, so text scrolls behind the glass.
  const report = () => { if (onHeight && box.current) onHeight(box.current.getBoundingClientRect().height); };
  // Every render (the text field opening) plus later size changes (fonts).
  useLayoutEffect(report);
  useLayoutEffect(() => {
    if (!onHeight || !box.current || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(report);
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [onHeight]);
  const active = ['connected', 'ending'].includes(state.call);
  const {open, enabled} = state.composer;
  // iOS raises the keyboard only for focus() inside the tap itself, so the
  // field is shown synchronously and focused in the same handler.
  const toggleComposer = () => {
    if (actions.composerOpen()) { input.current?.blur(); actions.compose(false); return; }
    flushSync(() => actions.compose(true));
    input.current?.focus({preventScroll: true});
  };
  const submit = async event => {
    event.preventDefault();
    const text = input.current.value.trim();
    if (!text) return;
    if (await actions.steer(text)) input.current.value = '';
  };
  return (
    <div className="controls" ref={box}>
      <form id="steerForm" className="composer" data-open={String(open && active)} onSubmit={submit}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); actions.compose(false); } }}>
        <label className="sr-only" htmlFor="steerText">补充内容</label>
        <input id="steerText" ref={input} placeholder="补充给 V 的文字…" maxLength={2000} autoComplete="off" disabled={!enabled} />
        <button id="steer" type="submit" aria-label="发送补充内容" disabled={!enabled}><Icon d="m3 3 19 8-9 3-3 9-7-20Zm9 10L22 3" /></button>
      </form>
      <div id="callPill" className="pill" aria-label="通话控制">
        {active && (
          <button id="textToggle" type="button" aria-label={open ? '收起文字输入' : '打开文字输入'} aria-expanded={open} aria-controls="steerForm" onClick={toggleComposer}>
            <Icon><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M7 16h10" /></Icon>
          </button>
        )}
        {active && (
          <button id="mute" type="button" aria-pressed={state.muted} aria-label={state.muted ? '打开麦克风' : '静音麦克风'} onClick={() => actions.mute()}>
            <Icon><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v4m-4 0h8" />{state.muted && <path d="m3 3 18 18" />}</Icon>
          </button>
        )}
        <button id="stop" className="hangup" type="button" aria-label={state.stopLabel} title={state.stopLabel} onClick={actions.hangup}><Icon d={HANG} /></button>
      </div>
      {state.muted && <span className="sr-only" role="status">麦克风已静音</span>}
    </div>
  );
}

function ModelPicker({state, actions}) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const current = state.models.find(model => model.id === state.model);
  useEffect(() => {
    if (!open) return;
    const close = event => { if (!box.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  if (!state.models.length) return null;
  return (
    <div className="model-picker" ref={box}>
      <button id="modelTrigger" type="button" aria-haspopup="menu" aria-expanded={open} aria-label="选择语音模型" disabled={state.modelDisabled}
        onClick={() => setOpen(!open)}><span id="modelName">{current?.label ?? '选择模型'}</span><span aria-hidden="true">⌄</span></button>
      {open && (
        <div id="modelMenu" className="model-menu" role="menu" aria-label="语音模型"
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault();
              const items = [...event.currentTarget.querySelectorAll('button:not(:disabled)')], index = items.indexOf(document.activeElement);
              items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
            }
          }}>
          {state.models.map(model => (
            <button key={model.id} type="button" role="menuitemradio" aria-checked={model.id === state.model} disabled={!model.available}
              onClick={() => { actions.chooseModel(model.id); setOpen(false); }}>{model.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function GrokPicker({state, actions}) {
  const {grok} = state;
  if (state.model !== 'grok' || !grok.voices.length) return null;
  return (
    <label id="grokVoicePicker" className="grok-voice-picker">
      <span>候选女声</span>
      <select id="grokVoice" aria-label="选择 Grok 女声" aria-describedby="grokVoiceHint" value={grok.voice ?? ''} onChange={event => actions.chooseGrokVoice(event.target.value)}>
        {grok.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
      </select>
      <small id="grokVoiceHint">{grok.hint || '选好声音，再拨号试聊'}</small>
      {grok.listenAvailable && <a id="grokListen" className="grok-listen-link" href={grok.listenHref}>先听一组表达对比 →</a>}
    </label>
  );
}

function EntryNotice({entry}) {
  return (
    <section id="entryNotice" className="entry-notice" data-kind={entry.kind} role="status" aria-live="polite" aria-atomic="true">
      <span className="entry-notice-icon" aria-hidden="true">
        {entry.kind === 'link'
          ? <Icon d="M8 10V7a4 4 0 0 1 8 0v3M7 10h10a2 2 0 0 1 2 2v7H5v-7a2 2 0 0 1 2-2Zm5 4v2" />
          : <Icon d="M4 8a12 12 0 0 1 16 0M7 12a7.5 7.5 0 0 1 10 0m-7 4a3 3 0 0 1 4 0m-2 4h.01" />}
      </span>
      <div className="entry-notice-copy">
        <h2>{entry.title}</h2>
        <p>{entry.description}</p>
        {entry.publicHref && <a className="session-primary" href={entry.publicHref}>使用 Public</a>}
        {entry.retry && <button type="button" onClick={() => window.location.reload()}>重新连接</button>}
      </div>
    </section>
  );
}

function TaskSheet({state, now, actions, onClose}) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    const key = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (!state.tasks.length) onClose(); }, [state.tasks.length]);
  return (
    <>
      <div className="sheet-veil" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="taskSheetTitle" tabIndex={-1} ref={ref}>
        <h2 id="taskSheetTitle">后台任务 <small>挂断后也会继续</small></h2>
        {state.tasks.map(task => (
          <div className="task-row" key={task.callId}>
            <span className="task-icon">{ACTIVITY_ICON[task.activity] ?? ACTIVITY_ICON.background}</span>
            <div className="task-copy">
              <strong>{task.stage ?? ACTIVITY_NAME[task.activity] ?? ACTIVITY_NAME.background}</strong>
              <small>{task.step > 0 ? `第 ${task.step} 步 · ` : ''}已进行 {clock(now - task.startedAt)}</small>
            </div>
          </div>
        ))}
        <button id="cancel" type="button" className="sheet-cancel" disabled={!state.cancelEnabled} onClick={async () => { await actions.cancelTasks(); onClose(); }}>取消后台任务</button>
      </section>
    </>
  );
}

function SessionSheet({state,actions}) {
 const value=state.sessionSheet,dialog=useRef(null);
 useEffect(()=>{if(!value)return;dialog.current?.showModal();return()=>dialog.current?.close();},[Boolean(value)]);
 if(!value)return null;
 const report=value.report, binding=value.kind==='binding';
 const conversation=value.conversation??state.conversation;
 return createPortal(<dialog ref={dialog} className={`session-dialog${binding?' binding-dialog':''}`} aria-labelledby="sessionSheetTitle" onCancel={actions.closeSessionSheet}>
  <header><div><span className="session-eyebrow">{binding?'V Voice for iPhone':'通话记录'}</span><h2 id="sessionSheetTitle">{binding?'在 iPhone 继续。':report?.name??'完整对话'}</h2></div><button type="button" aria-label="关闭" onClick={actions.closeSessionSheet}>×</button></header>
  <div className="session-dialog-body">
   {value.error&&<p role="alert" className="session-error">{value.error}</p>}
   {binding?<>
    <p className="binding-intro">{value.unidentified?'换到 iPhone，继续和 V 聊聊。':'换到 iPhone，这段对话接着聊。'}</p>
    <div className="binding-scene" aria-hidden="true">
     <div className="binding-phone"><span className="binding-island"/><img src="./assets/v-operator-home-1024.webp" alt=""/><span className="binding-wave"><i/><i/><i/><i/><i/></span></div>
     <div className="binding-scene-copy"><span>长按一下</span><strong>V 就在。</strong></div>
    </div>
    <div className="binding-conversation"><span className="binding-conversation-icon"><Icon d={conversation?.kind==='group'?'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M15 3.1a4 4 0 0 1 0 7.8M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8':'M20 21v-2a7 7 0 0 0-14 0v2M13 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'} /></span><div><strong>{value.unidentified?'Public':state.accountLabel??conversation?.accountLabel??'当前账号'}</strong><span>{conversation?.name??'当前会话'}</span></div><span className="binding-context">{value.unidentified?'访客':'已确认'}</span></div>
    {value.unidentified&&<p className="session-muted">{state.accessContext?.capabilities?.includes('web_search')?'连接这段 Public 访客对话，可继续使用搜索、V 记忆和后台任务；不会连接原飞书群或个人账号。':'连接这段访客对话；当前服务尚未开放 Public 工具。'}</p>}
    <div className="binding-action">
     {value.appUrl?<a className="session-primary" href={value.appUrl}><Icon d="M8 2.5h8a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Zm2 16h4"/>在 iPhone 上继续</a>:<button type="button" className="session-primary" disabled={value.busy} onClick={actions.createBinding}>{value.busy?'正在准备链接…':'准备绑定链接'}</button>}
     <p className="binding-confirm">在 App 中点「验证并绑定」，即可继续。</p>
    </div>
    <div className="binding-help">
     <details className="binding-install"><summary>还没有安装 V Voice？</summary><div>
      {value.appDownload?<><a className="binding-download" href={value.appDownload.url} target="_blank" rel="noopener noreferrer">{value.appDownload.label}</a><p className="session-muted">安装后回到这里，打开 App 完成绑定。</p></>:<><p className="session-muted">TestFlight 下载即将开放。现在也可以用网页和 V 聊天。</p><button type="button" className="binding-web" onClick={actions.closeSessionSheet}>先在网页聊</button></>}
     </div></details>
     {value.bindingUrl&&<details className="binding-fallback"><summary>没有跳转？复制链接</summary><div><p className="session-muted">在 App 设置中粘贴。链接 5 分钟内有效，过期后可重新生成。</p><div className="binding-link"><textarea aria-label="iOS 绑定链接" readOnly value={value.bindingUrl}/><div><button type="button" onClick={actions.copyBinding}>{value.copied?'已复制':'复制链接'}</button><button type="button" disabled={value.busy} onClick={actions.createBinding}>重新生成</button></div></div></div></details>}
     {value.devices?.length>0&&<details className="binding-devices"><summary>管理已绑定的 App（{value.devices.length}）</summary>{value.devices.map(device=><div key={device.id}><span>{new Date(device.createdAt).toLocaleString('zh-CN')} 绑定</span><button type="button" disabled={value.busy} onClick={()=>actions.revokeBinding(device.id)}>撤销此设备访问</button></div>)}</details>}
    </div>
   </>:<>
    {value.busy&&<p role="status">正在读取通话…</p>}
    {report&&<><p className="session-muted">{new Date(report.startedAt).toLocaleString('zh-CN')} · {clock(report.durationMs)} · {report.endedAt?'通话已结束':'通话进行中'}</p>
     <section className="call-report-summary"><h3>这通电话聊了什么</h3><p>{report.summary}</p>{report.pendingTasks&&<p className="session-muted">部分任务仍在后台处理，请以会话后续结果为准。</p>}</section>
     <h3 className="report-transcript-heading">完整对话</h3><div className="report-transcript">{report.turns.map(row=><article key={row.id} data-role={row.role}><span>{row.role==='user'?'你':'V'}{row.interrupted?' · 被打断':''}</span><p>{row.text}</p></article>)}{!report.turns.length&&<p className="session-muted">没有可保存的对话。</p>}</div>
    </>}
   </>}
  </div>
 </dialog>,document.body);
}

const GROUP_ICON='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M15 3.1a4 4 0 0 1 0 7.8M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8';
function IdentitySummary({context,onClick}) {
 if(!context)return null;
 const content=<><strong>{context.mode==='public'?'Public':context.accountLabel}</strong><span><Icon d={context.mode==='public'?'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18':GROUP_ICON}/>{context.mode==='public'?'独立访客':context.conversationLabel}</span></>;
 return onClick?<button className="access-summary" type="button" aria-label="查看账号与会话" onClick={onClick}>{content}</button>:<div className="access-summary">{content}</div>;
}
function InlineConfirmation({value,actions}) {
 const waiting=value.phase==='waiting',failed=value.phase==='failed',cancelling=value.phase==='cancelling';
 return <section className="identity-confirmation" aria-labelledby="confirmationTitle">
  <h2 id="confirmationTitle" role="status">{cancelling?'正在取消…':failed?'请重新确认':waiting?'回飞书确认，就能通话':'正在发送确认…'}</h2>
  {failed&&<p className="confirmation-description" role="alert">{value.error}</p>}
  {waiting&&value.label&&<p className="confirmation-marker"><span>核对</span><strong>{value.label}</strong></p>}
  <div className="confirmation-actions">{failed&&<button type="button" className="confirmation-retry" onClick={actions.connectIdentity}>重新发送</button>}<button type="button" disabled={cancelling} onClick={actions.skipConfirmation}>访客通话</button></div>
 </section>;
}

function AccessSheet({state,actions,onClose}) {
 const dialog=useRef(null),context=state.accessContext,connected=context?.mode==='connected';
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
 return createPortal(<dialog ref={dialog} className="session-dialog access-dialog" aria-labelledby="accessTitle" onCancel={onClose}>
  <header><div><span className="session-eyebrow">V Voice</span><h2 id="accessTitle">账号与会话</h2></div><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
  <div className="session-dialog-body">
   <div className="access-identity"><span className="access-monogram" aria-hidden="true">{connected?Array.from(context.accountLabel)[0]:'V'}</span><div><span className="access-kicker">当前使用</span><strong>{connected?context.accountLabel:'Public'}</strong><span>{connected?context.conversationLabel:'独立访客会话'}</span></div><span className="access-check" aria-label="已选择">✓</span></div>
   <p className="access-scope">{connected?(context.replySync?'通话与结果同步到这个飞书会话。':'使用这个账号获准的会话与工具。'):'无需连接个人账号，直接和 V 聊聊。'}</p>
   <div className="access-options">
    {state.accountLoginHref&&(state.confirmationAvailable?<button type="button" className="access-option" onClick={()=>{onClose();actions.connectIdentity();}}><span>{connected?'切换飞书身份':'连接飞书身份'}<small>在原飞书会话确认</small></span><span aria-hidden="true">↗</span></button>:<a className="access-option" href={state.accountLoginHref}><span>连接飞书身份</span><span aria-hidden="true">↗</span></a>)}
    {connected&&state.publicHref&&<a className="access-option" href={state.publicHref}><span>Public<small>开启独立访客会话</small></span><span aria-hidden="true">↗</span></a>}
    {state.iosBindingAvailable&&<button className="access-option" type="button" disabled={Boolean(state.confirmation)} onClick={()=>{onClose();actions.openBinding();}}><span>iOS 绑定<small>把当前身份与会话带到 iPhone</small></span><span aria-hidden="true">↗</span></button>}
   </div>
   <details className="access-permissions"><summary>权限与隐私</summary><p>{context?.scopeNote}</p><p>麦克风、定位由浏览器与系统管理，只在需要时请求。</p></details>
  </div>
 </dialog>,document.body);
}

function CallPage({view, actions, options}) {
  const state = useView(view);
  const active = state.call !== 'idle';
  // Dialing keeps the home scene: the same red circle turns into "cancel".
  const dialing = state.call === 'dialing', inCall = active && !dialing;
  const now = useNow(active);
  const viewport = useViewport();
  const [history, setHistory] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [accessOpen,setAccessOpen]=useState(false);
  const [controlsHeight, setControlsHeight] = useState(0);
  const main = useRef(null);
  const status = resolveStatus(state, now);
  const working = state.tasks.length > 0;
  const firstNow = splitTurns(state.transcript).now[0]?.key;
  useEffect(() => { if (!active) { setHistory(false); setSheet(false); } }, [active]);
  useEffect(() => { setOverflow(false); }, [firstNow]);
  useEffect(() => { if (main.current) main.current.inert = state.reading; }, [state.reading]);
  // Long replies borrow room from the portrait; the keyboard does the same.
  // Desktop keeps the two-column page: V's stage on the left, the full
  // conversation in a chat panel on the right. Phones get the stacked stage.
  const wide = viewport.width >= 701;
  const width = Math.min(viewport.width, 560), {height} = viewport;
  const compact = inCall && !wide && (overflow || height < 560 || state.composer.open && height < 700);
  const size = !inCall ? Math.min(width * .72, height * .4, 300)
    : wide ? Math.min(viewport.width * .26, height * .48, 360)
    : history ? 52 : compact ? Math.min(width * .38, height * .2, 150) : Math.min(width * .62, height * .3, 250);
  const openTasks = working ? () => setSheet(true) : undefined;
  const latchOverflow = useCallback(() => setOverflow(true), []);
  const voice = state.call === 'dialing' ? 'dialing' : status?.key === 'voice' ? (status.thinking ? 'thinking' : state.voice === 'speaking' ? 'speaking' : status.who ? 'hearing' : 'listening') : state.voice === 'speaking' ? 'speaking' : 'listening';
  const dock = (
    <>
      {inCall && <StatusLine status={status} onTask={openTasks} actions={actions} />}
      {inCall && <Controls state={state} actions={actions} />}
    </>
  );
  return (
    <>
      <SessionSheet state={state} actions={actions}/>
      {accessOpen&&!active&&<AccessSheet state={state} actions={actions} onClose={()=>setAccessOpen(false)}/>}
      {!active&&!state.nativeSettings&&<button className="ios-binding-trigger" type="button" disabled={!state.iosBindingAvailable||Boolean(state.confirmation)} onClick={actions.openBinding}>iOS 绑定</button>}
      <button id="changelogOpen" className="changelog-trigger" type="button" aria-haspopup="dialog" aria-controls="changelogDialog" aria-expanded="false" hidden={active}>
        <Icon d={SPARK} />更新日志
      </button>
      <main ref={main} className="call-page" data-call={state.call} data-confirmation={Boolean(state.confirmation)} data-voice={voice} data-work={String(working)}
        data-alert={status && ['error', 'warn'].includes(status.key) ? status.key : undefined} data-history={String(!wide && history)} data-compact={String(compact)}
        style={{'--avatar-size': Math.round(size) + 'px', '--controls-height': Math.ceil(controlsHeight) + 'px'}}>
        <header className="topbar" aria-live="off">
          {state.call === 'connected' || state.call === 'ending' ? <time className="call-clock">{state.callStartedAt ? clock(now - state.callStartedAt) : ''}</time> : null}
        </header>
        <section className="stage" aria-label="V">
          <Avatar onTap={openTasks} tone={voice === 'hearing' ? status.who.tone : null} label={working ? '查看后台任务' : 'V'} />
          {!inCall && (
            <div className="home">
              <a className="avatar-name" href={`./${window.location.search}`} aria-label="V 通话首页">V</a>
              <h1 className="sr-only">和 V 通话</h1>
              {dialing ? (
                <>
                  <button id="stop" className="dial dialing" type="button" aria-label={state.stopLabel} title={state.stopLabel} onClick={actions.hangup}><Icon d={HANG} /></button>
                  <span id="badge" className="home-badge dialing-note" role="status">{state.badge}</span>
                </>
              ) : state.entry&&!state.confirmation ? <EntryNotice entry={state.entry} /> : (
                <>
                  {!state.confirmation&&<GrokPicker state={state} actions={actions} />}
                  <button id="start" className={`dial${state.confirmation?' confirmation-dial':''}`} type="button" disabled={state.confirmation?state.confirmation.phase!=='failed':state.dial.disabled} aria-label={state.confirmation?(state.confirmation.phase==='failed'?'重试身份确认':'等待飞书确认'):state.dial.label} title={state.dial.label} onClick={state.confirmation?actions.connectIdentity:actions.dial}><Icon d={PHONE} /></button>
                  {state.confirmation?<InlineConfirmation value={state.confirmation} actions={actions}/>:<>
                  <ModelPicker state={state} actions={actions} />
                  <span id="badge" className="home-badge" role="status">{state.badge}</span>
                  <IdentitySummary context={state.confirmOnDial?null:state.accessContext} onClick={state.nativeSettings?undefined:()=>setAccessOpen(true)}/>
                  {state.nativeSettings&&!state.accessContext&&state.entrySummary&&<span className="access-summary">{state.entrySummary}</span>}
                  {state.accountLoginHref&&!state.accountLabel&&!state.confirmOnDial&&(state.confirmationAvailable?<button type="button" className="home-note identity-connect" onClick={actions.connectIdentity}>连接飞书身份</button>:<a className="home-note" href={state.accountLoginHref}>连接飞书账号</a>)}
                  {state.homeNote && <p className="home-note" data-tone={state.homeNoteTone} role="status">{state.homeNote}</p>}
                  </>}
                </>
              )}
            </div>
          )}
          {inCall && !state.reading && <StatusLine status={status} onTask={openTasks} actions={actions} />}
        </section>
        {inCall && (
          <aside className="chat-panel" aria-label="聊天内容">
            <Conversation state={state} options={options} history={wide || history} setHistory={setHistory} onOverflow={latchOverflow} wide={wide} />
            {!state.reading && <Controls state={state} actions={actions} onHeight={setControlsHeight} />}
          </aside>
        )}
      </main>
      {state.reading && document.getElementById('readerDock') && createPortal(dock, document.getElementById('readerDock'))}
      {sheet && working && <TaskSheet state={state} now={now} actions={actions} onClose={() => setSheet(false)} />}
    </>
  );
}

/** Renders synchronously so the call engine can bind its elements right after. */
export function mountCallUi(document, view, {actions, renderAssistant, onDocumentShown}) {
  const root = createRoot(document.getElementById('app'));
  flushSync(() => root.render(<CallPage view={view} actions={actions} options={{renderAssistant, onDocumentShown}} />));
  return root;
}
