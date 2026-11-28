// Renders canvas-today.mjs scenes with the page's own Board component (ui/board.jsx), each in a
// phone-sized frame with everything said (no pencil), so today's board can be put beside the prototype.
// Bundled by canvas-today-page.mjs; the data (scenes, pictures) is put in as window.TODAY.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Board} from '../../lab/gpt-live-h5/ui/board.jsx';

const {topics} = window.TODAY;
function Frame({topic}) {
  const loadPhoto = query => topic.pictures[query] ?? null;
  return (
    <figure className="today" data-id={topic.id}>
      <figcaption>{topic.tab}</figcaption>
      <div className="phone"><Board scene={topic.scene} spoken={null} loadPhoto={loadPhoto} onClose={() => {}} /></div>
    </figure>
  );
}
createRoot(document.getElementById('root')).render(<div className="frames">{topics.map(topic => <Frame key={topic.id} topic={topic} />)}</div>);
