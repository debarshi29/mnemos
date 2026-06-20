import { useState, useEffect } from 'react';
import { getGoals, updateGoalStatus } from '../api';

const LABEL = {
  fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem',
  textTransform: 'uppercase', letterSpacing: '0.16em', color: '#9ab09a',
};

const STATUS_COLORS = { not_started: '#2b4231', in_progress: '#8aa83f', done: '#c5e063' };
const STATUS_TEXT   = { not_started: '#9ab09a', in_progress: '#101a13', done: '#101a13' };

const S = {
  root: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto', background: '#101a13' },
  header: {
    padding: '1.25rem 1.5rem 1rem', borderBottom: '1px solid #2b4231',
    background: '#16241a', position: 'sticky', top: 0, zIndex: 1,
  },
  title: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1rem' },
  body: { padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  topicGroup: {},
  topicLabel: { ...LABEL, color: '#8aa83f', marginBottom: '0.65rem', display: 'block' },
  phases: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  phase: (status) => ({
    background: '#16241a', border: `1px solid ${status === 'done' ? '#8aa83f' : '#2b4231'}`,
    borderRadius: 10, padding: '0.85rem 1rem',
    display: 'flex', alignItems: 'flex-start', gap: '0.85rem',
    opacity: status === 'done' ? 0.65 : 1,
    transition: 'opacity 0.2s',
  }),
  phaseNum: {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.7rem', fontWeight: 500,
    color: '#8aa83f', minWidth: 20, paddingTop: 2,
  },
  phaseContent: { flex: 1, fontSize: '0.9rem', lineHeight: 1.5, color: '#e9efe4' },
  resources: { marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  resourceLink: {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.65rem', color: '#8aa83f',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280,
  },
  statusPills: { display: 'flex', flexDirection: 'column', gap: '0.25rem', flexShrink: 0 },
  pill: (active, status) => ({
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.55rem',
    textTransform: 'uppercase', letterSpacing: '0.1em',
    padding: '0.2rem 0.5rem', borderRadius: 99, cursor: 'pointer', border: 'none',
    background: active ? STATUS_COLORS[status] : 'transparent',
    color: active ? STATUS_TEXT[status] : '#9ab09a',
    outline: active ? 'none' : '1px solid #2b4231',
    transition: 'all 0.12s',
  }),
  empty: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#9ab09a', fontStyle: 'italic', padding: '3rem', textAlign: 'center',
  },
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

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.title}>Learning Roadmap</span>
      </div>
      {loading && <p style={{ padding: '1.5rem', color: '#9ab09a', fontStyle: 'italic' }}>Loading…</p>}
      {!loading && goals.length === 0 && (
        <div style={S.empty}>
          No roadmap yet. In the Chat panel, click "+ roadmap" and give a topic and your background.
        </div>
      )}
      <div style={S.body}>
        {Object.entries(byTopic).map(([topic, phases]) => (
          <div key={topic} style={S.topicGroup}>
            <span style={S.topicLabel}>{topic}</span>
            <div style={S.phases}>
              {[...phases].sort((a, b) => a.phase_index - b.phase_index).map(g => (
                <div key={g.goal_id} style={S.phase(g.status)}>
                  <span style={S.phaseNum}>{g.phase_index + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={S.phaseContent}>{g.phase_content}</div>
                    {g.metadata?.resources?.length > 0 && (
                      <div style={S.resources}>
                        {g.metadata.resources.slice(0, 2).map((r, i) => (
                          <a key={i} href={r} target="_blank" rel="noreferrer" style={S.resourceLink}>↗ {r}</a>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={S.statusPills}>
                    {['not_started', 'in_progress', 'done'].map(s => (
                      <button key={s} style={S.pill(g.status === s, s)} onClick={() => changeStatus(g.goal_id, s)}>
                        {s === 'not_started' ? 'todo' : s === 'in_progress' ? 'doing' : 'done'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
