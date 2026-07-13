import { useState } from 'react';
import Chat from './panels/Chat';
import MemoryInspector from './panels/MemoryInspector';
import ConsolidationLog from './panels/ConsolidationLog';
import Goals from './panels/Goals';
import './App.css';

const SESSION_ID = crypto.randomUUID();

const TABS = [
  { id: 'chat',   num: '01', label: 'Chat'    },
  { id: 'memory', num: '02', label: 'Memory'  },
  { id: 'goals',  num: '03', label: 'Roadmap' },
  { id: 'log',    num: '04', label: 'Sleep'   },
];

// Deterministic strength-field bars — stable across renders
const FIELD = Array.from({ length: 34 }, (_, i) => {
  const v = Math.abs(Math.sin(i * 12.9898 + 0.5) * 43758.5453) % 1;
  return {
    h: Math.round(14 + v * 82),
    bg: i % 11 === 3
      ? 'var(--am)'
      : `hsla(228,76%,72%,${(0.2 + v * 0.6).toFixed(2)})`,
  };
});

export default function App() {
  const [tab, setTab] = useState('chat');

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail-logo">
          <div className="rail-logotype">MNEMOS<span className="rail-dot">_</span></div>
          <div className="rail-sub">agentic memory · v0.9</div>
        </div>

        <nav className="rail-nav">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`rnav-btn${tab === t.id ? ' on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="rnav-num">{t.num}</span>
              <span className="rnav-label">{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="rail-foot">
          <div>
            <div className="sf-lbl">STRENGTH FIELD</div>
            <div className="sf-bars">
              {FIELD.map((b, i) => (
                <div
                  key={i}
                  className="sf-bar"
                  style={{ height: b.h + '%', background: b.bg }}
                />
              ))}
            </div>
            <div className="sf-caption">
              — facts · μ <span className="sf-em">—</span>
            </div>
          </div>
          <div className="sys-rows">
            <div className="sys-row">
              <span className="sys-k">provider</span>
              <span className="sys-v">groq</span>
            </div>
            <div className="sys-row">
              <span className="sys-k">status</span>
              <span className="sys-ok"><span className="sys-dot" />nominal</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        {tab === 'chat'   && <Chat sessionId={SESSION_ID} />}
        {tab === 'memory' && <MemoryInspector />}
        {tab === 'goals'  && <Goals />}
        {tab === 'log'    && <ConsolidationLog />}
      </main>

      <footer className="statusbar">
        <span>sqlite-wal <span className="sb-val ok">ok</span></span>
        <span>qdrant <span className="sb-val ok">ok</span></span>
        <span>minilm-l6 · 384d</span>
        <span className="sb-push">
          <span>t½ <span className="sb-val">168h</span></span>
          <span>sim ⩾ <span className="sb-val">0.85</span></span>
          <span>floor <span className="sb-val">0.15</span></span>
        </span>
      </footer>
    </div>
  );
}
