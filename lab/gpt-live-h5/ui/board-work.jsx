// A made thing on the board (board-assets.mjs): the picture or video V
// generated in this call, in one frame. While it is being made the frame holds
// a pencil sketch of what was asked for; the picture develops into it; and when
// the picture is made to move, the video takes the same frame, so the print on
// the page starts moving where it hangs. Every version stays one tap away
// under the frame. A tap looks at it large, as with any picture on the board;
// what has been looked at is "this one" for V, and what can be done with it
// is offered beside it.
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
  // (No ids in the words: the picked thing is "this one" for V, which is told which one the caller has picked.)
  image: [{label: '动起来', say: '把这张图动起来'}, {label: '再来一版', say: '这张图再来一版，换个构图'}],
  video: [{label: '再来一版', say: '这个视频再做一版'}],
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
  // The picture or video the browser has actually fetched: until then the frame keeps what it held.
  const [fetched, setFetched] = useState('');
  const film = useRef(null), frame = useRef(null);
  // A video is played once with its sound when it arrives, then goes on moving without it; the
  // sound button plays it again from the start. (`quiet`: it is playing without sound.)
  const [quiet, setQuiet] = useState(false);
  const settle = (width, height) => { if (width > 0 && height > 0) setShape(Math.min(2.4, Math.max(.5, width / height))); };
  const playing = shown?.kind === 'video' && shown.state === 'ready' ? shown.id : '';
  useEffect(() => {
    const video = film.current;
    if (!playing || !video) return;
    const hush = () => { video.muted = true; video.loop = true; setQuiet(true); video.play().catch(() => {}); };
    // Where the page may not start sound by itself (no tap yet), it plays without and the button offers the sound.
    video.muted = false; video.loop = false; setQuiet(false);
    Promise.resolve(video.play()).then(() => { if (video.paused) hush(); }, hush);
    video.addEventListener('ended', hush);
    return () => video.removeEventListener('ended', hush);
  }, [playing]);
  // A thing just asked for is brought into view on its page (up and down only: the strip of pages is the board's to move).
  const making = shown?.state === 'making' ? shown.id : '';
  useEffect(() => {
    const host = frame.current?.closest('.board-scroll'), target = frame.current;
    if (!making || !host || !target) return;
    const at = target.getBoundingClientRect(), box = host.getBoundingClientRect();
    if (at.top >= box.top && at.bottom <= box.bottom) return;
    host.scrollTo?.({top: host.scrollTop + (at.top < box.top ? at.top - box.top - 12 : at.bottom - box.bottom + 12), behavior: 'smooth'});
  }, [making]);
  const sound = event => {
    event.stopPropagation();
    const video = film.current;
    if (!video) return;
    if (quiet) { video.muted = false; video.loop = false; video.currentTime = 0; setQuiet(false); video.play().catch(() => { video.muted = true; setQuiet(true); }); }
    else { video.muted = true; video.loop = true; setQuiet(true); }
  };
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
  const ready = shown.state === 'ready', loaded = ready && fetched === shown.id;
  const under = !loaded && shown.state !== 'failed' && source?.kind === 'image' && source.url ? source.url : '';
  const picked = view.picked === shown.id && shown.state === 'ready';
  // A version goes by the name the thing was given when it was first looked at.
  const name = shown.name || family.find(item => item.name)?.name || block.caption || (shown.state === 'making' ? '' : shown.kind === 'video' ? '视频' : '作品');
  const references = (shown.refs ?? []).map(id => assets.get(id)?.name).filter(Boolean);
  // A tap looks at it large, like any picture on the page; looked at is picked (board-viewer.jsx).
  const open = event => { if (loaded) view.enlarge?.(event.currentTarget); };
  return (
    <figure className="board-work" data-state={shown.state} data-kind={shown.kind} data-picked={picked || undefined}>
      <div className="board-work-frame" ref={frame} style={{'--shape': shape || ratio(shown.aspect) || (shown.kind === 'video' ? 16 / 9 : 4 / 3)}}
        role={loaded ? 'button' : undefined} tabIndex={loaded ? 0 : undefined} aria-label={loaded ? `放大：${name}` : undefined}
        data-enlarge={loaded ? 'true' : undefined} data-kind={shown.kind} data-asset={shown.id} data-name={name}
        onClick={open} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(event); } }}>
        {under && <img className="board-work-under" src={under} alt="" decoding="async" onLoad={event => settle(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />}
        {(shown.state === 'making' || ready && !loaded) && (
          <div className="board-work-sketch" data-over={under ? 'true' : undefined}>
            <i /><i /><i />
            {/* (Made, and on its way to this screen: the sketch stays until the picture itself has arrived.) */}
            {ready ? <p>{shown.kind === 'video' ? '马上就动' : '正在显影'}</p>
              : <p>{shown.kind === 'video' ? '正在让它动起来' : '正在画'}<span> · <Elapsed since={shown.at} /> 秒</span></p>}
            {shown.prompt && !under && !ready && <q>{shown.prompt}</q>}
          </div>
        )}
        {ready && shown.kind === 'image' && (
          <img key={shown.id} className="board-work-print" data-loaded={loaded || undefined} src={shown.url} alt={name} decoding="async"
            onLoad={event => { settle(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); setFetched(shown.id); view.shown?.(shown.id); }} />
        )}
        {ready && shown.kind === 'video' && (
          <video key={shown.id} ref={film} className="board-work-print" data-loaded={loaded || undefined} src={shown.url} muted loop autoPlay playsInline preload="auto"
            onLoadedMetadata={event => settle(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
            onLoadedData={() => { setFetched(shown.id); view.shown?.(shown.id); }} />
        )}
        {shown.state === 'failed' && <div className="board-work-failed"><p>{shown.kind === 'video' ? '这段没做成' : '这张没画成'}</p></div>}
        {loaded && shown.kind === 'video' && (
          <button type="button" className="board-work-sound" data-quiet={quiet || undefined} aria-label={quiet ? '带声音再放一遍' : '关掉声音'} aria-pressed={!quiet} onClick={sound}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />{quiet ? <path d="m16 9.5 5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" />}</svg>
          </button>
        )}
        {picked && <span className="board-work-this" aria-hidden="true">{shown.kind === 'video' ? '这个' : '这张'}</span>}
      </div>
      <figcaption>
        {/* (The page already carries the name as its title when the page is this thing's own.) */}
        {name && name !== view.title && <span className="board-work-name">{name}</span>}
        {shown.state === 'ready' && <small>{shown.source === 'backend' ? '后台生成' : shown.source === 'lesson' ? '讲解时现画' : 'V 生成'}{shown.kind === 'video' ? ' · 视频' : ''}</small>}
        {/* What it was (or is being) made from, by name: a wrong picture is seen at once. */}
        {references.length > 0 && <small className="board-work-refs">照着：{references.join('、')}</small>}
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
          {(ACTIONS[shown.kind] ?? []).map(action => <button key={action.label} type="button" onClick={() => view.act(action.say)}>{action.label}</button>)}
          <span>或者直接说：把它……</span>
        </div>
      )}
    </figure>
  );
}
