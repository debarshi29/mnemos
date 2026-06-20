import { useState, useEffect } from 'react';
import { getConsolidationLog, triggerConsolidate } from '../api';

const LABEL = {
  fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem',
  textTransform: 'uppercase', letterSpacing: '0.16em', color: '#9ab09a',
};

const S = {
  root: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#101a13', overflowY: 'auto' },
  header: {
    padding: '1.25rem 1.5rem 1rem', borderBottom: '1px solid #2b4231',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: '#16241a', position: 'sticky', top: 0, zIndex: 1,
  },
  title: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1rem' },
  runBtn: {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem',
    textTransform: 'uppercase', letterSpacing: '0.12em',
    background: '#c5e063', color: '#101a13',
    border: 'none', borderRadius: 99, padding: '0.3rem 0.8rem', cursor: 'pointer',
  },
  empty: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#9ab09a', fontStyle: 'italic', fontSize: '0.9rem', padding: '3rem',
  },
  list: { padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' },
  card: {
    background: '#16241a', border: '1px solid #2b4231', borderRadius: 12,
    overflow: 'hidden',
  },
  cardHeader: {
    padding: '0.9rem 1.1rem 0.75rem',
    borderBottom: '1px solid #2b4231',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  runId: { fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.65rem', color: '#8aa83f' },
  ts: { ...LABEL, fontSize: '0.6rem' },
  statsRow: {
    display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
    borderBottom: '1px solid #2b4231',
  },
  stat: {
    padding: '0.75rem', textAlign: 'center',
    borderRight: '1px solid #2b4231',
    display: 'flex', flexDirection: 'column', gap: '0.2rem',
  },
  statVal: { fontFamily: "'Fraunces', serif", fontWeight: 700, fontSize: '1.4rem', color: '#c5e063' },
  statLabel: { ...LABEL, fontSize: '0.55rem' },
  details: { padding: '0.75rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  detailItem: (type) => ({
    background: '#1c2e21', borderRadius: 8, padding: '0.55rem 0.8rem',
    fontSize: '0.8rem', lineHeight: 1.45, color: '#e9efe4',
    borderLeft: `3px solid ${type === 'contradiction_resolved' ? '#c5e063' : type === 'pruned' ? '#9ab09a' : '#8aa83f'}`,
  }),
  detailType: (type) => ({
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.55rem',
    textTransform: 'uppercase', letterSpacing: '0.12em',
    color: type === 'contradiction_resolved' ? '#c5e063' : '#9ab09a',
    marginRight: '0.4rem',
  }),
  vine: {
    height: 3,
    background: 'linear-gradient(90deg, #8aa83f, #c5e063)',
    borderRadius: 99,
    margin: '0 1.1rem 0.75rem',
    transition: 'width 0.4s ease',
  },
};

function StatCard({ val, label }) {
  return (
    <div style={S.stat}>
      <span style={S.statVal}>{val}</span>
      <span style={S.statLabel}>{label}</span>
    </div>
  );
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

  const runConsolidate = async () => {
    setRunning(true);
    try { await triggerConsolidate(); load(); } catch {}
    setRunning(false);
  };

  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.title}>Consolidation Log</span>
        <button style={S.runBtn} onClick={runConsolidate} disabled={running}>
          {running ? 'running…' : '↻ run now'}
        </button>
      </div>

      {loading && <p style={{ padding: '1.5rem', color: '#9ab09a', fontStyle: 'italic' }}>Loading…</p>}
      {!loading && entries.length === 0 && (
        <div style={S.empty}>No consolidation runs yet. Hit "run now" to start the sleep cycle.</div>
      )}

      <div style={S.list}>
        {entries.map(e => {
          const total = e.facts_created + e.facts_updated;
          const pct = e.episodes_processed > 0 ? Math.min(total / e.episodes_processed, 1) : 0;
          const isOpen = expanded[e.run_id];
          return (
            <div key={e.run_id} style={S.card}>
              <div style={S.cardHeader}>
                <span style={S.runId}>run · {e.run_id.slice(0, 8)}</span>
                <span style={S.ts}>{new Date(e.timestamp).toLocaleString()}</span>
              </div>

              <div style={S.statsRow}>
                <StatCard val={e.episodes_processed} label="episodes" />
                <StatCard val={e.facts_created} label="created" />
                <StatCard val={e.facts_updated} label="updated" />
                <StatCard val={e.contradictions_resolved} label="conflicts" />
                <StatCard val={e.facts_pruned} label="pruned" />
              </div>

              {/* vine progress bar */}
              <div style={{ padding: '0.65rem 1.1rem 0' }}>
                <div style={{ ...S.vine, width: `${pct * 100}%` }} />
              </div>

              {e.details?.length > 0 && (
                <>
                  <button
                    onClick={() => toggle(e.run_id)}
                    style={{ ...LABEL, padding: '0.5rem 1.1rem 0.75rem', display: 'block', cursor: 'pointer', color: '#8aa83f' }}
                  >
                    {isOpen ? '▾' : '▸'} {e.details.length} detail{e.details.length !== 1 ? 's' : ''}
                  </button>
                  {isOpen && (
                    <div style={S.details}>
                      {e.details.map((d, i) => (
                        <div key={i} style={S.detailItem(d.type)}>
                          <span style={S.detailType(d.type)}>{d.type.replace(/_/g, ' ')}</span>
                          {d.type === 'contradiction_resolved' && (
                            <>kept: "{d.winner_content?.slice(0, 80)}" · dropped: "{d.loser_content?.slice(0, 80)}"</>
                          )}
                          {d.type === 'pruned' && (
                            <>"{d.content?.slice(0, 100)}" (conf {d.confidence?.toFixed(2)})</>
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
