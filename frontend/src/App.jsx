import { useState } from 'react';
import Chat from './panels/Chat';
import MemoryInspector from './panels/MemoryInspector';
import ConsolidationLog from './panels/ConsolidationLog';
import Goals from './panels/Goals';
import './App.css';

const TABS = [
  { id: 'chat',   label: 'Chat',        icon: '◎' },
  { id: 'memory', label: 'Memory',      icon: '⬡' },
  { id: 'goals',  label: 'Roadmap',     icon: '◈' },
  { id: 'log',    label: 'Sleep Cycle', icon: '◉' },
];

const SESSION_ID = crypto.randomUUID();

const S = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100vh',
    background: '#0f1117', overflow: 'hidden',
  },
  nav: {
    display: 'flex', alignItems: 'center', gap: '0.3rem',
    padding: '0.75rem 1.5rem',
    borderBottom: '1px solid #1e2435',
    background: '#111520',
    flexShrink: 0,
  },
  wordmark: {
    fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: '1.05rem',
    color: '#f59e0b', marginRight: '1.5rem', letterSpacing: '-0.02em',
    userSelect: 'none',
  },
  tab: (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.68rem',
    textTransform: 'uppercase', letterSpacing: '0.12em',
    padding: '0.38rem 0.9rem', borderRadius: 99, cursor: 'pointer',
    background: active ? '#f59e0b' : 'transparent',
    color: active ? '#0f1117' : '#475569',
    border: `1px solid ${active ? '#f59e0b' : 'transparent'}`,
    transition: 'all 0.13s',
    fontWeight: active ? 500 : 400,
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
          <button
            key={t.id}
            style={S.tab(tab === t.id)}
            onClick={() => setTab(t.id)}
            onMouseEnter={e => { if (tab !== t.id) { e.currentTarget.style.color = '#f59e0b'; e.currentTarget.style.borderColor = '#252d3d'; } }}
            onMouseLeave={e => { if (tab !== t.id) { e.currentTarget.style.color = '#475569'; e.currentTarget.style.borderColor = 'transparent'; } }}
          >
            <span style={{ fontSize: '0.78rem', opacity: 0.85 }}>{t.icon}</span>
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
