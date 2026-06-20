import { useState, useEffect } from 'react';
import { getFacts, getFactWithProvenance, triggerConsolidate, ingestSource } from '../api';

const LABEL = {
  fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem',
  textTransform: 'uppercase', letterSpacing: '0.16em', color: '#9ab09a',
};

const TYPE_COLORS = {
  preference: '#8aa83f', status: '#c5e063', event: '#9ab09a',
  skill: '#c5e063', goal: '#8aa83f', other: '#9ab09a',
};

const S = {
  root: { display: 'flex', flex: 1, minHeight: 0, background: '#101a13', overflow: 'hidden' },

  list: {
    width: 320, flexShrink: 0, borderRight: '1px solid #2b4231',
    display: 'flex', flexDirection: 'column', background: '#16241a',
    minHeight: 0, overflow: 'hidden',
  },
  listHeader: {
    padding: '1.25rem 1.25rem 0.75rem',
    borderBottom: '1px solid #2b4231',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  listTitle: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1rem' },
  consolidateBtn: {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem',
    textTransform: 'uppercase', letterSpacing: '0.12em',
    background: 'rgba(197,224,99,0.1)', border: '1px solid rgba(197,224,99,0.25)',
    color: '#c5e063', borderRadius: 99, padding: '0.25rem 0.65rem', cursor: 'pointer',
  },
  filterRow: {
    display: 'flex', flexWrap: 'wrap', gap: '0.4rem', padding: '0.65rem 1.25rem',
    borderBottom: '1px solid #2b4231',
  },
  filterPill: (active) => ({
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem',
    textTransform: 'uppercase', letterSpacing: '0.1em',
    padding: '0.2rem 0.6rem', borderRadius: 99, cursor: 'pointer',
    background: active ? '#c5e063' : 'transparent',
    color: active ? '#101a13' : '#9ab09a',
    border: `1px solid ${active ? '#c5e063' : '#2b4231'}`,
    transition: 'all 0.12s',
  }),
  factList: { flex: 1, overflowY: 'auto', padding: '0.75rem 0' },
  factItem: (selected, flagged) => ({
    padding: '0.75rem 1.25rem', cursor: 'pointer',
    borderLeft: `3px solid ${selected ? '#c5e063' : 'transparent'}`,
    background: selected ? 'rgba(197,224,99,0.05)' : 'transparent',
    transition: 'all 0.1s',
    opacity: flagged ? 0.75 : 1,
  }),
  factContent: { fontSize: '0.88rem', lineHeight: 1.45, color: '#e9efe4', marginBottom: '0.3rem' },
  factMeta: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  typeBadge: (type) => ({
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.55rem',
    textTransform: 'uppercase', letterSpacing: '0.12em',
    color: TYPE_COLORS[type] || '#9ab09a',
    background: `${TYPE_COLORS[type] || '#9ab09a'}18`,
    border: `1px solid ${TYPE_COLORS[type] || '#9ab09a'}33`,
    borderRadius: 99, padding: '0.1rem 0.45rem',
  }),
  confBar: { flex: 1, height: 3, background: '#2b4231', borderRadius: 99, overflow: 'hidden' },
  confFill: (conf) => ({
    height: '100%', borderRadius: 99,
    width: `${conf * 100}%`,
    background: `linear-gradient(90deg, #8aa83f, #c5e063)`,
  }),
  ingestBar: {
    borderBottom: '1px solid #2b4231', padding: '0.6rem 1.25rem',
    display: 'flex', flexDirection: 'column', gap: '0.4rem', background: '#13201a',
  },
  ingestRow: { display: 'flex', gap: '0.4rem', alignItems: 'center' },
  ingestInput: {
    flex: 1, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.7rem',
    background: '#1c2e21', border: '1px solid #2b4231', borderRadius: 6,
    padding: '0.3rem 0.6rem', color: '#e9efe4', outline: 'none',
  },
  ingestKind: {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem', background: '#1c2e21',
    border: '1px solid #2b4231', borderRadius: 6, padding: '0.3rem 0.5rem',
    color: '#9ab09a', cursor: 'pointer', outline: 'none',
  },
  ingestBtn: (busy) => ({
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem',
    textTransform: 'uppercase', letterSpacing: '0.1em',
    padding: '0.3rem 0.7rem', borderRadius: 6, cursor: busy ? 'default' : 'pointer',
    background: busy ? '#2b4231' : 'rgba(197,224,99,0.12)',
    border: '1px solid rgba(197,224,99,0.3)', color: busy ? '#9ab09a' : '#c5e063',
  }),
  ingestMsg: { fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.65rem' },
  flagBadge: {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.55rem',
    color: '#e9efe4', background: 'rgba(233,239,228,0.1)',
    border: '1px solid rgba(233,239,228,0.2)',
    borderRadius: 99, padding: '0.1rem 0.4rem',
  },

  detail: {
    flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.5rem',
    display: 'flex', flexDirection: 'column', gap: '1.25rem',
  },
  empty: {
    flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#9ab09a', fontStyle: 'italic', fontSize: '0.9rem',
  },
  detailTitle: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1.15rem', lineHeight: 1.4 },
  section: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  sectionLabel: LABEL,
  episodeCard: {
    background: '#1c2e21', border: '1px solid #2b4231', borderRadius: 10,
    padding: '0.75rem 1rem',
  },
  episodeMeta: {
    ...LABEL, color: '#8aa83f', marginBottom: '0.4rem', display: 'block',
  },
  episodeText: { fontSize: '0.85rem', lineHeight: 1.55, color: '#e9efe4' },
  statRow: { display: 'flex', gap: '1.5rem' },
  stat: { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  statVal: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1.1rem', color: '#c5e063' },
  statLabel: LABEL,
};

const FILTERS = ['all', 'preference', 'skill', 'status', 'event', 'flagged'];

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
    setLoading(true);
    setError(null);
    getFacts(false)
      .then(f => { setFacts(f); setLoading(false); })
      .catch(e => { setError(e?.message || 'API unreachable'); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const select = async (fact) => {
    setSelected(fact);
    setProvenance(null);
    try {
      const data = await getFactWithProvenance(fact.fact_id);
      setProvenance(data);
    } catch (err) {
      console.error('provenance fetch failed:', err);
      setProvenance({ fact: null, source_episodes: [] });
    }
  };

  const consolidate = async () => {
    setConsolidating(true);
    try { await triggerConsolidate(); load(); } catch {}
    setConsolidating(false);
  };

  const ingest = async () => {
    if (!ingestSrc.trim()) return;
    setIngesting(true);
    setIngestMsg(null);
    try {
      const res = await ingestSource(ingestSrc.trim(), ingestKind);
      setIngestMsg({ ok: true, text: `✓ Ingested "${res.label}" (${res.chars.toLocaleString()} chars). Run consolidate to extract facts.` });
      setIngestSrc('');
    } catch (e) {
      setIngestMsg({ ok: false, text: `✗ ${e?.response?.data?.detail || e?.message || 'Ingest failed'}` });
    }
    setIngesting(false);
  };

  const filtered = facts.filter(f => {
    if (filter === 'all') return true;
    if (filter === 'flagged') return f.flagged;
    return f.type === filter;
  });

  return (
    <div style={S.root}>
      {/* Left: fact list */}
      <div style={S.list}>
        <div style={S.listHeader}>
          <span style={S.listTitle}>Memory</span>
          <button style={S.consolidateBtn} onClick={consolidate} disabled={consolidating}>
            {consolidating ? 'running…' : '↻ consolidate'}
          </button>
        </div>

        <div style={S.filterRow}>
          {FILTERS.map(f => (
            <button key={f} style={S.filterPill(filter === f)} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>

        <div style={S.ingestBar}>
          <div style={S.ingestRow}>
            <select style={S.ingestKind} value={ingestKind} onChange={e => setIngestKind(e.target.value)}>
              <option value="file">file</option>
              <option value="github">github</option>
            </select>
            <input
              style={S.ingestInput}
              placeholder={ingestKind === 'file' ? '/path/to/file.md' : 'https://github.com/owner/repo'}
              value={ingestSrc}
              onChange={e => setIngestSrc(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ingest()}
            />
            <button style={S.ingestBtn(ingesting)} onClick={ingest} disabled={ingesting}>
              {ingesting ? '…' : '↑ ingest'}
            </button>
          </div>
          {ingestMsg && (
            <span style={{ ...S.ingestMsg, color: ingestMsg.ok ? '#8aa83f' : '#e05555' }}>
              {ingestMsg.text}
            </span>
          )}
        </div>

        <div style={S.factList}>
          {loading && <p style={{ padding: '1rem 1.25rem', color: '#9ab09a', fontSize: '0.85rem' }}>Loading…</p>}
          {error && (
            <p style={{ padding: '1rem 1.25rem', color: '#e05555', fontSize: '0.8rem', fontFamily: "'IBM Plex Mono', monospace" }}>
              ✗ {error}<br />
              <span style={{ color: '#9ab09a' }}>Is the backend running?</span>
            </p>
          )}
          {!loading && !error && filtered.length === 0 && (
            <p style={{ padding: '1rem 1.25rem', color: '#9ab09a', fontSize: '0.85rem', fontStyle: 'italic' }}>
              No facts yet — chat a bit, then consolidate.
            </p>
          )}
          {filtered.map(f => (
            <div key={f.fact_id} style={S.factItem(selected?.fact_id === f.fact_id, f.flagged)} onClick={() => select(f)}>
              <div style={{ ...S.factContent, pointerEvents: 'none' }}>{f.content}</div>
              <div style={{ ...S.factMeta, pointerEvents: 'none' }}>
                <span style={S.typeBadge(f.type)}>{f.type}</span>
                <div style={S.confBar}>
                  <div style={S.confFill(Number(f.confidence))} />
                </div>
                {f.flagged && <span style={S.flagBadge}>⚑ conflict</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: detail / provenance */}
      {!selected ? (
        <div style={S.empty}>← select a fact to inspect its provenance</div>
      ) : (
        <div style={S.detail}>
          <div>
            <div style={S.detailTitle}>{selected.content}</div>
            {selected.flagged && (
              <div style={{ marginTop: '0.5rem', color: '#c5e063', fontSize: '0.8rem', fontStyle: 'italic' }}>
                ⚑ This fact conflicts with another — both kept pending manual review.
              </div>
            )}
          </div>

          <div style={S.statRow}>
            <div style={S.stat}>
              <span style={S.statVal}>{(Number(selected.confidence) * 100).toFixed(0)}%</span>
              <span style={S.statLabel}>confidence</span>
            </div>
            <div style={S.stat}>
              <span style={S.statVal}>{selected.type}</span>
              <span style={S.statLabel}>type</span>
            </div>
            <div style={S.stat}>
              <span style={S.statVal}>{new Date(selected.last_seen).toLocaleDateString()}</span>
              <span style={S.statLabel}>last seen</span>
            </div>
            <div style={S.stat}>
              <span style={S.statVal}>{provenance?.source_episodes?.length ?? '…'}</span>
              <span style={S.statLabel}>sources</span>
            </div>
          </div>

          <div style={S.section}>
            <span style={S.sectionLabel}>Provenance — source episodes</span>
            {!provenance && <p style={{ color: '#9ab09a', fontSize: '0.85rem', fontStyle: 'italic' }}>Loading…</p>}
            {provenance?.source_episodes?.length === 0 && (
              <p style={{ color: '#9ab09a', fontSize: '0.85rem', fontStyle: 'italic' }}>No source episodes recorded.</p>
            )}
            {provenance?.source_episodes?.map((ep, i) => (
              <div key={ep.episode_id} style={S.episodeCard}>
                <span style={S.episodeMeta}>
                  {new Date(ep.timestamp).toLocaleString()} · session {ep.session_id.slice(0, 8)}
                </span>
                <div style={S.episodeText}>{ep.text}</div>
              </div>
            ))}
          </div>

          <div style={S.section}>
            <span style={S.sectionLabel}>Fact ID</span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.7rem', color: '#9ab09a' }}>
              {selected.fact_id}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
