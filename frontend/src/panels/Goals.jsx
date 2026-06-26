import { useState, useEffect } from 'react';
import { getGoals, updateGoalStatus } from '../api';

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };

const STATUS = {
  not_started: { label: 'todo',   bg: 'transparent', text: '#4a6b50', border: '#2b4231' },
  in_progress:  { label: 'doing',  bg: '#8aa83f',     text: '#101a13', border: '#8aa83f' },
  done:         { label: 'done',   bg: '#c5e063',     text: '#101a13', border: '#c5e063' },
};

const S = {
  root: {
    display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0,
    background: '#101a13', overflowY: 'auto',
  },
  header: {
    padding: '1.25rem 2rem 1rem', borderBottom: '1px solid #1f3326',
    background: '#13201a', position: 'sticky', top: 0, zIndex: 1,
    display: 'flex', alignItems: 'baseline', gap: '0.75rem',
  },
  title: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1.05rem', color: '#e9efe4' },
  subtitle: { ...MONO, fontSize: '0.6rem', color: '#4a6b50', textTransform: 'uppercase', letterSpacing: '0.1em' },
  body: { padding: '1.5rem 2rem', display: 'flex', flexDirection: 'column', gap: '2.5rem' },
  topicGroup: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  topicHeader: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  topicLabel: { ...MONO, fontSize: '0.62rem', color: '#8aa83f', textTransform: 'uppercase', letterSpacing: '0.14em' },
  progressTrack: { flex: 1, height: 3, background: '#1f3326', borderRadius: 99, overflow: 'hidden' },
  progressFill: (pct) => ({
    height: '100%', borderRadius: 99, width: `${pct}%`,
    background: 'linear-gradient(90deg, #4a6b50, #c5e063)',
    transition: 'width 0.4s ease',
  }),
  progressLabel: { ...MONO, fontSize: '0.58rem', color: '#4a6b50', whiteSpace: 'nowrap' },

  phases: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  phase: (status) => ({
    background: '#13201a',
    border: `1px solid ${status === 'done' ? '#2b4231' : status === 'in_progress' ? '#3d6b47' : '#1f3326'}`,
    borderRadius: 12, padding: '0.9rem 1.1rem',
    display: 'flex', alignItems: 'flex-start', gap: '0.9rem',
    opacity: status === 'done' ? 0.55 : 1,
    transition: 'opacity 0.2s, border-color 0.2s',
  }),
  phaseIndex: {
    ...MONO, fontSize: '0.65rem', fontWeight: 500,
    color: '#4a6b50', minWidth: 18, paddingTop: 3, flexShrink: 0,
  },
  phaseBody: { flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  phaseContent: { fontSize: '0.9rem', lineHeight: 1.55, color: '#d8e4d4' },
  resources: { display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.1rem' },
  resourceLink: {
    ...MONO, fontSize: '0.6rem', color: '#4a6b50',
    maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    transition: 'color 0.12s',
  },

  pillRow: { display: 'flex', gap: '0.3rem', alignItems: 'center', flexShrink: 0 },
  pill: (active, statusKey) => {
    const s = STATUS[statusKey];
    return {
      ...MONO, fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em',
      padding: '0.25rem 0.65rem', borderRadius: 99, cursor: 'pointer', border: 'none',
      background: active ? s.bg : 'transparent',
      color: active ? s.text : '#3d5a44',
      outline: active ? 'none' : `1px solid ${s.border}`,
      transition: 'all 0.12s',
    };
  },

  empty: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    color: '#4a6b50', padding: '3rem', textAlign: 'center', gap: '0.5rem',
  },
  emptyHint: { ...MONO, fontSize: '0.65rem', lineHeight: 1.7 },
};

export default function Goals() {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getGoals().then(g => { setGoals(g); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const changeStatus = async (goalId, status) => {
    try {
      await updateGoalStatus(goalId, status);
      setGoals(gs => gs.map(g => g.goal_id === goalId ? { ...g, status } : g));
    } catch {}
  };

  const byTopic = goals.reduce((acc, g) => {
    (acc[g.topic] = acc[g.topic] || []).push(g);
    return acc;
  }, {});

  const topicProgress = (phases) => {
    const done = phases.filter(p => p.status === 'done').length;
    return { done, total: phases.length, pct: phases.length ? Math.round((done / phases.length) * 100) : 0 };
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.title}>Learning Roadmap</span>
        {goals.length > 0 && (
          <span style={S.subtitle}>{goals.filter(g => g.status === 'done').length}/{goals.length} phases done</span>
        )}
      </div>

      {loading && <p style={{ padding: '1.5rem 2rem', color: '#4a6b50', fontStyle: 'italic', fontSize: '0.85rem' }}>Loading…</p>}

      {!loading && goals.length === 0 && (
        <div style={S.empty}>
          <span style={{ fontSize: '1.4rem', opacity: 0.4 }}>◈</span>
          <span style={S.emptyHint}>
            No roadmap yet.<br />
            In the Chat panel, click "+ roadmap",<br />
            enter a topic and your background.
          </span>
        </div>
      )}

      <div style={S.body}>
        {Object.entries(byTopic).map(([topic, phases]) => {
          const sorted = [...phases].sort((a, b) => a.phase_index - b.phase_index);
          const prog = topicProgress(sorted);
          return (
            <div key={topic} style={S.topicGroup}>
              <div style={S.topicHeader}>
                <span style={S.topicLabel}>{topic}</span>
                <div style={S.progressTrack}>
                  <div style={S.progressFill(prog.pct)} />
                </div>
                <span style={S.progressLabel}>{prog.done}/{prog.total}</span>
              </div>

              <div style={S.phases}>
                {sorted.map(g => (
                  <div key={g.goal_id} style={S.phase(g.status)}>
                    <span style={S.phaseIndex}>{g.phase_index + 1}.</span>
                    <div style={S.phaseBody}>
                      <div style={S.phaseContent}>{g.phase_content}</div>
                      {g.metadata?.resources?.length > 0 && (
                        <div style={S.resources}>
                          {g.metadata.resources.slice(0, 3).map((r, i) => (
                            <a
                              key={i} href={r} target="_blank" rel="noreferrer"
                              style={S.resourceLink}
                              onMouseEnter={e => e.currentTarget.style.color = '#8aa83f'}
                              onMouseLeave={e => e.currentTarget.style.color = '#4a6b50'}
                            >
                              ↗ {r}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={S.pillRow}>
                      {['not_started', 'in_progress', 'done'].map(s => (
                        <button
                          key={s}
                          style={S.pill(g.status === s, s)}
                          onClick={() => changeStatus(g.goal_id, s)}
                          title={s.replace(/_/g, ' ')}
                        >
                          {STATUS[s].label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
