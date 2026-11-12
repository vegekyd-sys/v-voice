// The call board: V's sketchbook page beside the conversation. Blocks are
// pieces of paper; V's pen (the one strong colour) rings, underlines and ticks
// things as its voice reaches them, and items V has written but not yet said
// stay in pencil. Renders a scene from board-scene.mjs. Every string is plain
// text; nothing written by the director model is interpreted as markup.
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {flowLayout} from '../board-scene.mjs';
import {MARK_PATHS, arrow, fitPath, pointer, ring, tilt, underline} from '../board-sketch.mjs';

// One pen stroke over its target. CSS sizes the box; the path is fitted to the
// box's real size once it is known, and `pathLength` lets CSS draw it on.
function Stroke({d, className}) {
  const ref = useRef(null);
  const [size, setSize] = useState(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const read = () => {
      const width = Math.round(element.clientWidth), height = Math.round(element.clientHeight);
      if (width && height) setSize(old => old && old.width === width && old.height === height ? old : {width, height});
    };
    read();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <svg ref={ref} className={className} viewBox={size ? `0 0 ${size.width} ${size.height}` : '0 0 100 100'} aria-hidden="true">
      {size && <path d={fitPath(d, size.width, size.height)} pathLength="1" />}
    </svg>
  );
}
const Mark = ({kind, seed}) => MARK_PATHS[kind] ? <Stroke className={`board-mark board-mark-${kind}`} d={MARK_PATHS[kind](seed)} /> : null;
const wraps = kind => kind === 'ring' || kind === 'underline';
const leads = kind => kind === 'check' || kind === 'cross' || kind === 'star';

// What every focusable item shares: pencil until V's voice reaches it, and the
// pen pointing at the one V is on now. (A plain function, safe inside loops.)
function itemState(view, block, item) {
  const id = `${block.id}/${item.id}`;
  return {id, now: view.focus === id, props: {'data-ink': String(!view.ahead.has(id)), 'data-now': view.focus === id || undefined, 'data-anchored': item.q ? 'true' : undefined}};
}
const Pen = ({seed}) => <Stroke className="board-pen" d={pointer(seed)} />;
// The words that carry an item, with the marker swipe behind them while V is
// on it and any mark the director asked for.
function Key({item, seed, children}) {
  return (
    <strong className="board-key">
      <span className="board-swipe" aria-hidden="true" />
      <span className="board-key-text">{children}</span>
      {wraps(item.mark) && <Mark kind={item.mark} seed={seed} />}
    </strong>
  );
}
const Heading = ({block}) => block.h ? <h3 className="board-h">{block.h}</h3> : null;

function List({block, view, ordered}) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <>
      <Heading block={block} />
      <Tag className={ordered ? 'board-steps' : 'board-list'}>
        {block.items.map((item, index) => {
          const state = itemState(view, block, item);
          return (
            <li key={item.id} {...state.props}>
              {state.now && <Pen seed={state.id} />}
              <span className="board-lead" aria-hidden={!ordered || undefined}>
                {ordered ? <><Stroke className="board-badge-ring" d={ring(state.id + ':n')} /><b>{index + 1}</b></>
                  : leads(item.mark) ? <Mark kind={item.mark} seed={state.id} />
                  : item.icon ? <span className="board-icon">{item.icon}</span> : <i className="board-dash" />}
              </span>
              <div className="board-item">
                <Key item={item} seed={state.id}>{ordered && item.icon ? item.icon + ' ' : ''}{item.h}</Key>
                {item.d && <span>{item.d}</span>}
              </div>
            </li>
          );
        })}
      </Tag>
    </>
  );
}

