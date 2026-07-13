import { useState } from 'react';
import Chat from './panels/Chat';
import MemoryInspector from './panels/MemoryInspector';
import ConsolidationLog from './panels/ConsolidationLog';
import Goals from './panels/Goals';
import './App.css';

const TABS = [
  { id: 'chat',   label: 'Chat'   },
  { id: 'memory', label: 'Memory' },
  { id: 'goals',  label: 'Roadmap'},
  { id: 'log',    label: 'Sleep'  },
];

const SESSION_ID = crypto.randomUUID();

export default function App() {
  const [tab, setTab] = useState('chat');
  return (
    <div className="app">
      <header className="bar">
        <span className="bar-logo">mnem<i>os</i></span>
        <div className="bar-div" />
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </header>
      <main className="panel">
        {tab === 'chat'   && <Chat sessionId={SESSION_ID} />}
        {tab === 'memory' && <MemoryInspector />}
        {tab === 'goals'  && <Goals />}
        {tab === 'log'    && <ConsolidationLog />}
      </main>
    </div>
  );
}
