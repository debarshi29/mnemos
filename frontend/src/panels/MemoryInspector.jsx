import { useState, useEffect } from 'react';
import { getFacts, getFactWithProvenance, triggerConsolidate, ingestSource } from '../api';
import './MemoryInspector.css';

const FILTERS = ['all', 'preference', 'skill', 'status', 'event', 'goal', 'other'];

function typeClass(t) {
  const known = ['preference', 'skill', 'status', 'event', 'goal'];
  return `fact-type ft-${known.includes(t) ? t : 'other'}`;
}

function ageFmt(ts) {
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  return d === 0 ? 'today' : d === 1 ? '1d' : `${d}d`;
}

export default function MemoryInspector() {
  const [facts, setFacts]         = useState([]);
  const [selected, setSelected]   = useState(null);
  const [prov, setProv]           = useState(null);
  const [filter, setFilter]       = useState('all');
  const [consing, setConsing]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [src, setSrc]             = useState('');
  const [kind, setKind]           = useState('file');
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState(null);

  const load = () => {
    setLoading(true); setError(null);
    getFacts(false)
      .then(f => { setFacts(f); setLoading(false); })
      .catch(e => { setError(e?.message || 'API unreachable'); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const select = async fact => {
    setSelected(fact); setProv(null);
    try { setProv(await getFactWithProvenance(fact.fact_id)); }
    catch { setProv({ source_episodes: [] }); }
  };

  const consolidate = async () => {
    setConsing(true);
    try { await triggerConsolidate(); setSelected(null); setProv(null); load(); } catch {}
    setConsing(false);
  };

  const ingest = async () => {
    if (!src.trim()) return;
    setIngesting(true); setIngestMsg(null);
    try {
      const r = await ingestSource(src.trim(), kind);
      setIngestMsg({ ok: true, text: `${r.chars?.toLocaleString() ?? '?'} chars ingested. Consolidate to extract facts.` });
      setSrc('');
    } catch (e) {
      setIngestMsg({ ok: false, text: e?.response?.data?.detail || e?.message || 'Ingest failed' });
    }
    setIngesting(false);
  };

  const filtered = facts.filter(f => filter === 'all' || f.type === filter);

  return (
    <div className="memory">
      <div className="mem-col">
        <div className="mem-hd">
          <div className="mem-hd-title">
            memory
            <span className="mem-hd-count">{facts.length}</span>
          </div>
          <div className="mem-hd-actions">
            <button className="btn-cons" onClick={consolidate} disabled={consing}>
              {consing ? 'running…' : '↻ consolidate'}
            </button>
          </div>
        </div>

        <div className="ingest-bar">
          <div className="ingest-row">
            <select className="ingest-kind" value={kind} onChange={e => setKind(e.target.value)}>
              <option value="file">file</option>
              <option value="github">github</option>
            </select>
            <input
              className="ingest-src"
              placeholder={kind === 'file' ? '/path/to/file.md' : 'github.com/owner/repo'}
              value={src}
              onChange={e => setSrc(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ingest()}
            />
            <button className="btn-ingest" onClick={ingest} disabled={ingesting || !src.trim()}>
              {ingesting ? '…' : '↑'}
            </button>
          </div>
          {ingestMsg && (
            <span className="ingest-msg" style={{ color: ingestMsg.ok ? 'var(--gr)' : 'var(--re)' }}>
              {ingestMsg.text}
            </span>
          )}
        </div>

        <div className="mem-filters">
          {FILTERS.map(f => (
            <button key={f} className={`fpill${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>

        <div className="fact-list">
          {loading  && <p className="list-msg">Loading…</p>}
          {error    && <p className="list-err">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="list-msg">No facts — chat a bit, then consolidate.</p>
          )}
          {filtered.map(f => (
            <div
              key={f.fact_id}
              className={`fact-row${selected?.fact_id === f.fact_id ? ' sel' : ''}`}
              style={{ '--conf': Number(f.confidence) }}
              onClick={() => select(f)}
            >
              <div className="fact-line1">
                <span className="fact-content">{f.content}</span>
              </div>
              <div className="fact-line2">
                <span className={typeClass(f.type)}>{f.type}</span>
                <span className="fact-conf-num">{Math.round(Number(f.confidence) * 100)}%</span>
                <span className="fact-age">{ageFmt(f.last_seen)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!selected
        ? <div className="mem-empty">select a fact to inspect provenance</div>
        : (
          <div className="mem-detail">
            <span className={`detail-type-label ${typeClass(selected.type)}`}>
              {(selected.type || 'other').toUpperCase()}
            </span>
            <div className="detail-fact">{selected.content}</div>

            <div className="detail-defs">
              {[
                { k: 'CONFIDENCE', v: `${Math.round(Number(selected.confidence) * 100)}%` },
                { k: 'LAST SEEN',  v: new Date(selected.last_seen).toLocaleDateString() },
                { k: 'SOURCES',    v: prov ? (prov.source_episodes?.length ?? 0) : '…' },
                { k: 'FACT ID',    v: selected.fact_id.slice(0, 16) + '…' },
              ].map(({ k, v }) => (
                <div key={k} className="detail-def">
                  <span className="def-k">{k}</span>
                  <span className="def-v">{v}</span>
                </div>
              ))}
            </div>

            <div>
              <div className="sec-label">PROVENANCE</div>
              {!prov && <p className="list-msg">Loading…</p>}
              {prov?.source_episodes?.length === 0 && <p className="list-msg">No source episodes recorded.</p>}
              {prov?.source_episodes?.map(ep => (
                <div key={ep.episode_id} className="ep-card">
                  <span className="ep-meta">
                    {new Date(ep.timestamp).toLocaleString()} · {ep.session_id.slice(0, 8)}
                  </span>
                  <div className="ep-text">{ep.text}</div>
                </div>
              ))}
            </div>
          </div>
        )
      }
    </div>
  );
}
