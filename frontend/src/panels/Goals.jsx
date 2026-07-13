import { useState, useEffect } from 'react';
import { getGoals, updateGoalStatus } from '../api';
import './Goals.css';

const LABELS = { not_started: 'todo', in_progress: 'active', done: 'done' };

export default function Goals() {
  const [goals, setGoals]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = () => {
    setLoading(true); setError(null);
    getGoals()
      .then(g => { setGoals(g); setLoading(false); })
      .catch(e => { setError(e?.message || 'API unreachable'); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const setStatus = async (id, status) => {
    try {
      await updateGoalStatus(id, status);
      setGoals(gs => gs.map(g => g.goal_id === id ? { ...g, status } : g));
    } catch {}
  };

  const byTopic = goals.reduce((acc, g) => {
    (acc[g.topic] = acc[g.topic] || []).push(g);
    return acc;
  }, {});

  const done = goals.filter(g => g.status === 'done').length;

  return (
    <div className="goals">
      <div className="goals-hd">
        <span className="goals-hd-title">roadmap</span>
        {goals.length > 0 && (
          <span className="goals-hd-frac">{done}/{goals.length} done</span>
        )}
      </div>

      {loading && <p className="goals-load">Loading…</p>}
      {error   && <p className="goals-err">{error}</p>}

      {!loading && !error && goals.length === 0 && (
        <div className="goals-empty">
          <span className="goals-empty-hint">
            No roadmap yet.<br />
            In Chat, click "roadmap",<br />
            enter a topic and your background.
          </span>
        </div>
      )}

      {goals.length > 0 && (
        <div className="goals-body">
          {Object.entries(byTopic).map(([topic, phases]) => {
            const sorted = [...phases].sort((a, b) => a.phase_index - b.phase_index);
            const doneCount = sorted.filter(p => p.status === 'done').length;

            return (
              <div key={topic} className="topic">
                <div className="topic-hd">
                  <span className="topic-name">{topic}</span>
                  <span className="topic-frac">{doneCount}/{sorted.length}</span>
                </div>

                <div className="phases">
                  {sorted.map((g, idx) => (
                    <div key={g.goal_id} className={`phase ${g.status}`}>
                      <span className="phase-num">{idx + 1}</span>
                      <div className="phase-body">
                        <div className="phase-title">{g.phase_content}</div>
                        {g.metadata?.resources?.length > 0 && (
                          <div className="phase-links">
                            {g.metadata.resources.slice(0, 3).map((r, i) => (
                              <a key={i} href={r} target="_blank" rel="noreferrer" className="phase-link">
                                ↗ {r}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="status-ctrl">
                        {['not_started', 'in_progress', 'done'].map(s => (
                          <button
                            key={s}
                            className={`sctl-btn s-${s}${g.status === s ? ' on' : ''}`}
                            onClick={() => setStatus(g.goal_id, s)}
                          >
                            {LABELS[s]}
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
      )}
    </div>
  );
}
