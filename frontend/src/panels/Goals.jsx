import { useState, useEffect } from 'react';
import { getGoals, updateGoalStatus } from '../api';
import './Goals.css';

const COLS = [
  { id: 'not_started', label: 'TODO',   cls: '' },
  { id: 'in_progress', label: 'ACTIVE', cls: 'active' },
  { id: 'done',        label: 'DONE',   cls: 'done' },
];
const STATUS_LABELS = { not_started: 'todo', in_progress: 'active', done: 'done' };

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

  // Group by topic so cards can show topic label
  const topicPhaseCount = goals.reduce((acc, g) => {
    acc[g.topic] = (acc[g.topic] || 0) + 1;
    return acc;
  }, {});

  const done  = goals.filter(g => g.status === 'done').length;
  const total = goals.length;

  return (
    <div className="goals">
      <div className="goals-toolbar">
        <span style={{ fontFamily: 'var(--fm)', fontSize: 'var(--tx)', color: 'var(--t4)', letterSpacing: '0.06em' }}>
          {Object.keys(topicPhaseCount).length} topic{Object.keys(topicPhaseCount).length !== 1 ? 's' : ''}
        </span>
        {total > 0 && (
          <span className="goals-frac">{done}/{total} done</span>
        )}
      </div>

      {loading && <p className="goals-load">loading…</p>}
      {error   && <p className="goals-err">{error}</p>}

      {!loading && !error && goals.length === 0 && (
        <div className="goals-empty">
          <span className="goals-empty-hint">
            no roadmap yet<br />
            in chat, click "roadmap" and enter a topic
          </span>
        </div>
      )}

      {goals.length > 0 && (
        <div className="kanban">
          {COLS.map(col => {
            const cards = goals
              .filter(g => g.status === col.id)
              .sort((a, b) => a.phase_index - b.phase_index);

            return (
              <div key={col.id} className="k-col">
                <div className="k-col-hd">
                  <span className={`k-col-label${col.cls ? ' ' + col.cls : ''}`}>{col.label}</span>
                  <span className="k-col-count">{cards.length}</span>
                </div>
                <div className="k-cards">
                  {cards.map(g => (
                    <div key={g.goal_id} className={`k-card ${g.status}`}>
                      <div className="k-card-topic">{g.topic.toUpperCase()}</div>
                      <div className="k-card-content">{g.phase_content}</div>

                      {g.metadata?.resources?.length > 0 && (
                        <div className="k-card-links">
                          {g.metadata.resources.slice(0, 2).map((r, i) => (
                            <a key={i} href={r} target="_blank" rel="noreferrer" className="k-card-link">
                              ↗ {r}
                            </a>
                          ))}
                        </div>
                      )}

                      <div className="k-card-foot">
                        <span className="k-card-phase">phase {g.phase_index + 1}</span>
                        <div className="k-status">
                          {['not_started', 'in_progress', 'done'].map(s => (
                            <button
                              key={s}
                              className={`ks-btn s-${s}${g.status === s ? ' on' : ''}`}
                              onClick={() => setStatus(g.goal_id, s)}
                            >
                              {STATUS_LABELS[s]}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                  {cards.length === 0 && (
                    <span style={{ fontFamily: 'var(--fm)', fontSize: 'var(--tx)', color: 'var(--t4)', padding: '8px 4px' }}>
                      empty
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
