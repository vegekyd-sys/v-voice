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
      <button id="changelogOpen" className="changelog-trigger" type="button" aria-haspopup="dialog" aria-controls="changelogDialog" aria-expanded="false" hidden={active}>
        <Icon d={SPARK} />更新日志
      </button>
      <main ref={main} className="call-page" data-call={state.call} data-voice={voice} data-work={String(working)}
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
              ) : state.entry ? <EntryNotice entry={state.entry} /> : (
                <>
                  <GrokPicker state={state} actions={actions} />
                  <button id="start" className="dial" type="button" disabled={state.dial.disabled} aria-label={state.dial.label} title={state.dial.label} onClick={actions.dial}><Icon d={PHONE} /></button>
                  <ModelPicker state={state} actions={actions} />
                  <span id="badge" className="home-badge" role="status">{state.badge}</span>
                  {state.homeNote && <p className="home-note" data-tone={state.homeNoteTone} role="status">{state.homeNote}</p>}
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
