import { EditorContent } from '@gprose/react';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import './style.css';
import { createCollaborationRoom } from './room.js';

const room = createCollaborationRoom();

function Pane({ client }: { client: (typeof room.clients)[number] }) {
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const profile = client.profile;
  const onReady = useCallback(() => setReady(true), []);

  return (
    <section
      className="collaboration-pane"
      aria-label={`${profile.name}'s editor`}
      data-client={profile.name.toLowerCase()}
    >
      <header className="pane-heading">
        <span className="avatar" style={{ background: profile.background, color: profile.color }}>
          {profile.name[0]}
        </span>
        <div>
          <h2>{profile.name}</h2>
          <p>{profile.role}</p>
        </div>
        <span className="pane-state">{ready ? 'Connected' : 'Loading editor…'}</span>
      </header>
      <EditorContent
        className="collaboration-editor"
        editor={client.editor}
        scroll="container"
        paddingTop={36}
        maxWidth={560}
        onReady={onReady}
        onNotice={setNotice}
      />
      <p className="pane-notice" role="status">
        {notice}
      </p>
    </section>
  );
}

function App() {
  const state = useSyncExternalStore(room.subscribe, room.getSnapshot);

  return (
    <main className="collaboration-app">
      <header className="collaboration-header">
        <div>
          <p className="eyebrow">GPROSE / LOCAL EXPERIMENT</p>
          <h1>Collaboration</h1>
          <p>Two independent editors. One shared document.</p>
        </div>
        <div className="delivery-controls">
          <span role="status">
            <i className={state.paused ? 'paused' : 'live'} />
            {state.paused
              ? `Delivery paused · ${state.pending} pending`
              : state.pending
                ? `${state.pending} pending`
                : 'All changes synced'}
          </span>
          <button type="button" onClick={() => room.toggleDelivery()}>
            {state.paused ? 'Resume delivery' : 'Pause delivery'}
          </button>
        </div>
      </header>
      <div className="collaboration-panes">
        {room.clients.map((client) => (
          <Pane key={client.profile.name} client={client} />
        ))}
      </div>
      <footer>
        <p>
          Text editing and shared selections. Formatting, new blocks and collaborative undo are
          still to come.
        </p>
        <p>Bob receives a protected placeholder for Alice's private note.</p>
        {state.message && <p role="alert">{state.message}</p>}
        <a href="/editor.html">Open the full editor and book samples ↗</a>
      </footer>
    </main>
  );
}

const host = document.getElementById('root');

if (!host) throw new Error('Missing collaboration root');

const root = createRoot(host);

root.render(<App />);

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    root.unmount();
    room.destroy();
  });
