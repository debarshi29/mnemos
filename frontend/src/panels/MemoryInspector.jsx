import { useState, useEffect } from 'react';
import { getFacts, getFactWithProvenance, triggerConsolidate, ingestSource } from '../api';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };

const TYPE_PALETTE = {
  preference: { text: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.25)' },
  skill:      { text: '#38bdf8', bg: 'rgba(56,189,248,0.10)',  border: 'rgba(56,189,248,0.25)'  },
  status:     { text: '#34d399', bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.25)'  },
  event:      { text: '#a78bfa', bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.25)' },
  goal:       { text: '#fb923c', bg: 'rgba(251,146,60,0.10)',  border: 'rgba(251,146,60,0.25)'  },
  other:      { text: '#64748b', bg: 'rgba(100,116,139,0.10)', border: 'rgba(100,116,139,0.25)' },
};

function typePalette(type) { return TYPE_PALETTE[type] || TYPE_PALETTE.other; }

const S = {
  root: { display: 'flex', flex: 1, minHeight: 0, background: '#0f1117', overflow: 'hidden' },

  sidebar: {
    width: 340, flexShrink: 0, borderRight: '1px solid #1e2435',
    display: 'flex', flexDirection: 'column', background: '#111520',
    minHeight: 0, overflow: 'hidden',
  },
  sidebarHead: {
    padding: '1rem 1.25rem 0.85rem',
    borderBottom: '1px solid #1e2435',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  },
  headLeft: { display: 'flex', flexDirection: 'column', gap: '0.1rem' },
  sidebarTitle: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1rem', color: '#e2e8f0' },
  factCount: { ...MONO, fontSize: '0.58rem', color: '#2d3748', letterSpacing: '0.1em', textTransform: 'uppercase' },
  consolidateBtn: (busy) => ({
    ...MONO, fontSize: '0.6rem',
    textTransform: 'uppercase', letterSpacing: '0.12em',
    background: busy ? 'transparent' : 'rgba(245,158,11,0.1)',
    border: `1px solid ${busy ? '#252d3d' : 'rgba(245,158,11,0.3)'}`,
    color: busy ? '#2d3748' : '#f59e0b',
    borderRadius: 99, padding: '0.28rem 0.75rem', cursor: busy ? 'default' : 'pointer',
    transition: 'all 0.12s',
  }),

  filterRow: {
    display: 'flex', flexWrap: 'wrap', gap: '0.35rem', padding: '0.65rem 1.25rem 0.6rem',
    borderBottom: '1px solid #1e2435', flexShrink: 0,
  },
  filterPill: (active) => ({
    ...MONO, fontSize: '0.58rem',
    textTransform: 'uppercase', letterSpacing: '0.1em',
    padding: '0.18rem 0.55rem', borderRadius: 99, cursor: 'pointer',
    background: active ? '#f59e0b' : 'transparent',
    color: active ? '#0f1117' : '#374151',
    border: `1px solid ${active ? '#f59e0b' : '#252d3d'}`,
    transition: 'all 0.12s',
  }),

  ingestBar: {
    borderBottom: '1px solid #1e2435', padding: '0.6rem 1.25rem',
    display: 'flex', flexDirection: 'column', gap: '0.4rem',
    background: '#0f1117', flexShrink: 0,
  },
  ingestRow: { display: 'flex', gap: '0.4rem', alignItems: 'center' },
  ingestKind: {
    ...MONO, fontSize: '0.6rem', background: '#181c2a',
    border: '1px solid #252d3d', borderRadius: 6, padding: '0.32rem 0.5rem',
    color: '#64748b', cursor: 'pointer', outline: 'none',
  },
  ingestInput: {
    flex: 1, ...MONO, fontSize: '0.68rem',
    background: '#181c2a', border: '1px solid #252d3d', borderRadius: 6,
    padding: '0.32rem 0.65rem', color: '#e2e8f0', outline: 'none',
    transition: 'border-color 0.12s',
  },
  ingestBtn: (busy) => ({
    ...MONO, fontSize: '0.6rem',
    textTransform: 'uppercase', letterSpacing: '0.1em',
    padding: '0.32rem 0.75rem', borderRadius: 6, cursor: busy ? 'default' : 'pointer',
    background: busy ? 'transparent' : 'rgba(245,158,11,0.1)',
    border: `1px solid ${busy ? '#252d3d' : 'rgba(245,158,11,0.3)'}`,
    color: busy ? '#2d3748' : '#f59e0b', transition: 'all 0.12s',
  }),
  ingestMsg: { ...MONO, fontSize: '0.62rem' },

  factList: { flex: 1, overflowY: 'auto', padding: '0.4rem 0' },
  factItem: (selected, flagged) => ({
    padding: '0.7rem 1.25rem', cursor: 'pointer',
    borderLeft: `3px solid ${selected ? '#f59e0b' : 'transparent'}`,
    background: selected ? 'rgba(245,158,11,0.05)' : 'transparent',
    opacity: flagged ? 0.7 : 1,
    transition: 'background 0.1s, border-color 0.1s',
  }),
  factContent: { fontSize: '0.875rem', lineHeight: 1.45, color: '#e2e8f0', marginBottom: '0.35rem' },
  factMeta: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  typeBadge: (type) => {
    const p = typePalette(type);
    return {
      ...MONO, fontSize: '0.54rem', textTransform: 'uppercase', letterSpacing: '0.1em',
      color: p.text, background: p.bg, border: `1px solid ${p.border}`,
      borderRadius: 99, padding: '0.1rem 0.45rem',
    };
  },
  confBar: { flex: 1, height: 5, background: '#1e2435', borderRadius: 99, overflow: 'hidden' },
  confFill: (conf) => ({
    height: '100%', borderRadius: 99,
    width: `${Math.round(conf * 100)}%`,
    background: conf > 0.7 ? '#f59e0b' : conf > 0.4 ? '#b45309' : '#374151',
    transition: 'width 0.3s ease',
  }),
  confPct: { ...MONO, fontSize: '0.54rem', color: '#2d3748', minWidth: 28, textAlign: 'right' },
  flagBadge: {
    ...MONO, fontSize: '0.52rem', color: '#f59e0b',
    background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
    borderRadius: 99, padding: '0.1rem 0.4rem',
  },

  detail: {
    flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.75rem 2rem',
    display: 'flex', flexDirection: 'column', gap: '1.5rem',
  },
  empty: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#2d3748', fontSize: '0.85rem', fontStyle: 'italic',
  },
  detailTitle: {
    fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1.2rem',
    lineHeight: 1.4, color: '#e2e8f0',
  },
  conflictNote: {
    marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.65rem', color: '#f59e0b',
  },
  statsRow: { display: 'flex', gap: '1.75rem', flexWrap: 'wrap' },
  stat: { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  statVal: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1.15rem', color: '#f59e0b' },
  statLabel: { ...MONO, fontSize: '0.56rem', color: '#2d3748', textTransform: 'uppercase', letterSpacing: '0.1em' },
  section: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  sectionLabel: { ...MONO, fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.14em', color: '#2d3748' },
  episodeCard: {
    background: '#181c2a', border: '1px solid #1e2435', borderRadius: 10,
    padding: '0.85rem 1rem',
  },
  episodeMeta: {
    ...MONO, fontSize: '0.58rem', color: '#2d3748', letterSpacing: '0.06em',
    marginBottom: '0.5rem', display: 'block',
  },
  episodeText: { fontSize: '0.85rem', lineHeight: 1.6, color: '#94a3b8' },
  factId: { ...MONO, fontSize: '0.65rem', color: '#1e2d40', wordBreak: 'break-all' },
};

const FILTERS = ['all', 'preference', 'skill', 'status', 'event', 'goal', 'flagged'];

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
      setSelected(null);
      setProvenance(null);
      load();
    } catch {}
    setConsolidating(false);
  };

  const ingest = async () => {
    if (!ingestSrc.trim()) return;
    setIngesting(true); setIngestMsg(null);
    try {
      const res = await ingestSource(ingestSrc.trim(), ingestKind);
      setIngestMsg({ ok: true, text: `✓ Ingested (${res.chars?.toLocaleString() ?? '?'} chars). Consolidate to extract facts.` });
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
      <div style={S.sidebar}>
        <div style={S.sidebarHead}>
          <div style={S.headLeft}>
            <span style={S.sidebarTitle}>Memory</span>
            <span style={S.factCount}>{facts.length} fact{facts.length !== 1 ? 's' : ''}</span>
          </div>
          <button style={S.consolidateBtn(consolidating)} onClick={consolidate} disabled={consolidating}>
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
              onFocus={e => e.target.style.borderColor = '#374151'}
              onBlur={e => e.target.style.borderColor = '#252d3d'}
            />
            <button style={S.ingestBtn(ingesting)} onClick={ingest} disabled={ingesting}>
              {ingesting ? '…' : '↑'}
            </button>
          </div>
          {ingestMsg && (
            <span style={{ ...S.ingestMsg, color: ingestMsg.ok ? '#34d399' : '#f87171' }}>
              {ingestMsg.text}
            </span>
          )}
        </div>

        <div style={S.factList}>
          {loading && <p style={{ padding: '1rem 1.25rem', color: '#2d3748', fontSize: '0.85rem' }}>Loading…</p>}
          {error && (
            <p style={{ padding: '1rem 1.25rem', color: '#f87171', fontSize: '0.78rem', ...MONO }}>
              ✗ {error}<br />
              <span style={{ color: '#2d3748' }}>Is the backend running?</span>
            </p>
          )}
          {!loading && !error && filtered.length === 0 && (
            <p style={{ padding: '1.25rem', color: '#2d3748', fontSize: '0.85rem', fontStyle: 'italic' }}>
              No facts yet — chat a bit, then consolidate.
            </p>
          )}
          {filtered.map(f => (
            <div
              key={f.fact_id}
              style={S.factItem(selected?.fact_id === f.fact_id, f.flagged)}
              onClick={() => selectFact(f)}
              onMouseEnter={e => { if (selected?.fact_id !== f.fact_id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
              onMouseLeave={e => { if (selected?.fact_id !== f.fact_id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={S.factContent}>{f.content}</div>
              <div style={S.factMeta}>
                <span style={S.typeBadge(f.type)}>{f.type}</span>
                <div style={S.confBar}>
                  <div style={S.confFill(Number(f.confidence))} />
                </div>
                <span style={S.confPct}>{Math.round(Number(f.confidence) * 100)}%</span>
                {f.flagged && <span style={S.flagBadge}>⚑</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {!selected ? (
        <div style={S.empty}>← select a fact to inspect its provenance</div>
      ) : (
        <div style={S.detail}>
          <div>
            <div style={S.detailTitle}>{selected.content}</div>
            {selected.flagged && (
              <div style={S.conflictNote}>⚑ Flagged — conflicts with another fact. Both kept pending review.</div>
            )}
          </div>

          <div style={S.statsRow}>
            {[
              { val: `${Math.round(Number(selected.confidence) * 100)}%`, label: 'confidence' },
              { val: selected.type, label: 'type' },
              { val: new Date(selected.last_seen).toLocaleDateString(), label: 'last seen' },
              { val: provenance?.source_episodes?.length ?? '…', label: 'sources' },
            ].map(({ val, label }) => (
              <div key={label} style={S.stat}>
                <span style={S.statVal}>{val}</span>
                <span style={S.statLabel}>{label}</span>
              </div>
            ))}
          </div>

          <div style={S.section}>
            <span style={S.sectionLabel}>Provenance — source episodes</span>
            {!provenance && <p style={{ color: '#2d3748', fontSize: '0.85rem', fontStyle: 'italic' }}>Loading…</p>}
            {provenance?.source_episodes?.length === 0 && (
              <p style={{ color: '#2d3748', fontSize: '0.85rem', fontStyle: 'italic' }}>No source episodes recorded.</p>
            )}
            {provenance?.source_episodes?.map(ep => (
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
            <span style={S.factId}>{selected.fact_id}</span>
          </div>
        </div>
      )}
    </div>
  );
}