const CARD_TONES = ['lilac', 'butter', 'sky', 'peach'];
function Compare({block, view}) {
  return (
    <>
      <Heading block={block} />
      <div className="board-compare" data-cols={block.cols.length}>
        {block.cols.map((col, index) => {
          const state = itemState(view, block, col);
          return (
            <section key={col.id} {...state.props} data-tone={CARD_TONES[index % CARD_TONES.length]} style={{'--tilt': tilt(state.id, 1.4) + 'deg'}}>
              <header>
                {leads(col.mark) && <span className="board-lead"><Mark kind={col.mark} seed={state.id} /></span>}
                <Key item={col} seed={state.id}>{col.icon ? col.icon + ' ' : ''}{col.h}</Key>
                {col.tag && <em style={{'--tilt': tilt(state.id + ':tag', 5) - 4 + 'deg'}}>{col.tag}</em>}
              </header>
              <ul>{col.points.map((point, at) => <li key={at}>{point}</li>)}</ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Stats({block, view}) {
  return (
    <dl className="board-stats">
      {block.items.map(item => {
        const state = itemState(view, block, item);
        return (
          <div key={item.id} {...state.props}>
            {state.now && <Pen seed={state.id} />}
            <dd>
              <span className="board-figure"><b>{item.value}</b>{wraps(item.mark) && <Mark kind={item.mark} seed={state.id} />}{leads(item.mark) && <span className="board-lead"><Mark kind={item.mark} seed={state.id} /></span>}</span>
              {item.unit && <i>{item.unit}</i>}
            </dd>
            <dt>{item.icon ? item.icon + ' ' : ''}{item.label}</dt>
            {item.note && <small>{item.note}</small>}
          </div>
        );
      })}
    </dl>
  );
}

function Bars({block, view}) {
  const top = Math.max(...block.items.map(item => item.value), 0) || 1;
  return (
    <>
      <Heading block={block} />
      <ul className="board-bars">
        {block.items.map(item => {
          const state = itemState(view, block, item);
          return (
            <li key={item.id} {...state.props} data-top={item.value === top || undefined}>
              <span className="board-bar-label">{item.label}</span>
              <span className="board-bar-track"><i style={{width: Math.max(3, item.value / top * 100) + '%', '--tilt': tilt(state.id, .8) + 'deg'}} /></span>
              <span className="board-bar-value">{item.value}{block.unit ?? ''}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Table({block}) {
  return (
    <>
      <Heading block={block} />
      <div className="board-table-scroll">
        <table className="board-table">
          <thead><tr>{block.cols.map((col, index) => <th key={index} scope="col">{col}</th>)}</tr></thead>
          <tbody>{block.rows.map((row, at) => <tr key={at}>{row.map((cell, index) => index ? <td key={index}>{cell}</td> : <th key={index} scope="row">{cell}</th>)}</tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

const LAYER = 108, PAD = 36;
function Flow({block, view}) {
  const {layers, position} = flowLayout(block.nodes, block.edges);
  const height = Math.max(1, layers.length) * LAYER;
  // Arrows live in a 100 x 100 box stretched over the diagram; nodes use the
  // same percentages, so an arrow stops just short of the node it points at.
  const y = id => (PAD + (height - PAD * 2) * position[id].y / 100) / height * 100;
  const short = (from, to, by) => { const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy) || 1; return [to[0] - dx / length * by, to[1] - dy / length * by]; };
  return (
    <>
      <Heading block={block} />
      <div className="board-flow" style={{height}}>
        {block.edges.map(([from, to, label], index) => {
          const a = [position[from].x, y(from)], b = [position[to].x, y(to)], gap = 26 / height * 100;
          return (
            <React.Fragment key={index}>
              <Stroke className="board-arrow" d={arrow(`${block.id}:${from}:${to}`, short(b, a, gap), short(a, b, gap))} />
              {label && <span className="board-flow-label" style={{left: (a[0] + b[0]) / 2 + '%', top: (a[1] + b[1]) / 2 + '%'}}>{label}</span>}
            </React.Fragment>
          );
        })}
        {block.nodes.map(node => {
          const state = itemState(view, block, node);
          return (
            <div key={node.id} className="board-node" {...state.props}
              style={{left: position[node.id].x + '%', top: y(node.id) + '%', maxWidth: `calc(${100 / layers[position[node.id].layer].length}% - 10px)`, '--tilt': tilt(state.id, 1.6) + 'deg'}}>
              <strong>{node.icon ? node.icon + ' ' : ''}{node.label}</strong>{node.sub && <span>{node.sub}</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

const Tape = () => <i className="board-tape" aria-hidden="true" />;
const Sticky = ({block}) => <><Tape /><p className="board-sticky-text">{block.text}</p></>;

// A real photograph, fetched through the Voice service. Until it arrives the
// print is still developing; if nothing is found the print is taken away.
function Photo({block, loadPhoto, onMissing}) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve(loadPhoto?.(block.query)).then(url => { if (!live) return; if (url) setSrc(url); else onMissing(); }, () => { if (live) onMissing(); });
    return () => { live = false; };
  }, [block.query]);
  return (
    <>
      <Tape />
      <div className="board-print" data-ready={String(Boolean(src))}>{src && <img src={src} alt={block.caption ?? block.query} decoding="async" />}</div>
      <figcaption>{block.caption ?? block.query}</figcaption>
    </>
  );
}

const RENDER = {note: Sticky, sticky: Sticky, list: props => <List {...props} />, steps: props => <List {...props} ordered />, compare: Compare, stats: Stats, bars: Bars, table: Table, flow: Flow};
const SMALL = new Set(['note', 'sticky', 'photo']);
const PAPER = {note: 'butter', sticky: 'butter'};

export function Board({scene, spoken, loadPhoto, onClose}) {
  const box = useRef(null);
  const [missing, setMissing] = useState(() => new Set());
  // While V speaks the mark follows the voice; otherwise it stays where the director put it.
  const view = {focus: spoken?.focus || scene.focus, ahead: new Set(spoken?.ahead ?? [])};
  useEffect(() => {
    if (!view.focus) return;
    box.current?.querySelector('[data-now]')?.scrollIntoView?.({block: 'nearest', behavior: 'smooth'});
  }, [view.focus, scene.rev]);
  const blocks = scene.blocks.filter(block => !(block.t === 'photo' && missing.has(block.query)));
  return (
    <section className="board" aria-label={scene.title ? `画面：${scene.title}` : '画面'}>
      <header className="board-top">
        {scene.title ? <h2 key={scene.serial} className="board-title"><span>{scene.title}</span><Stroke className="board-title-line" d={underline(scene.title)} /></h2> : <span />}
        <button type="button" className="board-close" aria-label="收起画面" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="board-body" ref={box} role="region" aria-live="polite" aria-label="画面内容" tabIndex={0}
        data-side={blocks.some(block => SMALL.has(block.t)) && blocks.some(block => !SMALL.has(block.t)) || undefined}>
        {blocks.map(block => {
          const key = `${scene.serial}:${block.id}`, small = SMALL.has(block.t);
          const paper = block.tone ?? PAPER[block.t];
          if (block.t === 'photo') return (
            <figure key={key} className="board-block board-photo" data-type="photo" data-size="small" style={{'--tilt': tilt(key, 3) + 'deg'}}>
              <Photo block={block} loadPhoto={loadPhoto} onMissing={() => setMissing(old => new Set(old).add(block.query))} />
            </figure>
          );
          const View = RENDER[block.t];
          if (!View) return null;
          return (
            <div key={key} className="board-block" data-type={block.t} data-size={small ? 'small' : 'wide'} data-paper={paper}
              data-held={view.focus.split('/')[0] === block.id || undefined} style={{'--tilt': tilt(key, small ? 2.6 : paper ? .6 : 0) + 'deg'}}>
              <View block={block} view={view} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
