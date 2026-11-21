// Looking at one picture of the board at a time, large: the one way to look
// closer at anything on a page, whether the board found it (a photograph) or V
// made it (a picture, a video). From the one tapped, the others of the same
// page are a swipe or an arrow away. What is being looked at is "this one" for
// V, can be saved, and (where V can be asked) can be worked on from here.
// Over the whole window, outside the board (which fades its edges with a mask).
import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

// What V can be asked to do with what is being looked at, in the caller's own words (sent as typed text).
const ACTS = {
  image: [{label: '动起来', say: '把这张图动起来'}, {label: '再来一版', say: '这张图再来一版，换个构图'}],
  video: [{label: '再来一版', say: '这个视频再做一版'}],
  photo: [{label: '动起来', say: '把这张图动起来'}],
};

/**
 * `items`: the page's pictures in order, [{kind: 'image'|'video', src, name, asset?, query?}].
 * `works`: the call's shelf as the page has it ({photos, picked, pick, act, save}); any part may be missing.
 */
export function Viewer({items, start, onClose, works = null}) {
  const [index, setIndex] = useState(Math.max(0, Math.min(items.length - 1, start)));
  const [shape, setShape] = useState(null);
  const [saved, setSaved] = useState('');
  const close = useRef(null), touch = useRef(null);
  const item = items[index], many = items.length > 1;
  // (The id it goes by on the call's shelf: a made thing's own, a found photograph's by what was searched for.)
  const id = item.asset || works?.photos?.get?.(item.query)?.id || '';
  const go = step => { setShape(null); setSaved(''); setIndex(at => (at + step + items.length) % items.length); };
  useEffect(() => {
    const back = document.activeElement;
    close.current?.focus({preventScroll: true});
    const key = event => {
      if (event.key === 'Escape') onClose();
      else if (many && event.key === 'ArrowRight') go(1);
      else if (many && event.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); back?.focus?.({preventScroll: true}); };
  }, []);
  // Looked at is picked: "this one" for V is the one on screen.
  useEffect(() => { if (id) works?.pick?.(id, true); }, [id]);
  if (typeof document === 'undefined') return null;
  const acts = works?.act && id ? ACTS[item.asset ? item.kind : 'photo'] ?? [] : [];
  const save = async event => {
    event.stopPropagation();
    if (saved === '保存中…') return;
    setSaved('保存中…');
    let result = '';
    try { result = await works.save({...item, id}); } catch { result = '没存成'; }
    setSaved(result || '已保存');
    setTimeout(() => setSaved(''), 2600);
  };
  // A swipe sideways turns to the next; a tap on the backdrop puts the picture back.
  const down = event => { const point = event.touches?.[0]; touch.current = point ? {x: point.clientX, y: point.clientY} : null; };
  const up = event => {
    const from = touch.current, point = event.changedTouches?.[0];
    touch.current = null;
    if (!from || !point || !many) return;
    const dx = point.clientX - from.x, dy = point.clientY - from.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) { event.preventDefault(); go(dx < 0 ? 1 : -1); }
  };
  return createPortal(
    <div className="board-enlarged board-viewer" role="dialog" aria-modal="true" aria-label={item.name ? `看图：${item.name}` : '看图'} onClick={onClose} onTouchStart={down} onTouchEnd={up}>
      <figure onClick={event => event.stopPropagation()}>
        {item.kind === 'video'
          ? <video key={item.src} src={item.src} controls autoPlay loop playsInline onLoadedMetadata={event => { const {videoWidth: width, videoHeight: height} = event.currentTarget; if (width && height) setShape({ratio: width / height, most: width * 2}); }}
              data-shaped={shape ? 'true' : undefined} style={shape ? {'--ratio': shape.ratio, '--most': shape.most + 'px'} : undefined} />
          : <img key={item.src} src={item.src} alt={item.name} data-shaped={shape ? 'true' : undefined} onClick={onClose}
              style={shape ? {'--ratio': shape.ratio, '--most': shape.most + 'px'} : undefined}
              onLoad={event => { const {naturalWidth: width, naturalHeight: height} = event.currentTarget; if (width && height) setShape({ratio: width / height, most: width * 2}); }} />}
        <figcaption>
          {item.name && <span>{item.name}</span>}
          {many && <small>{index + 1} / {items.length}</small>}
        </figcaption>
        {(works?.save || acts.length > 0) && (
          <div className="board-viewer-bar" role="group" aria-label="对这张图">
            {works?.save && <button type="button" className="board-viewer-save" aria-busy={saved === '保存中…' || undefined} onClick={save}>{saved || (item.kind === 'video' ? '保存视频' : '保存图片')}</button>}
            {acts.map(act => <button key={act.label} type="button" onClick={event => { event.stopPropagation(); works.act(act.say); onClose(); }}>{act.label}</button>)}
          </div>
        )}
      </figure>
      {many && <button type="button" className="board-viewer-turn" data-way="back" aria-label="上一张" onClick={event => { event.stopPropagation(); go(-1); }}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg></button>}
      {many && <button type="button" className="board-viewer-turn" data-way="on" aria-label="下一张" onClick={event => { event.stopPropagation(); go(1); }}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>}
      <button ref={close} type="button" className="board-enlarged-close" aria-label="关闭" onClick={onClose}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>,
    document.body);
}

/** The pictures of a page that can be looked at, in the order they stand: what `Viewer` turns through. */
export function pagePictures(page) {
  return [...(page?.querySelectorAll?.('[data-enlarge="true"]') ?? [])].map(element => {
    // (Not one the voice has not reached yet on a lesson's page: it is not on show.)
    if (element.closest('[data-ink="false"]')) return null;
    const media = element.querySelector('.board-work-print') ?? element.querySelector('video, img');
    const src = media?.currentSrc || media?.src || '';
    return src ? {element, src, kind: element.dataset.kind === 'video' ? 'video' : 'image', name: element.dataset.name ?? '', asset: element.dataset.asset ?? '', query: element.dataset.query ?? ''} : null;
  }).filter(Boolean);
}
