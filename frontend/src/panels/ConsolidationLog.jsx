import { useState, useEffect } from 'react';
import { getConsolidationLog, triggerConsolidate } from '../api';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };

const DETAIL_COLOR = {
  contradiction_resolved: '#f0c060',
  pruned: '#6b8870',
  default: '#8aa83f',
};

const S = {
  root: {
    display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0,
    background: '#101a13', overflowY: 'auto',
  },
  header: {
    padding: '1.25rem 2rem 1rem', borderBottom: '1px solid #1f3326',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: '#13201a', position: 'sticky', top: 0, zIndex: 1,
  },
  title: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1.05rem', color: '#e9efe4' },
  runBtn: (running) => ({
    ...MONO, fontSize: '0.6rem',
    textTransform: 'uppercase', letterSpacing: '0.12em',
    background: running ? 'transparent' : '#c5e063',
    color: running ? '#4a6b50' : '#101a13',
    border: running ? '1px solid #2b4231' : 'none',
    borderRadius: 99, padding: '0.3rem 0.85rem', cursor: running ? 'default' : 'pointer',
    transition: 'all 0.13s',
  }),
  list: { padding: '1.25rem 2rem', display: 'flex', flexDirection: 'column', gap: '1rem' },
  card: {
    background: '#13201a', border: '1px solid #1f3326', borderRadius: 14,
    overflow: 'hidden', transition: 'border-color 0.15s',
  },
  cardHead: {
    padding: '0.85rem 1.25rem',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  runId: { ...MONO, fontSize: '0.62rem', color: '#4a6b50' },
  ts: { ...MONO, fontSize: '0.6rem', color: '#3d5a44' },
  statsRow: {
    display: 'flex', gap: '0', borderTop: '1px solid #1f3326',
    borderBottom: '1px solid #1f3326',
  },
  statCell: (last) => ({
    flex: 1, padding: '0.8rem 0.5rem', textAlign: 'center',
    borderRight: last ? 'none' : '1px solid #1f3326',
    display: 'flex', flexDirection: 'column', gap: '0.2rem', alignItems: 'center',
  }),
  statVal: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1.3rem', color: '#c5e063' },
  statLabel: { ...MONO, fontSize: '0.52rem', color: '#3d5a44', textTransform: 'uppercase', letterSpacing: '0.1em' },
  vineWrap: { padding: '0 1.25rem' },
  vine: (pct) => ({
    height: 2, background: 'linear-gradient(90deg, #2b4231, #c5e063)',
    borderRadius: 99, width: `${pct}%`, margin: '0.65rem 0',
    transition: 'width 0.4s ease',
  }),
  toggleBtn: (open) => ({
    ...MONO, fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.1em',
    padding: '0.5rem 1.25rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem',
    cursor: 'pointer', color: open ? '#8aa83f' : '#4a6b50',
    background: 'none', border: 'none', width: '100%', textAlign: 'left',
    transition: 'color 0.12s',
  }),
  details: { padding: '0 1.25rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  detailItem: (type) => ({
    background: '#101a13', borderRadius: 8, padding: '0.55rem 0.85rem',
    fontSize: '0.8rem', lineHeight: 1.5, color: '#c8d4c4',
    borderLeft: `3px solid ${DETAIL_COLOR[type] || DETAIL_COLOR.default}`,
    display: 'flex', flexDirection: 'column', gap: '0.2rem',
  }),
  detailType: (type) => ({
    ...MONO, fontSize: '0.54rem', textTransform: 'uppercase', letterSpacing: '0.1em',
    color: DETAIL_COLOR[type] || DETAIL_COLOR.default,
  }),

  empty: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    color: '#4a6b50', padding: '3rem', textAlign: 'center', gap: '0.5rem',
  },
  emptyHint: { ...MONO, fontSize: '0.65rem', lineHeight: 1.7 },
};

const STATS = [
  { key: 'episodes_processed', label: 'episodes' },
  { key: 'facts_created',      label: 'created'  },
  { key: 'facts_updated',      label: 'updated'  },
  { key: 'contradictions_resolved', label: 'resolved' },
  { key: 'facts_pruned',       label: 'pruned'   },
];

function fmtTs(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

export default function ConsolidationLog() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState({});

  const load = () => {
    setLoading(true);
    getConsolidationLog().then(d => { setEntries(d); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const runNow = async () => {
    setRunning(true);
    try { await triggerConsolidate(); load(); } catch {}
    setRunning(false);
  };

  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.title}>Sleep Cycle</span>
        <button style={S.runBtn(running)} onClick={runNow} disabled={running}>
          {running ? 'running…' : '↻ run now'}
        </button>
      </div>

      {loading && <p style={{ padding: '1.5rem 2rem', color: '#4a6b50', fontStyle: 'italic', fontSize: '0.85rem' }}>Loading…</p>}

      {!loading && entries.length === 0 && (
        <div style={S.empty}>
          <span style={{ fontSize: '1.4rem', opacity: 0.4 }}>◉</span>
          <span style={S.emptyHint}>
            No consolidation runs yet.<br />
            Hit "run now" to start the sleep cycle.
          </span>
        </div>
      )}

      <div style={S.list}>
        {entries.map(e => {
          const total = e.facts_created + e.facts_updated;
          const pct = e.episodes_processed > 0 ? Math.min((total / e.episodes_processed) * 100, 100) : 0;
          const isOpen = expanded[e.run_id];
          return (
            <div
              key={e.run_id}
              style={S.card}
              onMouseEnter={el => el.currentTarget.style.borderColor = '#2b4231'}
              onMouseLeave={el => el.currentTarget.style.borderColor = '#1f3326'}
            >
              <div style={S.cardHead}>
                <span style={S.runId}>run · {e.run_id.slice(0, 8)}</span>
                <span style={S.ts}>{fmtTs(e.timestamp)}</span>
              </div>

              <div style={S.statsRow}>
                {STATS.map((s, i) => (
                  <div key={s.key} style={S.statCell(i === STATS.length - 1)}>
                    <span style={S.statVal}>{e[s.key] ?? 0}</span>
                    <span style={S.statLabel}>{s.label}</span>
                  </div>
                ))}
              </div>

              <div style={S.vineWrap}>
                <div style={S.vine(pct)} />
              </div>

              {e.details?.length > 0 && (
                <>
                  <button style={S.toggleBtn(isOpen)} onClick={() => toggle(e.run_id)}>
                    <span>{isOpen ? '▾' : '▸'}</span>
                    {e.details.length} event{e.details.length !== 1 ? 's' : ''}
                  </button>
                  {isOpen && (
                    <div style={S.details}>
                      {e.details.map((d, i) => (
                        <div key={i} style={S.detailItem(d.type)}>
                          <span style={S.detailType(d.type)}>{d.type.replace(/_/g, ' ')}</span>
                          {d.type === 'contradiction_resolved' && (
                            <span>
                              kept <em>"{d.winner_content?.slice(0, 70)}"</em>
                              {d.loser_content ? <> · dropped <em>"{d.loser_content.slice(0, 70)}"</em></> : null}
                            </span>
                          )}
                          {d.type === 'pruned' && (
                            <span>"{d.content?.slice(0, 100)}" (conf {d.confidence?.toFixed(2)})</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
