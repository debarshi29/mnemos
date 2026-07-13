import { useState, useEffect } from 'react';
import { getGoals, updateGoalStatus } from '../api';
import './Goals.css';

const STATUS_LABELS = {
  not_started: 'todo',
  in_progress:  'doing',
  done:         'done',
};

export default function Goals() {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true); setError(null);
    getGoals()
      .then(g => { setGoals(g); setLoading(false); })
      .catch(e => { setError(e?.message || 'API unreachable'); setLoading(false); });
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
    return {
      done,
      total: phases.length,
      pct: phases.length ? Math.round((done / phases.length) * 100) : 0,
    };
  };

  const doneCount = goals.filter(g => g.status === 'done').length;

  return (
    <div className="goals">
      <div className="goals-header">
        <span className="goals-title">Roadmap</span>
        {goals.length > 0 && (
          <span className="goals-sub">{doneCount}/{goals.length} phases done</span>
        )}
      </div>

      {loading && <p className="goals-loading">Loading…</p>}
      {error   && <p className="goals-error">{error}</p>}

      {!loading && !error && goals.length === 0 && (
        <div className="goals-empty">
          <span className="goals-empty-icon">◈</span>
          <span className="goals-empty-text">
            No roadmap yet.<br />
            In Chat, click "+ roadmap",<br />
            enter a topic and your background.
          </span>
        </div>
      )}

      {goals.length > 0 && (
        <div className="goals-body">
          {Object.entries(byTopic).map(([topic, phases]) => {
            const sorted = [...phases].sort((a, b) => a.phase_index - b.phase_index);
            const prog = topicProgress(sorted);
            return (
              <div key={topic} className="topic-group">
                <div className="topic-header">
                  <span className="topic-name">{topic}</span>
                  <div className="prog-track">
                    <div className="prog-fill" style={{ width: `${prog.pct}%` }} />
                  </div>
                  <span className="prog-label">{prog.done}/{prog.total}</span>
                </div>

                <div className="phases">
                  {sorted.map(g => (
                    <div key={g.goal_id} className={`phase-card ${g.status}`}>
                      <span className="phase-num">{g.phase_index + 1}.</span>
                      <div className="phase-body">
                        <div className="phase-text">{g.phase_content}</div>
                        {g.metadata?.resources?.length > 0 && (
                          <div className="phase-links">
                            {g.metadata.resources.slice(0, 3).map((r, i) => (
                              <a
                                key={i}
                                href={r}
                                target="_blank"
                                rel="noreferrer"
                                className="phase-link"
                              >
                                ↗ {r}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="status-pills">
                        {['not_started', 'in_progress', 'done'].map(s => (
                          <button
                            key={s}
                            className={`spill s-${s}${g.status === s ? ' on' : ''}`}
                            onClick={() => changeStatus(g.goal_id, s)}
                          >
                            {STATUS_LABELS[s]}
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
