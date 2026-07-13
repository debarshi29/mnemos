import { useState, useEffect } from 'react';
import { getConsolidationLog, triggerConsolidate } from '../api';
import './ConsolidationLog.css';

const STATS = [
  { key: 'episodes_processed',      label: 'episodes' },
  { key: 'facts_created',           label: 'created'  },
  { key: 'facts_updated',           label: 'updated'  },
  { key: 'contradictions_resolved', label: 'resolved' },
  { key: 'facts_pruned',            label: 'pruned'   },
];

function fmtTs(ts) {
  const d = new Date(ts);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function ConsolidationLog() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true); setError(null);
    getConsolidationLog()
      .then(d => { setEntries(d); setLoading(false); })
      .catch(e => { setError(e?.message || 'API unreachable'); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const runNow = async () => {
    setRunning(true);
    try { await triggerConsolidate(); load(); } catch {}
    setRunning(false);
  };

  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  return (
    <div className="sleep-cycle">
      <div className="cycle-header">
        <span className="cycle-title">Sleep Cycle</span>
        <button className="btn-run" onClick={runNow} disabled={running}>
          {running ? 'running…' : '↻ run now'}
        </button>
      </div>

      {loading && <p className="cycle-loading">Loading…</p>}
      {error   && <p className="cycle-error">{error}</p>}

      {!loading && !error && entries.length === 0 && (
        <div className="cycle-empty">
          <span className="cycle-empty-icon">◉</span>
          <span className="cycle-empty-text">
            No consolidation runs yet.<br />
            Hit "run now" to start the sleep cycle.
          </span>
        </div>
      )}

      <div className="cycle-list">
        {entries.map(e => {
          const total = (e.facts_created ?? 0) + (e.facts_updated ?? 0);
          const pct = e.episodes_processed > 0
            ? Math.min((total / e.episodes_processed) * 100, 100)
            : 0;
          const isOpen = !!expanded[e.run_id];

          return (
            <div key={e.run_id} className="run-card">
              <div className="run-head">
                <span className="run-id">run · {e.run_id.slice(0, 8)}</span>
                <span className="run-ts">{fmtTs(e.timestamp)}</span>
              </div>

              <div className="run-stats">
                {STATS.map(s => (
                  <div key={s.key} className="stat-cell">
                    <span className="stat-num">{e[s.key] ?? 0}</span>
                    <span className="stat-lbl">{s.label}</span>
                  </div>
                ))}
              </div>

              <div className="run-bar-wrap">
                <div className="run-bar">
                  <div className="run-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>

              {e.details?.length > 0 && (
                <>
                  <button
                    className={`run-toggle${isOpen ? ' open' : ''}`}
                    onClick={() => toggle(e.run_id)}
                  >
                    <span>{isOpen ? '▾' : '▸'}</span>
                    {e.details.length} event{e.details.length !== 1 ? 's' : ''}
                  </button>
                  {isOpen && (
                    <div className="run-events">
                      {e.details.map((d, i) => (
                        <div key={i} className={`event-item type-${d.type}`}>
                          <span className="event-type">{d.type.replace(/_/g, ' ')}</span>
                          {d.type === 'contradiction_resolved' && (
                            <span>
                              kept "{d.winner_content?.slice(0, 80)}"
                              {d.loser_content
                                ? <> · dropped "{d.loser_content.slice(0, 80)}"</>
                                : null}
                            </span>
                          )}
                          {d.type === 'pruned' && (
                            <span>
                              "{d.content?.slice(0, 100)}" — conf {d.confidence?.toFixed(2)}
                            </span>
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
