// The call board: what V is explaining, as a picture beside the conversation.
// Renders a scene from board-scene.mjs. Every string is plain text; the page
// never interprets markup written by the director model.
import React, {useEffect, useRef} from 'react';
import {flowLayout} from '../board-scene.mjs';

const part = (focus, block, item) => focus === `${block}/${item}`;
// `--i` staggers the entrance of the items inside one block.
const order = index => ({'--i': index});

function Heading({block}) {
  return block.h ? <h3 className="board-h">{block.h}</h3> : null;
}

function List({block, focus, ordered}) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <>
      <Heading block={block} />
      <Tag className={ordered ? 'board-steps' : 'board-list'}>
        {block.items.map((item, index) => (
          <li key={item.id} style={order(index)} data-focus={part(focus, block.id, item.id) || undefined}>
            {ordered && <span className="board-step-mark" aria-hidden="true">{index + 1}</span>}
            <div className="board-item"><strong>{item.h}</strong>{item.d && <span>{item.d}</span>}</div>
          </li>
        ))}
      </Tag>
    </>
  );
}

function Compare({block, focus}) {
  return (
    <>
      <Heading block={block} />
      <div className="board-compare" data-cols={block.cols.length}>
        {block.cols.map((col, index) => (
          <section key={col.id} style={order(index)} data-focus={part(focus, block.id, col.id) || undefined}>
            <header><strong>{col.h}</strong>{col.tag && <em>{col.tag}</em>}</header>
            <ul>{col.points.map((point, at) => <li key={at}>{point}</li>)}</ul>
          </section>
        ))}
      </div>
    </>
  );
}

function Stats({block, focus}) {
  return (
    <dl className="board-stats">
      {block.items.map((item, index) => (
        <div key={item.id} style={order(index)} data-focus={part(focus, block.id, item.id) || undefined}>
          <dd><b>{item.value}</b>{item.unit && <i>{item.unit}</i>}</dd>
          <dt>{item.label}</dt>
          {item.note && <small>{item.note}</small>}
        </div>
      ))}
    </dl>
  );
}

function Bars({block, focus}) {
  const top = Math.max(...block.items.map(item => item.value), 0) || 1;
  return (
    <>
      <Heading block={block} />
      <ul className="board-bars">
        {block.items.map((item, index) => (
          <li key={item.id} style={order(index)} data-focus={part(focus, block.id, item.id) || undefined} data-top={item.value === top || undefined}>
            <span className="board-bar-label">{item.label}</span>
            <span className="board-bar-track"><i style={{width: Math.max(2, item.value / top * 100) + '%'}} /></span>
            <span className="board-bar-value">{item.value}{block.unit ?? ''}</span>
          </li>
        ))}
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
          <tbody>{block.rows.map((row, at) => <tr key={at} style={order(at)}>{row.map((cell, index) => index ? <td key={index}>{cell}</td> : <th key={index} scope="row">{cell}</th>)}</tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

const LAYER = 104, PAD = 34;
function Flow({block, focus}) {
  const {layers, position} = flowLayout(block.nodes, block.edges);
  const height = Math.max(1, layers.length) * LAYER;
  const y = id => PAD + (height - PAD * 2) * position[id].y / 100;
  return (
    <>
      <Heading block={block} />
      <div className="board-flow" style={{height}}>
        <svg aria-hidden="true" width="100%" height={height}>
          <defs><marker id={`arrow-${block.id}`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1.5 8.5 5 1 8.5Z" /></marker></defs>
          {block.edges.map(([from, to], index) => {
            const a = position[from], b = position[to], mid = {x: (a.x + b.x) / 2, y: (y(from) + y(to)) / 2};
            return (
              <g key={index}>
                <line x1={a.x + '%'} y1={y(from)} x2={mid.x + '%'} y2={mid.y} markerEnd={`url(#arrow-${block.id})`} />
                <line x1={mid.x + '%'} y1={mid.y} x2={b.x + '%'} y2={y(to)} />
              </g>
            );
          })}
        </svg>
        {block.edges.map(([from, to, label], index) => label
          ? <span key={index} className="board-flow-label" style={{left: (position[from].x + position[to].x) / 2 + '%', top: (y(from) + y(to)) / 2}}>{label}</span> : null)}
        {block.nodes.map((node, index) => (
          <div key={node.id} className="board-node" data-focus={part(focus, block.id, node.id) || undefined}
            style={{left: position[node.id].x + '%', top: y(node.id), maxWidth: `calc(${100 / layers[position[node.id].layer].length}% - 10px)`, ...order(index)}}>
            <strong>{node.label}</strong>{node.sub && <span>{node.sub}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

const RENDER = {
  note: ({block}) => <p className="board-note">{block.text}</p>,
  list: props => <List {...props} />,
  steps: props => <List {...props} ordered />,
  compare: Compare, stats: Stats, bars: Bars, table: Table, flow: Flow,
};

export function Board({scene, onClose}) {
  const box = useRef(null);
  // Keep the part V is talking about on screen.
  useEffect(() => {
    if (!scene.focus) return;
    const target = box.current?.querySelector('[data-focus],[data-block-focus]');
    target?.scrollIntoView?.({block: 'nearest', behavior: 'smooth'});
  }, [scene.focus, scene.rev]);
  const focusBlock = scene.focus.split('/')[0], focusItem = scene.focus.includes('/');
  return (
    <section className="board" aria-label={scene.title ? `画面：${scene.title}` : '画面'} data-focusing={scene.focus ? 'true' : undefined}>
      <header className="board-top">
        {scene.title ? <h2 key={scene.serial} className="board-title">{scene.title}</h2> : <span />}
        <button type="button" className="board-close" aria-label="收起画面" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="board-body" ref={box} role="region" aria-live="polite" aria-label="画面内容" tabIndex={0}>
        {scene.blocks.map(block => {
          const View = RENDER[block.t];
          if (!View) return null;
          const held = focusBlock === block.id;
          return (
            <div key={`${scene.serial}:${block.id}`} className="board-block" data-type={block.t}
              data-held={held || undefined} data-block-focus={held && !focusItem || undefined}>
              <View block={block} focus={scene.focus} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
