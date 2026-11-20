// A made thing on the board (board-assets.mjs): the picture or video V
// generated in this call, in one frame. While it is being made the frame holds
// a pencil sketch of what was asked for; the picture develops into it; and when
// the picture is made to move, the video takes the same frame, so the print on
// the page starts moving where it hangs. Every version stays one tap away
// under the frame. A tap on the frame picks it: "this one" is then that one
// for V, and what can be done with it is offered beside it.
import React, {useEffect, useRef, useState} from 'react';
import {assetFamily} from '../board-assets-client.mjs';

const ratio = value => { const [width, height] = String(value ?? '').split(':').map(Number); return width > 0 && height > 0 ? Math.min(2.4, Math.max(.5, width / height)) : 0; };
const KIND = {image: '图', video: '视频'};

// Seconds since the thing was asked for, counted on the page.
function Elapsed({since}) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.round((Date.now() - since) / 1000)));
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.max(0, Math.round((Date.now() - since) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return <b>{seconds}</b>;
}

// What V can be asked to do with the picked thing, in the caller's own words (sent as typed text).
const ACTIONS = {
  image: [{label: '动起来', say: id => `把 ${id} 这张图动起来`}, {label: '再来一版', say: id => `${id} 这张图再来一版，换个构图`}],
  video: [{label: '再来一版', say: id => `${id} 这个视频再做一版`}],
};

export function Work({block, view}) {
  const assets = view.assets, latest = assets?.get(block.asset) ?? null;
  const family = latest ? assetFamily(assets, latest.id) : [];
  // The caller may look back at an earlier version; a new version brings the frame back to itself.
  const [back, setBack] = useState(null);
  useEffect(() => { setBack(null); }, [block.asset]);
  const shown = family.find(item => item.id === back) ?? latest;
  // The frame keeps the shape of what it last held until the next thing reports its own.
  const [shape, setShape] = useState(0);
  const film = useRef(null);
  const settle = (width, height) => { if (width > 0 && height > 0) setShape(Math.min(2.4, Math.max(.5, width / height))); };
  if (!shown) {
    return (
      <figure className="board-work" data-state="making">
        <div className="board-work-frame" style={{'--shape': 4 / 3}}><div className="board-work-sketch"><i /><i /><i /></div></div>
        <figcaption><span className="board-work-name">{block.caption ?? '正在准备'}</span></figcaption>
      </figure>
    );
  }
  // What the frame shows under a thing still being made: the picture it is made from.
  const source = shown.from ? assets.get(shown.from) : null;
  const under = shown.state === 'making' && source?.kind === 'image' && source.url ? source.url : '';
  const poster = shown.kind === 'video' && source?.kind === 'image' ? source.url : undefined;
  const picked = view.picked === shown.id && shown.state === 'ready';
  const name = shown.name || block.caption || (shown.state === 'making' ? '' : shown.kind === 'video' ? '视频' : '作品');
  const pick = () => { if (shown.state === 'ready') view.pick?.(shown.id); };
  const large = event => {
    event.stopPropagation();
    if (shown.kind === 'video') { const video = film.current; (video?.requestFullscreen ?? video?.webkitEnterFullscreen)?.call(video); return; }
    view.enlarge?.({src: shown.url, name});
  };
  return (
    <figure className="board-work" data-state={shown.state} data-kind={shown.kind} data-picked={picked || undefined}>
      <div className="board-work-frame" style={{'--shape': shape || ratio(shown.aspect) || (shown.kind === 'video' ? 16 / 9 : 4 / 3)}}
        role={shown.state === 'ready' ? 'button' : undefined} tabIndex={shown.state === 'ready' ? 0 : undefined}
        aria-pressed={shown.state === 'ready' ? picked : undefined} aria-label={shown.state === 'ready' ? `${picked ? '已选中' : '选中'}：${name}` : undefined}
        onClick={pick} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); } }}>
        {under && <img className="board-work-under" src={under} alt="" decoding="async" onLoad={event => settle(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />}
        {shown.state === 'making' && (
          <div className="board-work-sketch" data-over={under ? 'true' : undefined}>
            <i /><i /><i />
            <p>{shown.kind === 'video' ? '正在让它动起来' : '正在画'}<span> · <Elapsed since={shown.at} /> 秒</span></p>
            {shown.prompt && !under && <q>{shown.prompt}</q>}
          </div>
        )}
        {shown.state === 'ready' && shown.kind === 'image' && (
          <img key={shown.id} className="board-work-print" src={shown.url} alt={name} decoding="async"
            onLoad={event => { settle(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); view.shown?.(shown.id); }} />
        )}
        {shown.state === 'ready' && shown.kind === 'video' && (
          <video key={shown.id} ref={film} className="board-work-print" src={shown.url} poster={poster} muted loop autoPlay playsInline preload="auto"
            onLoadedMetadata={event => settle(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
            onLoadedData={() => view.shown?.(shown.id)} />
        )}
        {shown.state === 'failed' && <div className="board-work-failed"><p>{shown.kind === 'video' ? '这段没做成' : '这张没画成'}</p></div>}
        {shown.state === 'ready' && (
          <button type="button" className="board-work-large" aria-label={shown.kind === 'video' ? '全屏看视频' : '放大图片'} onClick={large}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg>
          </button>
        )}
        {picked && <span className="board-work-this" aria-hidden="true">这张</span>}
      </div>
      <figcaption>
        {name && <span className="board-work-name">{name}</span>}
        {shown.state === 'ready' && <small>{shown.source === 'backend' ? '后台生成' : shown.source === 'lesson' ? '讲解时现画' : 'V 生成'}{shown.kind === 'video' ? ' · 视频' : ''}</small>}
      </figcaption>
      {family.length > 1 && (
        <ol className="board-work-line" aria-label="这件作品的各个版本">
          {family.map((item, index) => (
            <li key={item.id}>
              <button type="button" data-current={item.id === shown.id || undefined} data-state={item.state} aria-label={`第 ${index + 1} 版：${KIND[item.kind] ?? '图'}`}
                onClick={() => setBack(item.id === latest.id ? null : item.id)}>
                {item.kind === 'image' && item.url ? <img src={item.url} alt="" decoding="async" /> : item.kind === 'video' && item.from && assets.get(item.from)?.url ? <img src={assets.get(item.from).url} alt="" decoding="async" /> : <i />}
                {item.kind === 'video' && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>}
              </button>
            </li>
          ))}
        </ol>
      )}
      {picked && view.act && (
        <div className="board-work-acts" role="group" aria-label="对这件作品">
          {(ACTIONS[shown.kind] ?? []).map(action => <button key={action.label} type="button" onClick={() => view.act(action.say(shown.id))}>{action.label}</button>)}
          <span>或者直接说：把它……</span>
        </div>
      )}
    </figure>
  );
}
