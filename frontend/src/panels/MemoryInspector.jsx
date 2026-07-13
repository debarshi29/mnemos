import { useState, useEffect } from 'react';
import { getFacts, getFactWithProvenance, triggerConsolidate, ingestSource } from '../api';
import './MemoryInspector.css';

const FILTERS = ['all', 'preference', 'skill', 'status', 'event', 'goal', 'other'];

function confClass(c) {
  return c > 0.7 ? 'conf-high' : c > 0.4 ? 'conf-med' : 'conf-low';
}

export default function MemoryInspector() {
  const [facts, setFacts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [provenance, setProvenance] = useState(null);
  const [filter, setFilter] = useState('all');
  const [consolidating, setConsolidating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ingestSrc, setIngestSrc] = useState('');
  const [ingestKind, setIngestKind] = useState('file');
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState(null);

  const load = () => {
    setLoading(true); setError(null);
    getFacts(false)
      .then(f => { setFacts(f); setLoading(false); })
      .catch(e => { setError(e?.message || 'API unreachable'); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const selectFact = async (fact) => {
    setSelected(fact); setProvenance(null);
    try {
      const data = await getFactWithProvenance(fact.fact_id);
      setProvenance(data);
    } catch {
      setProvenance({ fact: null, source_episodes: [] });
    }
  };

  const consolidate = async () => {
    setConsolidating(true);
    try {
      await triggerConsolidate();
      setSelected(null); setProvenance(null);
      load();
    } catch {}
    setConsolidating(false);
  };

  const ingest = async () => {
    if (!ingestSrc.trim()) return;
    setIngesting(true); setIngestMsg(null);
    try {
      const res = await ingestSource(ingestSrc.trim(), ingestKind);
      setIngestMsg({ ok: true, text: `Ingested ${res.chars?.toLocaleString() ?? '?'} chars. Consolidate to extract facts.` });
      setIngestSrc('');
    } catch (e) {
      setIngestMsg({ ok: false, text: e?.response?.data?.detail || e?.message || 'Ingest failed' });
    }
    setIngesting(false);
  };

  const filtered = facts.filter(f => {
    if (filter === 'all') return true;
    return f.type === filter;
  });

  return (
    <div className="memory">
      <div className="mem-sidebar">
        <div className="mem-head">
          <div className="mem-head-left">
            <span className="mem-title">Memory</span>
            <span className="mem-count">{facts.length} fact{facts.length !== 1 ? 's' : ''}</span>
          </div>
          <button
            className="btn-consolidate"
            onClick={consolidate}
            disabled={consolidating}
          >
            {consolidating ? 'running…' : '↻ consolidate'}
          </button>
        </div>

        <div className="mem-filters">
          {FILTERS.map(f => (
            <button
              key={f}
              className={`filter-pill${filter === f ? ' on' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="ingest-bar">
          <div className="ingest-row">
            <select
              className="ingest-kind"
              value={ingestKind}
              onChange={e => setIngestKind(e.target.value)}
            >
              <option value="file">file</option>
              <option value="github">github</option>
            </select>
            <input
              className="ingest-input"
              placeholder={ingestKind === 'file' ? '/path/to/file.md' : 'github.com/owner/repo'}
              value={ingestSrc}
              onChange={e => setIngestSrc(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ingest()}
            />
            <button
              className="btn-ingest"
              onClick={ingest}
              disabled={ingesting || !ingestSrc.trim()}
            >
              {ingesting ? '…' : '↑'}
            </button>
          </div>
          {ingestMsg && (
            <span
              className="ingest-msg"
              style={{ color: ingestMsg.ok ? 'var(--green)' : 'var(--red)' }}
            >
              {ingestMsg.text}
            </span>
          )}
        </div>

        <div className="fact-list">
          {loading && <p className="state-msg">Loading…</p>}
          {error && <p className="state-msg err">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="state-msg">No facts yet — chat a bit, then consolidate.</p>
          )}
          {filtered.map(f => (
            <div
              key={f.fact_id}
              className={`fact-row${selected?.fact_id === f.fact_id ? ' selected' : ''}`}
              onClick={() => selectFact(f)}
            >
              <div className="fact-text">{f.content}</div>
              <div className="fact-meta-row">
                <span className={`type-badge badge-${f.type || 'other'}`}>{f.type}</span>
                <div className="conf-bar">
                  <div
                    className={`conf-fill ${confClass(Number(f.confidence))}`}
                    style={{ width: `${Math.round(Number(f.confidence) * 100)}%` }}
                  />
                </div>
                <span className="conf-pct">{Math.round(Number(f.confidence) * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!selected ? (
        <div className="mem-empty">Select a fact to inspect its provenance</div>
      ) : (
        <div className="mem-detail">
          <div className="detail-fact">{selected.content}</div>

          <div className="stats-row">
            {[
              { val: `${Math.round(Number(selected.confidence) * 100)}%`, lbl: 'confidence' },
              { val: selected.type,                                         lbl: 'type'       },
              { val: new Date(selected.last_seen).toLocaleDateString(),    lbl: 'last seen'  },
              { val: provenance?.source_episodes?.length ?? '…',           lbl: 'sources'    },
            ].map(({ val, lbl }) => (
              <div key={lbl} className="stat-block">
                <span className="stat-val">{val}</span>
                <span className="stat-lbl">{lbl}</span>
              </div>
            ))}
          </div>

          <div className="section">
            <span className="section-lbl">Source episodes</span>
            {!provenance && <p className="state-msg">Loading…</p>}
            {provenance?.source_episodes?.length === 0 && (
              <p className="state-msg">No source episodes recorded.</p>
            )}
            {provenance?.source_episodes?.map(ep => (
              <div key={ep.episode_id} className="ep-card">
                <span className="ep-meta">
                  {new Date(ep.timestamp).toLocaleString()} · session {ep.session_id.slice(0, 8)}
                </span>
                <div className="ep-text">{ep.text}</div>
              </div>
            ))}
          </div>

          <div className="section">
            <span className="section-lbl">Fact ID</span>
            <span className="fact-id-val">{selected.fact_id}</span>
          </div>
        </div>
      )}
    </div>
  );
}
