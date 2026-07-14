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

function confColor(conf) {
  const c = Math.max(0, Math.min(1, Number(conf)));
  const s = Math.round(c * 100);
  const l = Math.round(18 + c * 32);
  return `hsl(180,${s}%,${l}%)`;
}

export default function MemoryInspector() {
  const [facts, setFacts]         = useState([]);
  const [filter, setFilter]       = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [provMap, setProvMap]     = useState({});
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

  const toggle = async fact => {
    if (expandedId === fact.fact_id) { setExpandedId(null); return; }
    setExpandedId(fact.fact_id);
    if (!provMap[fact.fact_id]) {
      try {
        const p = await getFactWithProvenance(fact.fact_id);
        setProvMap(pm => ({ ...pm, [fact.fact_id]: p }));
      } catch {
        setProvMap(pm => ({ ...pm, [fact.fact_id]: { source_episodes: [] } }));
      }
    }
  };

  const consolidate = async () => {
    setConsing(true);
    try { await triggerConsolidate(); setExpandedId(null); load(); } catch {}
    setConsing(false);
  };

  const ingest = async () => {
    if (!src.trim()) return;
    setIngesting(true); setIngestMsg(null);
    try {
      const r = await ingestSource(src.trim(), kind);
      setIngestMsg({ ok: true, text: `${r.chars?.toLocaleString() ?? '?'} chars ingested` });
      setSrc('');
    } catch (e) {
      setIngestMsg({ ok: false, text: e?.response?.data?.detail || e?.message || 'ingest failed' });
    }
    setIngesting(false);
  };

  const filtered = facts.filter(f => filter === 'all' || f.type === filter);

  return (
    <div className="memory">
      <div className="mem-toolbar">
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
          {ingesting ? '…' : '↑ ingest'}
        </button>
        {ingestMsg && (
          <span className="ingest-msg" style={{ color: ingestMsg.ok ? 'var(--gr)' : 'var(--re)', fontFamily: 'var(--fm)', fontSize: 'var(--tx)' }}>
            {ingestMsg.text}
          </span>
        )}

        <div className="tb-divider" />

        {FILTERS.map(f => (
          <button key={f} className={`fpill${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}

        <button className="btn-cons" onClick={consolidate} disabled={consing}>
          {consing ? 'running…' : '↻ consolidate'}
        </button>
      </div>

      <div className="fact-thead">
        <span>TYPE</span>
        <span>CONTENT</span>
        <span style={{ textAlign: 'right' }}>CONFIDENCE</span>
        <span style={{ textAlign: 'right' }}>AGE</span>
      </div>

      <div className="fact-list">
        {loading  && <p className="list-msg">loading…</p>}
        {error    && <p className="list-err">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="list-msg">no facts — chat a bit, then consolidate</p>
        )}

        {filtered.map(f => {
          const isExp = expandedId === f.fact_id;
          const prov  = provMap[f.fact_id];
          return (
            <div key={f.fact_id}>
              <div
                className={`fact-row${isExp ? ' exp' : ''}`}
                style={{ '--conf-color': confColor(f.confidence) }}
                onClick={() => toggle(f)}
              >
                <span className={typeClass(f.type)}>{f.type}</span>
                <span className="fact-content">{f.content}</span>
                <span className="fact-conf">{Math.round(Number(f.confidence) * 100)}%</span>
                <span className="fact-age">{ageFmt(f.last_seen)}</span>
              </div>

              {isExp && (
                <div className="fact-expand">
                  <div className="expand-inner">
                    <div className="expand-fact">{f.content}</div>

                    <div className="expand-meta">
                      {[
                        { k: 'CONFIDENCE', v: `${Math.round(Number(f.confidence) * 100)}%` },
                        { k: 'LAST SEEN',  v: new Date(f.last_seen).toLocaleDateString() },
                        { k: 'SOURCES',    v: prov ? (prov.source_episodes?.length ?? 0) : '…' },
                        { k: 'FACT ID',    v: f.fact_id.slice(0, 12) + '…' },
                      ].map(({ k, v }) => (
                        <div key={k} className="expand-kv">
                          <span className="expand-k">{k}</span>
                          <span className="expand-v">{v}</span>
                        </div>
                      ))}
                    </div>

                    <div>
                      <div className="expand-prov-label">PROVENANCE</div>
                      {!prov && <p className="list-msg" style={{ padding: '8px 0' }}>loading…</p>}
                      {prov?.source_episodes?.length === 0 && (
                        <p className="list-msg" style={{ padding: '8px 0' }}>no source episodes recorded</p>
                      )}
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
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
