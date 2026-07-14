import { useState } from 'react';
import Chat from './panels/Chat';
import MemoryInspector from './panels/MemoryInspector';
import ConsolidationLog from './panels/ConsolidationLog';
import Goals from './panels/Goals';
import './App.css';

const SESSION_ID = crypto.randomUUID();

const TABS = [
  { id: 'chat',   label: 'chat'    },
  { id: 'memory', label: 'memory'  },
  { id: 'goals',  label: 'roadmap' },
  { id: 'log',    label: 'sleep'   },
];

export default function App() {
  const [tab, setTab] = useState('chat');

  return (
    <div className="shell">
      <header className="topbar">
        <div className="tb-logo">mnemos<em>_</em></div>
        <div className="tb-sep" />
        <nav className="tb-nav">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tb-tab${tab === t.id ? ' on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="tb-end">
          <span className="tb-pill"><span className="tb-dot" />groq</span>
        </div>
      </header>

      <main className="main">
        {tab === 'chat'   && <Chat sessionId={SESSION_ID} />}
        {tab === 'memory' && <MemoryInspector />}
        {tab === 'goals'  && <Goals />}
        {tab === 'log'    && <ConsolidationLog />}
      </main>

      <footer className="statusbar">
        <span>sqlite <span className="sb-val ok">ok</span></span>
        <span>qdrant <span className="sb-val ok">ok</span></span>
        <span className="sb-push">
          <span>t½ <span className="sb-val">168h</span></span>
          <span>sim≥ <span className="sb-val">0.85</span></span>
          <span>floor <span className="sb-val">0.15</span></span>
        </span>
      </footer>
    </div>
  );
}
