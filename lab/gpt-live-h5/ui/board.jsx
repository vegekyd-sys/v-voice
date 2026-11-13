// The call board: V's sketchbook page beside the conversation. Blocks are
// pieces of paper; V's pen (the one strong colour) rings, underlines and ticks
// things as its voice reaches them, and items V has written but not yet said
// stay in pencil. Renders a scene from board-scene.mjs. Every string is plain
// text; nothing written by the director model is interpreted as markup.
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {edgeId, flowLayout, markedBlocks, scalePositions} from '../board-scene.mjs';
import {MARK_PATHS, arrow, fitPath, pointer, ring, tilt, underline} from '../board-sketch.mjs';

// One pen stroke over its target. CSS sizes the box; the path is fitted to the
// box's real size once it is known, and `pathLength` lets CSS draw it on.
function Stroke({d, className, ...rest}) {
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
    <svg ref={ref} className={className} {...rest} viewBox={size ? `0 0 ${size.width} ${size.height}` : '0 0 100 100'} aria-hidden="true">
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
// A few words V wants to stand out are written between two asterisks; the page
// goes over them with the highlighter. A stray asterisk is not shown.
function em(value) {
  const text = String(value ?? '');
  if (!text.includes('*')) return text;
  return text.split(/\*\*(.+?)\*\*/u).map((part, index) => index % 2 ? <mark key={index} className="board-em">{part}</mark> : part.replaceAll('*', ''));
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
// The picture of the thing an item is about, fetched through the Voice
// service like a photo block. Nothing is shown when none is found.
function Thumb({query, view, seed}) {
  const [src, setSrc] = useState(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc(null); setGone(false);
    Promise.resolve(view.loadPhoto?.(query)).then(url => { if (live) url ? setSrc(url) : setGone(true); }, () => { if (live) setGone(true); });
    return () => { live = false; };
  }, [query]);
  if (gone) return null;
  return <span className="board-thumb" data-ready={String(Boolean(src))} style={{'--tilt': tilt(seed + ':img', 3) + 'deg'}}>{src && <img src={src} alt={query} decoding="async" />}</span>;
}
// A number that is counted up to as it appears (whole numbers only; anything else is shown as written).
function Figure({value, on}) {
  const whole = /^\d{1,7}$/u.test(String(value)), goal = whole ? Number(value) : 0;
  const [shown, setShown] = useState(whole && on ? goal : 0);
  useEffect(() => {
    if (!whole || !on) return;
    if (typeof requestAnimationFrame !== 'function') { setShown(goal); return; }
    let frame, start = null;
    const step = time => { start ??= time; const part = Math.min(1, (time - start) / 650); setShown(Math.round(goal * (1 - (1 - part) ** 3))); if (part < 1) frame = requestAnimationFrame(step); };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [whole, on, goal]);
  return whole ? shown : em(value);
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
              <span className="board-lead" aria-hidden={!ordered || undefined}>
                {ordered ? <><Stroke className="board-badge-ring" d={ring(state.id + ':n')} /><b>{index + 1}</b></>
                  : leads(item.mark) ? <Mark kind={item.mark} seed={state.id} />
                  : item.icon ? <span className="board-icon">{item.icon}</span> : <i className="board-dash" />}
              </span>
              <div className="board-item">
                <Key item={item} seed={state.id}>{ordered && item.icon ? item.icon + ' ' : ''}{em(item.h)}</Key>
                {item.d && <span>{em(item.d)}</span>}
              </div>
              {item.img && <Thumb query={item.img} view={view} seed={state.id} />}
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
              {col.img && <Thumb query={col.img} view={view} seed={state.id} />}
              <header>
                {leads(col.mark) && <span className="board-lead"><Mark kind={col.mark} seed={state.id} /></span>}
                <Key item={col} seed={state.id}>{col.icon ? col.icon + ' ' : ''}{em(col.h)}</Key>
                {col.tag && <em style={{'--tilt': tilt(state.id + ':tag', 5) - 4 + 'deg'}}>{col.tag}</em>}
              </header>
              <ul>{col.points.map((point, at) => <li key={at}>{em(point)}</li>)}</ul>
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
            <dd>
              <span className="board-figure"><b><Figure value={item.value} on={!view.ahead.has(state.id)} /></b>{wraps(item.mark) && <Mark kind={item.mark} seed={state.id} />}{leads(item.mark) && <span className="board-lead"><Mark kind={item.mark} seed={state.id} /></span>}</span>
              {item.unit && <i>{item.unit}</i>}
            </dd>
            <dt>{item.icon ? item.icon + ' ' : ''}{em(item.label)}</dt>
            {item.note && <small>{em(item.note)}</small>}
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
              <span className="board-bar-label">{em(item.label)}</span>
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

// How wide an element is on screen, so a diagram can be laid out in real pixels.
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current, read = () => setWidth(Math.round(element.clientWidth));
    read();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
function Flow({block, view}) {
  const [ref, width] = useWidth();
  const pictured = block.nodes.some(node => node.img), narrow = width > 0 && width < 430;
  let {shape, layers, position} = flowLayout(block.nodes, block.edges, {narrow});
  // In a very narrow column a row of nodes would sit on top of one another: they stand in a column instead.
  if (shape === 'row' && width > 0 && width < 300) {
    layers = layers.map(layer => [layer[0]]); shape = 'layers';
    position = Object.fromEntries(layers.map(([id], index) => [id, {x: 50, y: layers.length === 1 ? 50 : index / (layers.length - 1) * 100, layer: index}]));
  }
  // The whole diagram fits one screen: a ring is as tall as it is wide (within
  // reason), a chain is one row, and layers share a fixed height.
  const row = pictured ? 150 : 96;
  const height = shape === 'ring' ? (pictured ? 300 + block.nodes.length * 60 : 220 + block.nodes.length * 40)
    : shape === 'row' ? row + 20 : layers.length * row;
  const pad = {x: shape === 'row' ? 0 : pictured ? 62 : 56, y: pictured ? 76 : 34};
  const at = id => ({x: shape === 'row' ? position[id].x / 100 * width : pad.x + (width - pad.x * 2) * position[id].x / 100,
    y: pad.y + (height - pad.y * 2) * position[id].y / 100});
  // An arrow stops short of the node at each end, by about the node's size.
  const reach = pictured ? 62 : 30;
  const short = (from, to) => { const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1, by = Math.min(reach, length * .3); return [(to.x - dx / length * by) / (width || 1) * 100, (to.y - dy / length * by) / height * 100]; };
  return (
    <>
      <Heading block={block} />
      <div className="board-flow" data-shape={shape} data-pictured={pictured || undefined} ref={ref} style={{height}}>
        {width > 0 && block.edges.map(([from, to, label], index) => {
          const a = at(from), b = at(to), ink = !view.ahead.has(edgeId(block, from, to));
          // Keyed on its state, so the arrow is drawn afresh when V gets to it.
          return (
            <React.Fragment key={`${index}:${ink}`}>
              <Stroke className="board-arrow" data-ink={String(ink)} d={arrow(`${block.id}:${from}:${to}`, short(b, a), short(a, b))} />
              {label && <span className="board-flow-label" data-ink={String(ink)} style={{left: (a.x + b.x) / 2, top: (a.y + b.y) / 2}}>{label}</span>}
            </React.Fragment>
          );
        })}
        {width > 0 && block.nodes.map(node => {
          const state = itemState(view, block, node), point = at(node.id);
          return (
            <div key={node.id} className="board-node" {...state.props}
              style={{left: point.x, top: point.y, maxWidth: shape === 'layers' ? `calc(${100 / layers[position[node.id].layer].length}% - 10px)` : shape === 'row' ? `calc(${100 / layers.length}% - 18px)` : '38%', '--tilt': tilt(state.id, 1.6) + 'deg'}}>
              {node.img && <Thumb query={node.img} view={view} seed={state.id} />}
              <strong>{node.icon && !node.img ? node.icon + ' ' : ''}{em(node.label)}</strong>{node.sub && <span>{em(node.sub)}</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- the diagram kit: shapes an explanation is built from ----------
// Every piece of a kit block is a `.board-piece`: pencil until V reaches it
// (unseen in a lesson), like the items of a list.
const pieceTone = (item, index) => item.tone ?? CARD_TONES[index % CARD_TONES.length];
const Label = ({item, state}) => <Key item={item} seed={state.id}>{item.icon && !item.img ? item.icon + ' ' : ''}{em(item.h)}</Key>;

// Countable things in rows. Remounted when V reaches the group, so the tiles
// are set down one after another at that moment.
function Tiles({block, view}) {
  return (
    <>
      <Heading block={block} />
      <div className="board-tiles">
        {block.items.map(item => {
          const state = itemState(view, block, item), shown = !view.ahead.has(state.id);
          return (
            <figure key={item.id} className="board-piece" {...state.props} data-tone={item.tone ?? 'sky'} style={{'--tilt': tilt(state.id, 1.6) + 'deg'}}>
              <div key={String(shown)} className="board-tile-grid" data-glyph={item.icon ? 'true' : undefined} style={{'--per': item.per}}>
                {Array.from({length: item.n}, (_, index) => <i key={index} data-lit={String(item.lit === undefined || index < item.lit)} style={{'--i': index}}>{item.icon ?? ''}</i>)}
              </div>
              {item.h && <figcaption><Key item={item} seed={state.id}>{em(item.h)}</Key></figcaption>}
            </figure>
          );
        })}
      </div>
    </>
  );
}

const OPERATOR = /^[=+\-−×÷*/<>≤≥≈≠→←↔()（）·:：]+$/u;
function Formula({block, view}) {
  return (
    <>
      <Heading block={block} />
      <div className="board-formula">
        {block.items.map(item => {
          const state = itemState(view, block, item);
          return (
            <span key={item.id} className="board-piece board-term" {...state.props} data-tone={item.tone} data-op={OPERATOR.test(item.h) || undefined}>
              <Key item={item} seed={state.id}>{em(item.h)}</Key>
              {item.d && <small>{em(item.d)}</small>}
            </span>
          );
        })}
      </div>
    </>
  );
}

function Timeline({block, view}) {
  const [ref, width] = useWidth();
  // A short history reads left to right when there is room; otherwise down a rail.
  const across = width >= 560 && block.items.length <= 5;
  return (
    <>
      <Heading block={block} />
      <ol className="board-timeline" data-dir={across ? 'row' : 'col'} ref={ref} style={{'--n': block.items.length}}>
        {block.items.map(item => {
          const state = itemState(view, block, item);
          return (
            <li key={item.id} className="board-piece" {...state.props}>
              <span className="board-when">{item.when ?? ''}</span>
              <span className="board-dot" aria-hidden="true"><Stroke className="board-badge-ring" d={ring(state.id + ':dot')} /></span>
              <div className="board-moment">
                {item.img && <Thumb query={item.img} view={view} seed={state.id} />}
                <Label item={item} state={state} />
                {item.d && <span>{em(item.d)}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Versus({block, view}) {
  const count = block.sides.length;
  const side = (value, index) => (
    <div key={index} className="board-vs-side" data-tone={CARD_TONES[index % CARD_TONES.length]} style={{'--tilt': tilt(block.id + ':side' + index, 1.4) + 'deg'}}>
      {value.img && <Thumb query={value.img} view={view} seed={block.id + ':side' + index} />}
      <strong>{value.icon && !value.img ? value.icon + ' ' : ''}{em(value.h)}</strong>
    </div>
  );
  const cell = (row, index) => (
    <span key={index} className="board-vs-cell" data-win={row.win === index || undefined} data-lose={row.win !== undefined && row.win !== index || undefined}>
      <span>{em(row.cells[index])}</span>
      {row.win === index && <Mark kind="check" seed={`${block.id}/${row.id}:win`} />}
    </span>
  );
  return (
    <>
      <Heading block={block} />
      <div className="board-versus" data-sides={count}>
        <header>
          {count === 2 ? <>{side(block.sides[0], 0)}<em>vs</em>{side(block.sides[1], 1)}</> : <><span />{block.sides.map(side)}</>}
        </header>
        {block.items.map(row => {
          const state = itemState(view, block, row), key = <b className="board-vs-key"><Key item={row} seed={state.id}>{row.icon ? row.icon + ' ' : ''}{em(row.h)}</Key></b>;
          return (
            <div key={row.id} className="board-piece board-vs-row" {...state.props}>
              {count === 2 ? <>{cell(row, 0)}{key}{cell(row, 1)}</> : <>{key}{row.cells.map((_, index) => cell(row, index))}</>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Overlap({block, view}) {
  return (
    <>
      <Heading block={block} />
      <div className="board-overlap">
        {block.items.map(item => {
          const state = itemState(view, block, item);
          return (
            <div key={item.id} className="board-piece" data-part={item.id} {...state.props}>
              {item.img && <Thumb query={item.img} view={view} seed={state.id} />}
              {(item.h || item.id === 'both') && <Key item={item} seed={state.id}>{item.icon && !item.img ? item.icon + ' ' : ''}{em(item.h ?? '都有')}</Key>}
              <ul>{item.points.map((point, at) => <li key={at}>{em(point)}</li>)}</ul>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Stack({block, view}) {
  const count = block.items.length;
  return (
    <>
      <Heading block={block} />
      <div className="board-stack" data-shape={block.shape}>
        {block.items.map((item, index) => {
          const state = itemState(view, block, item);
          return (
            <div key={item.id} className="board-piece board-layer" {...state.props} data-tone={pieceTone(item, index)}
              style={{'--tilt': tilt(state.id, .9) + 'deg', '--wide': block.shape === 'pyramid' ? 46 + 54 * (index + 1) / count + '%' : '100%'}}>
              {item.img && <Thumb query={item.img} view={view} seed={state.id} />}
              <div><Label item={item} state={state} />{item.d && <span>{em(item.d)}</span>}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// Marks kept at least `gap` apart along a 0-100 line, moved as little as possible.
function spread(positions, gap) {
  const order = positions.map((at, index) => ({at, index})).sort((a, b) => a.at - b.at);
  for (let index = 1; index < order.length; index++) order[index].at = Math.max(order[index].at, order[index - 1].at + gap);
  const over = Math.max(0, order.at(-1).at - 100);
  for (let index = order.length - 1; index >= 0; index--) order[index].at = Math.min(order[index].at - over, index === order.length - 1 ? 100 : order[index + 1].at - gap);
  const placed = [];
  for (const item of order) placed[item.index] = Math.max(0, item.at);
  return placed;
}
const figure = value => Math.abs(value) >= 10000 ? value.toLocaleString('en-US') : String(value);
function Scale({block, view}) {
  const [ref, width] = useWidth();
  const upright = block.dir === 'up' || block.items.length > 4 || width > 0 && width < 520;
  const places = spread(scalePositions(block.items), upright ? Math.min(22, 100 / Math.max(1, block.items.length - 1)) : 24);
  return (
    <>
      <Heading block={block} />
      <div className="board-scale" data-dir={upright ? 'up' : 'across'} ref={ref} style={upright ? {height: 70 + block.items.length * 62} : undefined}>
        <Stroke className="board-axis" d={underline(block.id + ':axis')} />
        {block.items.map((item, index) => {
          const state = itemState(view, block, item);
          return (
            <div key={item.id} className="board-piece board-notch" {...state.props} data-side={index % 2 ? 'b' : 'a'}
              style={upright ? {bottom: `calc(${places[index]}% * .86 + 4%)`} : {left: `calc(${places[index]}% * .84 + 8%)`}}>
              <b>{figure(item.at)}{block.unit && <i>{block.unit}</i>}</b>
              <span className="board-tick" aria-hidden="true" />
              <div className="board-notch-label">
                {item.img && <Thumb query={item.img} view={view} seed={state.id} />}
                <div><Label item={item} state={state} />{item.d && <span>{em(item.d)}</span>}</div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

const Tape = () => <i className="board-tape" aria-hidden="true" />;
const Sticky = ({block}) => <><Tape /><p className="board-sticky-text">{em(block.text)}</p></>;

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

const RENDER = {note: Sticky, sticky: Sticky, list: props => <List {...props} />, steps: props => <List {...props} ordered />, compare: Compare, stats: Stats, bars: Bars, table: Table, flow: Flow,
  tiles: Tiles, formula: Formula, timeline: Timeline, versus: Versus, overlap: Overlap, stack: Stack, scale: Scale};
const SMALL = new Set(['note', 'sticky', 'photo']);
const PAPER = {note: 'butter', sticky: 'butter'};

// The whole page in one view: when it is taller than the panel it is first
// set in two columns (on a wide panel) and then drawn smaller, down to a
// limit; below that the page scrolls as before. Pieces V has not reached yet
// keep their place, so the layout does not move while V speaks.
function useFit(scroller, page, key) {
  const [dense, setDense] = useState({key: null, on: false});
  useLayoutEffect(() => {
    const outer = scroller.current, inner = page.current;
    if (!outer || !inner) return;
    const fit = () => {
      const wide = outer.clientWidth >= 640, least = wide ? .62 : .78, edge = getComputedStyle(outer), room = outer.clientHeight - (parseFloat(edge.paddingTop) || 0) - (parseFloat(edge.paddingBottom) || 0);
      let zoom = 1;
      inner.style.setProperty('--zoom', '1'); inner.style.zoom = '1';
      // Three main blocks in one column leave half a wide panel empty: they go two abreast from the start.
      if (wide && !(dense.key === key && dense.on) && inner.querySelectorAll(':scope > .board-block[data-size="wide"]').length >= 3) { setDense({key, on: true}); return; }
      for (let pass = 0; pass < 4; pass++) {
        const height = inner.getBoundingClientRect().height;
        if (height <= room + 1 || zoom <= least) break;
        // Two columns before small print.
        if (pass === 0 && wide && height > room * 1.25 && !(dense.key === key && dense.on) && inner.querySelectorAll(':scope > .board-block[data-size="wide"]').length >= 2) { setDense({key, on: true}); return; }
        zoom = Math.max(least, zoom * Math.max(.72, Math.sqrt(room / height) * .99));
        inner.style.zoom = String(zoom); inner.style.setProperty('--zoom', String(zoom));
      }
    };
    fit();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    return () => observer.disconnect();
  });
  return dense.key === key && dense.on;
}

// One page of the canvas: its blocks, fitted to the panel.
function Sheet({scene, spoken, loadPhoto}) {
  const box = useRef(null), sheet = useRef(null);
  const [missing, setMissing] = useState(() => new Set());
  const dense = useFit(box, sheet, scene.serial);
  // While V speaks the mark follows the voice; otherwise it stays where the director put it.
  const view = {focus: spoken?.focus || scene.focus, ahead: new Set(spoken?.ahead ?? []), loadPhoto};
  useEffect(() => {
    if (!view.focus) return;
    box.current?.querySelector('[data-now]')?.scrollIntoView?.({block: 'nearest', inline: 'nearest', behavior: 'smooth'});
  }, [view.focus, scene.rev]);
  // Pen marks V has reached are on their items; the others are still to come.
  const blocks = markedBlocks(scene, view.ahead).filter(block => !(block.t === 'photo' && missing.has(block.query)));
  // Neighbours that each ask for part of the width (`w`) stand side by side.
  const rows = [];
  for (const block of blocks) {
    const last = rows.at(-1);
    // (When the page would not fit, its main blocks pair up as if each had asked for half.)
    const width = block.w ?? (dense && !SMALL.has(block.t) ? 'half' : undefined), ahead = last?.[0].w ?? (dense && last && !SMALL.has(last[0].t) ? 'half' : undefined);
    if (width && ahead && last.length < (ahead === 'third' ? 3 : 2)) last.push(block); else rows.push([block]);
  }
  return (
    <div className="board-scroll" ref={box} role="region" aria-live="polite" aria-label="画面内容" tabIndex={0}>
      <div className="board-body" ref={sheet}
        data-side={blocks.some(block => SMALL.has(block.t)) && blocks.some(block => !SMALL.has(block.t)) || undefined}>
        {rows.map(row => row.length > 1
          ? <div key={`${scene.serial}:row:${row[0].id}`} className="board-row" data-n={Math.min(3, row.length)} data-w={row[0].w ?? 'half'}>{row.map(piece)}</div>
          : piece(row[0]))}
      </div>
    </div>
  );
  function piece(block) {
    const key = `${scene.serial}:${block.id}`, small = SMALL.has(block.t);
    const paper = block.tone ?? PAPER[block.t];
    if (block.t === 'photo') return (
      <figure key={key} className="board-block board-photo" data-type="photo" data-size="small" data-ink={String(!view.ahead.has(block.id))} style={{'--tilt': tilt(key, 3) + 'deg'}}>
        <Photo block={block} loadPhoto={loadPhoto} onMissing={() => setMissing(old => new Set(old).add(block.query))} />
      </figure>
    );
    const View = RENDER[block.t];
    if (!View) return null;
    return (
      <div key={key} className="board-block" data-type={block.t} data-size={small ? 'small' : 'wide'} data-paper={paper} data-ink={view.ahead.has(block.id) ? 'false' : undefined}
        data-held={view.focus.split('/')[0] === block.id || undefined} style={{'--tilt': tilt(key, small ? 2.6 : paper ? .6 : 0) + 'deg'}}>
        <View block={block} view={view} />
      </div>
    );
  }
}

/**
 * The canvas. Every page drawn in the call stays on it, side by side; the
 * panel looks at one of them. The view slides to the page V is drawing on.
 * To look back the caller swipes (or scrolls sideways): the pages are a
 * snapping strip, with nothing on screen to operate. V drawing again brings
 * the view back to where V is.
 */
export function Board({scene, canvas, spoken, loadPhoto, onClose}) {
  const pages = canvas?.zones?.length ? canvas.zones.map(zone => zone.serial === scene.serial ? scene : zone) : [scene];
  const active = Math.max(0, pages.findIndex(page => page.serial === scene.serial));
  const track = useRef(null);
  const [inView, setInView] = useState(active);
  // V drawing anything, anywhere, brings the view to V's page.
  useLayoutEffect(() => {
    const strip = track.current;
    if (!strip) return;
    const left = strip.clientWidth * active;
    if (Math.abs(strip.scrollLeft - left) > 2) strip.scrollTo?.({left, behavior: 'smooth'});
    setInView(active);
  }, [active, pages.length, scene.rev]);
  const onScroll = () => { const strip = track.current; if (strip?.clientWidth) setInView(Math.max(0, Math.min(pages.length - 1, Math.round(strip.scrollLeft / strip.clientWidth)))); };
  const page = pages[Math.min(inView, pages.length - 1)];
  // A page that goes further into something on an earlier page is titled with where it came from.
  const parent = page.from ? pages.find(item => `z${item.serial}` === page.from) : null;
  return (
    <section className="board" data-pages={pages.length} aria-label={page.title ? `画面：${page.title}` : '画面'}>
      <header className="board-top">
        {page.title ? <h2 key={page.serial} className="board-title">{parent?.title && <small>{parent.title} ›</small>}<span>{page.title}</span><Stroke className="board-title-line" d={underline(page.title)} /></h2> : <span />}
        <button type="button" className="board-close" aria-label="收起画面" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="board-track" ref={track} onScroll={onScroll}>
        {pages.map((item, index) => (
          <div key={item.serial} className="board-page" data-lesson={item.lesson || undefined} data-current={index === inView || undefined} aria-hidden={index !== inView || undefined}>
            <Sheet scene={item} spoken={index === active ? spoken : null} loadPhoto={loadPhoto} />
          </div>
        ))}
      </div>
      {pages.length > 1 && <i className="board-dots" aria-hidden="true">{pages.map((item, index) => <b key={item.serial} data-current={index === inView || undefined} />)}</i>}
    </section>
  );
}
