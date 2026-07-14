import { useState, useEffect } from 'react';
import { getConsolidationLog, triggerConsolidate } from '../api';
import './ConsolidationLog.css';

function fmtWhen(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isYesterday = d.toDateString() === new Date(now - 86400000).toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `today ${time}`;
  if (isYesterday) return `yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function buildLogLines(e) {
  const pad = s => String(s).padStart(3, ' ');
  const lines = [];
  lines.push({ t: `extract    ${pad(e.episodes_processed)} episodes`, c: 'dim' });
  if (e.facts_created > 0 || e.facts_updated > 0) {
    lines.push({ t: `dedupe     ${pad(e.facts_created)} created · ${e.facts_updated} updated`, c: 'dim' });
  } else {
    lines.push({ t: `dedupe       0 changes`, c: 'dim' });
  }
  if (e.contradictions_resolved > 0) {
    lines.push({ t: `contradict ${pad(e.contradictions_resolved)} resolved`, c: 'warn' });
    e.details?.filter(d => d.type === 'contradiction_resolved').slice(0, 2).forEach(d => {
      const kept = d.winner_content?.slice(0, 56) || '';
      lines.push({ t: `           kept "${kept}${kept.length >= 56 ? '…' : ''}"`, c: 'warn' });
    });
  } else {
    lines.push({ t: `contradict   0 conflicts`, c: 'dim' });
  }
  if (e.facts_pruned > 0) {
    lines.push({ t: `prune      ${pad(e.facts_pruned)} archived`, c: 'dim' });
  } else {
    lines.push({ t: `prune        0 archived`, c: 'dim' });
  }
  const total = (e.facts_created ?? 0) + (e.facts_updated ?? 0);
  lines.push({ t: `✓ done     ${pad(total)} facts consolidated`, c: 'ok' });
  return lines;
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
      .then(d => {
        setEntries(d);
        if (d.length > 0) setExpanded(prev => ({ ...prev, [d[0].run_id]: true }));
        setLoading(false);
      })
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
      <div className="sleep-toolbar">
        <span className="sleep-pipeline">
          extract <em>→</em> dedupe <em>→</em> contradict <em>→</em> prune
        </span>
        <button className="btn-run" onClick={runNow} disabled={running}>
          {running ? 'running…' : '▸ run now'}
        </button>
      </div>

      {loading && <p className="sleep-load">loading…</p>}
      {error   && <p className="sleep-err">{error}</p>}

      {!loading && !error && entries.length === 0 && (
        <div className="sleep-empty">
          <span className="sleep-empty-hint">
            no runs yet<br />hit "run now" to start the sleep cycle
          </span>
        </div>
      )}

      {!loading && !error && entries.length > 0 && (
        <div className="sleep-body">
          {entries.map((e, idx) => {
            const open = !!expanded[e.run_id];
            const lines = buildLogLines(e);
            const isLatest = idx === 0;
            return (
              <div key={e.run_id} className={`run${isLatest ? ' latest' : ''}`}>
                <div className="run-hd" onClick={() => toggle(e.run_id)}>
                  <span className="run-marker">{isLatest ? '●' : '○'}</span>
                  <span className="run-id">{e.run_id.slice(0, 8)}</span>
                  <span className="run-when">{fmtWhen(e.timestamp)}</span>
                  <div className="run-stats">
                    <span className="run-stat">ext <span>{e.episodes_processed ?? 0}</span></span>
                    <span className="run-stat">mrg <span>{(e.facts_created ?? 0) + (e.facts_updated ?? 0)}</span></span>
                    <span className={`run-stat${e.contradictions_resolved > 0 ? ' warn' : ''}`}>
                      con <span>{e.contradictions_resolved ?? 0}</span>
                    </span>
                    <span className="run-stat">prn <span>{e.facts_pruned ?? 0}</span></span>
                  </div>
                  <span className="run-chev">{open ? '−' : '+'}</span>
                </div>

                {open && (
                  <div className="run-log">
                    <div className="log-prompt">
                      <span>$</span>
                      <span className="log-prompt-id">mnemos consolidate</span>
                      <span style={{ marginLeft: 'auto', color: 'var(--t4)' }}>{e.run_id.slice(0, 8)}</span>
                    </div>
                    {lines.map((l, i) => (
                      <div key={i} className={`log-line log-${l.c}`}>{l.t}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
