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
        <span className="goals-hd-num">03</span>
        <span className="goals-hd-title">Roadmap</span>
        {goals.length > 0 && (
          <span className="goals-hd-meta">{done}/{goals.length} done</span>
        )}
      </div>

      {loading && <p className="goals-load">Loading…</p>}
      {error   && <p className="goals-err">{error}</p>}

      {!loading && !error && goals.length === 0 && (
        <div className="goals-empty">
          <span className="goals-empty-hint">
            No roadmap yet.<br />
            In Chat, click "ROADMAP",<br />
            enter a topic and your background.
          </span>
        </div>
      )}

      {goals.length > 0 && (
        <div className="goals-body">
          {Object.entries(byTopic).map(([topic, phases], topicIdx) => {
            const sorted = [...phases].sort((a, b) => a.phase_index - b.phase_index);
            const donePct = sorted.length
              ? Math.round((sorted.filter(p => p.status === 'done').length / sorted.length) * 100)
              : 0;
            const ghost = String(topicIdx + 1).padStart(2, '0');

            return (
              <div key={topic} className="topic">
                <div className="topic-grid">
                  <div className="topic-left">
                    <div className="topic-ghost">{ghost}</div>
                    <div className="topic-name">{topic}</div>
                    <div className="topic-prog">
                      <div className="prog-track">
                        <div className="prog-fill" style={{ width: `${donePct}%` }} />
                      </div>
                      <span className="prog-frac">
                        {sorted.filter(p => p.status === 'done').length}/{sorted.length}
                      </span>
                    </div>
                  </div>

                  <div className="phases">
                    {sorted.map(g => (
                      <div key={g.goal_id} className={`phase ${g.status}`}>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
