import { useState, useEffect } from 'react';
import { getFacts, getFactWithProvenance, triggerConsolidate, ingestSource } from '../api';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };

const TYPE_PALETTE = {
  preference: { text: '#f0c060', bg: 'rgba(240,192,96,0.10)', border: 'rgba(240,192,96,0.25)' },
  skill:      { text: '#6ec6f0', bg: 'rgba(110,198,240,0.10)', border: 'rgba(110,198,240,0.25)' },
  status:     { text: '#c5e063', bg: 'rgba(197,224,99,0.10)',  border: 'rgba(197,224,99,0.25)'  },
  event:      { text: '#a78bfa', bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.25)' },
  goal:       { text: '#f4a261', bg: 'rgba(244,162,97,0.10)',  border: 'rgba(244,162,97,0.25)'  },
  other:      { text: '#9ab09a', bg: 'rgba(154,176,154,0.10)', border: 'rgba(154,176,154,0.25)' },
};

function typePalette(type) { return TYPE_PALETTE[type] || TYPE_PALETTE.other; }

const S = {
  root: { display: 'flex', flex: 1, minHeight: 0, background: '#101a13', overflow: 'hidden' },

  sidebar: {
    width: 340, flexShrink: 0, borderRight: '1px solid #1f3326',
    display: 'flex', flexDirection: 'column', background: '#13201a',
    minHeight: 0, overflow: 'hidden',
  },
  sidebarHead: {
    padding: '1rem 1.25rem 0.85rem',
    borderBottom: '1px solid #1f3326',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  },
  headLeft: { display: 'flex', flexDirection: 'column', gap: '0.1rem' },
  sidebarTitle: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1rem', color: '#e9efe4' },
  factCount: { ...MONO, fontSize: '0.58rem', color: '#4a6b50', letterSpacing: '0.1em', textTransform: 'uppercase' },
  consolidateBtn: (busy) => ({
    ...MONO, fontSize: '0.6rem',
    textTransform: 'uppercase', letterSpacing: '0.12em',
    background: busy ? 'transparent' : 'rgba(197,224,99,0.1)',
    border: `1px solid ${busy ? '#2b4231' : 'rgba(197,224,99,0.3)'}`,
    color: busy ? '#4a6b50' : '#c5e063',
    borderRadius: 99, padding: '0.28rem 0.75rem', cursor: busy ? 'default' : 'pointer',
    transition: 'all 0.12s',
  }),

  filterRow: {
    display: 'flex', flexWrap: 'wrap', gap: '0.35rem', padding: '0.65rem 1.25rem 0.6rem',
    borderBottom: '1px solid #1f3326', flexShrink: 0,
  },
  filterPill: (active) => ({
    ...MONO, fontSize: '0.58rem',
    textTransform: 'uppercase', letterSpacing: '0.1em',
    padding: '0.18rem 0.55rem', borderRadius: 99, cursor: 'pointer',
    background: active ? '#c5e063' : 'transparent',
    color: active ? '#101a13' : '#6b8870',
    border: `1px solid ${active ? '#c5e063' : '#2b4231'}`,
    transition: 'all 0.12s',
  }),

  ingestBar: {
    borderBottom: '1px solid #1f3326', padding: '0.6rem 1.25rem',
    display: 'flex', flexDirection: 'column', gap: '0.4rem',
    background: '#101a13', flexShrink: 0,
  },
  ingestRow: { display: 'flex', gap: '0.4rem', alignItems: 'center' },
  ingestKind: {
    ...MONO, fontSize: '0.6rem', background: '#16241a',
    border: '1px solid #2b4231', borderRadius: 6, padding: '0.32rem 0.5rem',
    color: '#9ab09a', cursor: 'pointer', outline: 'none',
  },
  ingestInput: {
    flex: 1, ...MONO, fontSize: '0.68rem',
    background: '#16241a', border: '1px solid #2b4231', borderRadius: 6,
    padding: '0.32rem 0.65rem', color: '#e9efe4', outline: 'none',
    transition: 'border-color 0.12s',
  },
  ingestBtn: (busy) => ({
    ...MONO, fontSize: '0.6rem',
    textTransform: 'uppercase', letterSpacing: '0.1em',
    padding: '0.32rem 0.75rem', borderRadius: 6, cursor: busy ? 'default' : 'pointer',
    background: busy ? 'transparent' : 'rgba(197,224,99,0.1)',
    border: `1px solid ${busy ? '#2b4231' : 'rgba(197,224,99,0.3)'}`,
    color: busy ? '#4a6b50' : '#c5e063', transition: 'all 0.12s',
  }),
  ingestMsg: { ...MONO, fontSize: '0.62rem' },

  factList: { flex: 1, overflowY: 'auto', padding: '0.4rem 0' },
  factItem: (selected, flagged) => ({
    padding: '0.7rem 1.25rem', cursor: 'pointer',
    borderLeft: `3px solid ${selected ? '#c5e063' : 'transparent'}`,
    background: selected ? 'rgba(197,224,99,0.05)' : 'transparent',
    opacity: flagged ? 0.7 : 1,
    transition: 'background 0.1s, border-color 0.1s',
  }),
  factContent: { fontSize: '0.875rem', lineHeight: 1.45, color: '#e9efe4', marginBottom: '0.35rem' },
  factMeta: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  typeBadge: (type) => {
    const p = typePalette(type);
    return {
      ...MONO, fontSize: '0.54rem', textTransform: 'uppercase', letterSpacing: '0.1em',
      color: p.text, background: p.bg, border: `1px solid ${p.border}`,
      borderRadius: 99, padding: '0.1rem 0.45rem',
    };
  },
  confBar: { flex: 1, height: 5, background: '#1a2f20', borderRadius: 99, overflow: 'hidden' },
  confFill: (conf) => ({
    height: '100%', borderRadius: 99,
    width: `${Math.round(conf * 100)}%`,
    background: conf > 0.7 ? '#c5e063' : conf > 0.4 ? '#8aa83f' : '#4a6b50',
    transition: 'width 0.3s ease',
  }),
  confPct: { ...MONO, fontSize: '0.54rem', color: '#4a6b50', minWidth: 28, textAlign: 'right' },
  flagBadge: {
    ...MONO, fontSize: '0.52rem', color: '#f0c060',
    background: 'rgba(240,192,96,0.1)', border: '1px solid rgba(240,192,96,0.25)',
    borderRadius: 99, padding: '0.1rem 0.4rem',
  },

  detail: {
    flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.75rem 2rem',
    display: 'flex', flexDirection: 'column', gap: '1.5rem',
  },
  empty: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#4a6b50', fontSize: '0.85rem', fontStyle: 'italic',
  },
  detailTitle: {
    fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1.2rem',
    lineHeight: 1.4, color: '#e9efe4',
  },
  conflictNote: {
    marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.65rem', color: '#f0c060',
  },
  statsRow: { display: 'flex', gap: '1.75rem', flexWrap: 'wrap' },
  stat: { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  statVal: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1.15rem', color: '#c5e063' },
  statLabel: { ...MONO, fontSize: '0.56rem', color: '#4a6b50', textTransform: 'uppercase', letterSpacing: '0.1em' },
  section: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  sectionLabel: { ...MONO, fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.14em', color: '#4a6b50' },
  episodeCard: {
    background: '#16241a', border: '1px solid #1f3326', borderRadius: 10,
    padding: '0.85rem 1rem',
  },
  episodeMeta: {
    ...MONO, fontSize: '0.58rem', color: '#4a6b50', letterSpacing: '0.06em',
    marginBottom: '0.5rem', display: 'block',
  },
  episodeText: { fontSize: '0.85rem', lineHeight: 1.6, color: '#d0d8cc' },
  factId: { ...MONO, fontSize: '0.65rem', color: '#3d5a44', wordBreak: 'break-all' },
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
    try { await triggerConsolidate(); load(); } catch {}
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
      {/* Sidebar */}
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
              onFocus={e => e.target.style.borderColor = '#3d6b47'}
              onBlur={e => e.target.style.borderColor = '#2b4231'}
            />
            <button style={S.ingestBtn(ingesting)} onClick={ingest} disabled={ingesting}>
              {ingesting ? '…' : '↑'}
            </button>
          </div>
          {ingestMsg && (
            <span style={{ ...S.ingestMsg, color: ingestMsg.ok ? '#8aa83f' : '#e05555' }}>
              {ingestMsg.text}
            </span>
          )}
        </div>

        <div style={S.factList}>
          {loading && <p style={{ padding: '1rem 1.25rem', color: '#4a6b50', fontSize: '0.85rem' }}>Loading…</p>}
          {error && (
            <p style={{ padding: '1rem 1.25rem', color: '#e05555', fontSize: '0.78rem', ...MONO }}>
              ✗ {error}<br />
              <span style={{ color: '#4a6b50' }}>Is the backend running?</span>
            </p>
          )}
          {!loading && !error && filtered.length === 0 && (
            <p style={{ padding: '1.25rem', color: '#4a6b50', fontSize: '0.85rem', fontStyle: 'italic' }}>
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

      {/* Detail pane */}
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
            {!provenance && <p style={{ color: '#4a6b50', fontSize: '0.85rem', fontStyle: 'italic' }}>Loading…</p>}
            {provenance?.source_episodes?.length === 0 && (
              <p style={{ color: '#4a6b50', fontSize: '0.85rem', fontStyle: 'italic' }}>No source episodes recorded.</p>
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
