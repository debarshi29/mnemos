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
  const lines = [];
  const pad = s => String(s).padStart(2, ' ');
  lines.push({ t: `extract     ${pad(e.episodes_processed)} episodes processed`, c: 'dim' });
  if (e.facts_created > 0 || e.facts_updated > 0) {
    lines.push({ t: `dedupe      ${pad(e.facts_created)} created · ${e.facts_updated} updated`, c: 'dim' });
  }
  if (e.contradictions_resolved > 0) {
    lines.push({ t: `contradict  ${pad(e.contradictions_resolved)} contradiction${e.contradictions_resolved !== 1 ? 's' : ''} resolved`, c: 'warn' });
    e.details?.filter(d => d.type === 'contradiction_resolved').slice(0, 2).forEach(d => {
      const kept = d.winner_content?.slice(0, 60) || '';
      lines.push({ t: `            kept "${kept}${kept.length >= 60 ? '…' : ''}"`, c: 'warn' });
    });
  } else {
    lines.push({ t: `contradict  0 conflicts`, c: 'dim' });
  }
  if (e.facts_pruned > 0) {
    lines.push({ t: `prune       ${pad(e.facts_pruned)} fact${e.facts_pruned !== 1 ? 's' : ''} below confidence floor → archived`, c: 'dim' });
  } else {
    lines.push({ t: `prune       0 archived`, c: 'dim' });
  }
  const total = (e.facts_created ?? 0) + (e.facts_updated ?? 0);
  lines.push({ t: `done        ${total} facts consolidated`, c: 'ok' });
  return lines;
}

function sevenDayAgg(entries) {
  const cutoff = Date.now() - 7 * 86400000;
  const recent = entries.filter(e => new Date(e.timestamp).getTime() > cutoff);
  return {
    eps:  recent.reduce((s, e) => s + (e.episodes_processed ?? 0), 0),
    mrg:  recent.reduce((s, e) => s + (e.facts_created ?? 0) + (e.facts_updated ?? 0), 0),
    con:  recent.reduce((s, e) => s + (e.contradictions_resolved ?? 0), 0),
    prn:  recent.reduce((s, e) => s + (e.facts_pruned ?? 0), 0),
  };
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

  const agg = sevenDayAgg(entries);

  return (
    <div className="sleep">
      <div className="sleep-hd">
        <span className="sleep-hd-num">04</span>
        <span className="sleep-hd-title">Sleep Cycle</span>
        <span className="sleep-hd-meta">extract → dedupe → contradict → prune</span>
        <button className="btn-run" onClick={runNow} disabled={running}>
          {running ? 'running…' : '▸ RUN NOW'}
        </button>
      </div>

      {loading && <p className="sleep-load">Loading…</p>}
      {error   && <p className="sleep-err">{error}</p>}

      {!loading && !error && entries.length === 0 && (
        <div className="sleep-empty">
          <span className="sleep-empty-hint">
            No runs yet.<br />
            Hit "RUN NOW" to start the sleep cycle.
          </span>
        </div>
      )}

      {!loading && !error && entries.length > 0 && (
        <div className="sleep-body">
          {/* 7-day aggregate */}
          <div className="agg-grid">
            <div className="agg-cell">
              <span className="agg-n">{agg.eps}</span>
              <span className="agg-l">EXTRACTED · 7D</span>
            </div>
            <div className="agg-cell">
              <span className="agg-n">{agg.mrg}</span>
              <span className="agg-l">MERGED · 7D</span>
            </div>
            <div className="agg-cell">
              <span className="agg-n">{agg.con}</span>
              <span className="agg-l">CONTRADICTIONS · 7D</span>
            </div>
            <div className="agg-cell">
              <span className="agg-n">{agg.prn}</span>
              <span className="agg-l">PRUNED · 7D</span>
            </div>
          </div>

          {/* Run rows */}
          <div className="run-list">
            {entries.map(e => {
              const open = !!expanded[e.run_id];
              const lines = buildLogLines(e);
              return (
                <div key={e.run_id} className="run">
                  <div className="run-hd" onClick={() => toggle(e.run_id)}>
                    <span className="run-id">{e.run_id.slice(0, 8)}</span>
                    <span className="run-when">{fmtWhen(e.timestamp)}</span>
                    <div className="run-stats-inline">
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
                      {lines.map((l, i) => (
                        <div key={i} className={`log-line log-${l.c}`}>{l.t}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
