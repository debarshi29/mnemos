import { useState, useEffect } from 'react';
import { getConsolidationLog, triggerConsolidate } from '../api';
import './ConsolidationLog.css';

const STATS = [
  { k: 'episodes_processed',      l: 'eps'      },
  { k: 'facts_created',           l: 'created'  },
  { k: 'facts_updated',           l: 'updated'  },
  { k: 'contradictions_resolved', l: 'resolved' },
  { k: 'facts_pruned',            l: 'pruned'   },
];

function fmtTs(ts) {
  const d = new Date(ts);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function ConsolidationLog() {
  const [entries, setEntries]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [running, setRunning]   = useState(false);
  const [expanded, setExpanded] = useState({});
  const [error, setError]       = useState(null);

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

  const toggle = id => setExpanded(e => ({ ...e, [id]: !e[id] }));

  return (
    <div className="sleep">
      <div className="sleep-bar">
        <span className="sleep-title">Sleep Cycle</span>
        <button className="btn-run" onClick={runNow} disabled={running}>
          {running ? 'running…' : '↻ run now'}
        </button>
      </div>

      {loading && <p className="sleep-load">Loading…</p>}
      {error   && <p className="sleep-err">{error}</p>}

      {!loading && !error && entries.length === 0 && (
        <div className="sleep-empty">
          <span className="sleep-empty-hint">
            No runs yet.<br />
            Hit "run now" to start the sleep cycle.
          </span>
        </div>
      )}

      <div className="run-list">
        {entries.map(e => {
          const total = (e.facts_created ?? 0) + (e.facts_updated ?? 0);
          const pct   = e.episodes_processed > 0
            ? Math.min((total / e.episodes_processed) * 100, 100) : 0;
          const open  = !!expanded[e.run_id];

          return (
            <div key={e.run_id} className="run">
              <div className="run-hd">
                <span className="run-id">{e.run_id.slice(0, 8)}</span>
                <span className="run-ts">{fmtTs(e.timestamp)}</span>
              </div>

              <div className="run-stats">
                {STATS.map(s => (
                  <div key={s.k} className="s-cell">
                    <span className="s-n">{e[s.k] ?? 0}</span>
                    <span className="s-l">{s.l}</span>
                  </div>
                ))}
              </div>

              <div className="run-prog">
                <div className="prog-bar">
                  <div className="prog-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>

              {e.details?.length > 0 && (
                <>
                  <button
                    className={`run-tog${open ? ' open' : ''}`}
                    onClick={() => toggle(e.run_id)}
                  >
                    <span>{open ? '▾' : '▸'}</span>
                    {e.details.length} event{e.details.length !== 1 ? 's' : ''}
                  </button>
                  {open && (
                    <div className="run-events">
                      {e.details.map((d, i) => (
                        <div key={i} className={`ev ${d.type}`}>
                          <span className="ev-type">{d.type.replace(/_/g, ' ')}</span>
                          {d.type === 'contradiction_resolved' && (
                            <span>
                              kept "{d.winner_content?.slice(0, 80)}"
                              {d.loser_content
                                ? <> · dropped "{d.loser_content.slice(0, 80)}"</>
                                : null}
                            </span>
                          )}
                          {d.type === 'pruned' && (
                            <span>"{d.content?.slice(0, 100)}" — conf {d.confidence?.toFixed(2)}</span>
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
