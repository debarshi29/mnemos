import { useState } from 'react';
import Chat from './panels/Chat';
import MemoryInspector from './panels/MemoryInspector';
import ConsolidationLog from './panels/ConsolidationLog';
import Goals from './panels/Goals';
import './App.css';

const TABS = [
  { id: 'chat',   label: 'Chat'        },
  { id: 'memory', label: 'Memory'      },
  { id: 'goals',  label: 'Roadmap'     },
  { id: 'log',    label: 'Sleep Cycle' },
];

const SESSION_ID = crypto.randomUUID();

export default function App() {
  const [tab, setTab] = useState('chat');

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-wordmark">mnem<em>os</em></span>
        </div>
        <nav className="sidebar-nav">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`nav-btn${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-ver">v0.1.0</span>
        </div>
      </aside>

      <main className="panel">
        {tab === 'chat'   && <Chat sessionId={SESSION_ID} />}
        {tab === 'memory' && <MemoryInspector />}
        {tab === 'goals'  && <Goals />}
        {tab === 'log'    && <ConsolidationLog />}
      </main>
    </div>
  );
}
