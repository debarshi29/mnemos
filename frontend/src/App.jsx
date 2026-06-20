import { useState, useCallback } from 'react';
import Chat from './panels/Chat';
import MemoryInspector from './panels/MemoryInspector';
import ConsolidationLog from './panels/ConsolidationLog';
import Goals from './panels/Goals';
import './App.css';

const TABS = [
  { id: 'chat',    label: 'Chat' },
  { id: 'memory',  label: 'Memory' },
  { id: 'goals',   label: 'Roadmap' },
  { id: 'log',     label: 'Sleep Cycle' },
];

const SESSION_ID = crypto.randomUUID();

const S = {
  root: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#101a13' },
  nav: {
    display: 'flex', alignItems: 'center', gap: '0.25rem',
    padding: '0.6rem 1rem', borderBottom: '1px solid #2b4231',
    background: '#16241a', flexShrink: 0,
  },
  wordmark: {
    fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: '1rem',
    color: '#c5e063', marginRight: '1rem', letterSpacing: '-0.02em',
  },
  tab: (active) => ({
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.65rem',
    textTransform: 'uppercase', letterSpacing: '0.14em',
    padding: '0.35rem 0.9rem', borderRadius: 99, cursor: 'pointer',
    background: active ? '#c5e063' : 'transparent',
    color: active ? '#101a13' : '#9ab09a',
    border: `1px solid ${active ? '#c5e063' : '#2b4231'}`,
    transition: 'all 0.12s',
  }),
  panel: { flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' },
};

export default function App() {
  const [tab, setTab] = useState('chat');

  return (
    <div style={S.root}>
      <nav style={S.nav}>
        <span style={S.wordmark}>mnemos</span>
        {TABS.map(t => (
          <button key={t.id} style={S.tab(tab === t.id)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div style={S.panel}>
        {tab === 'chat'   && <Chat sessionId={SESSION_ID} />}
        {tab === 'memory' && <MemoryInspector />}
        {tab === 'goals'  && <Goals />}
        {tab === 'log'    && <ConsolidationLog />}
      </div>
    </div>
  );
}
