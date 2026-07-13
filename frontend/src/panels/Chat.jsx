import { useState, useRef, useEffect, useCallback } from 'react';
import { streamMessage, createRoadmap } from '../api';
import './Chat.css';

function fmt(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function cellRow(v, n) {
  return Array.from({ length: n }, (_, i) => ({
    bg: i < Math.round(v * n) ? 'var(--ac)' : 'hsl(228,12%,14%)',
  }));
}

export default function Chat({ sessionId }) {
  const [messages, setMessages] = useState([{
    role: 'assistant',
    content: "Hello. I'm Mnemos, your learning copilot. What are you working on?",
    memoryUsed: [],
    ts: Date.now(),
  }]);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [recalled, setRecalled] = useState([]);
  const [showPlan, setShowPlan]   = useState(false);
  const [planTopic, setPlanTopic] = useState('');
  const [planBg, setPlanBg]       = useState('');
  const [planBusy, setPlanBusy]   = useState(false);
  const bottomRef   = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const autoResize = el => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setMessages(m => [...m, { role: 'user', content: text, ts: Date.now() }]);
    setLoading(true);
    try {
      let first = true;
      await streamMessage(text, sessionId,
        token => {
          if (first) {
            first = false;
            setLoading(false);
            setMessages(m => [...m, { role: 'assistant', content: token, memoryUsed: [], ts: Date.now() }]);
          } else {
            setMessages(m => {
              const c = [...m], l = c[c.length - 1];
              c[c.length - 1] = { ...l, content: l.content + token };
              return c;
            });
          }
        },
        meta => {
          const used = meta.memory_used || [];
          setMessages(m => {
            const c = [...m], l = c[c.length - 1];
            c[c.length - 1] = { ...l, memoryUsed: used };
            return c;
          });
          if (used.length) setRecalled(used);
        },
      );
    } catch {
      setLoading(false);
      setMessages(m => [...m, {
        role: 'assistant',
        content: 'Backend offline — run `make dev` to start the server.',
        memoryUsed: [],
        ts: Date.now(),
      }]);
    }
  }, [input, loading, sessionId]);

  const onKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handlePlan = async () => {
    if (!planTopic.trim()) return;
    setPlanBusy(true);
    try {
      const data = await createRoadmap(planTopic, planBg, sessionId);
      setMessages(m => [...m, {
        role: 'assistant',
        content: `Roadmap for "${data.topic}" — ${data.phases.length} phases saved. Open the Roadmap tab to track progress.`,
        memoryUsed: [],
        ts: Date.now(),
      }]);
      setShowPlan(false); setPlanTopic(''); setPlanBg('');
    } catch {
      setMessages(m => [...m, {
        role: 'assistant',
        content: 'Planner failed — check backend logs.',
        memoryUsed: [],
        ts: Date.now(),
      }]);
    }
    setPlanBusy(false);
  };

  return (
    <div className="chat">
      <div className="chat-main">
        <div className="chat-hd">
          <span className="chat-hd-num">01</span>
          <span className="chat-hd-title">Session</span>
          <span className="chat-hd-meta">{sessionId.slice(0, 8)} · {recalled.length} facts in context</span>
        </div>

        <div className="chat-body">
          <div className="chat-msgs">
            {messages.map((m, i) => (
              <div key={i} className="msg-row" style={{ animationDelay: `${i * 0.015}s` }}>
                <div className="msg-who">
                  <span className={`msg-role ${m.role === 'user' ? 'you' : 'sys'}`}>
                    {m.role === 'user' ? 'YOU' : 'MNEM'}
                  </span>
                  <span className="msg-time">{fmt(m.ts)}</span>
                </div>
                <div className="msg-body">
                  <div className="msg-text">{m.content}</div>
                  {m.memoryUsed?.length > 0 && (
                    <div className="msg-chips">
                      {m.memoryUsed.slice(0, 5).map((mu, j) => (
                        <span key={j} className="chip">
                          <span className="chip-id">
                            {typeof mu === 'string' ? mu.slice(0, 8) : (mu.fact_id || '').slice(0, 8)}
                          </span>
                          {mu.score != null && (
                            <span className="chip-score">{Number(mu.score).toFixed(2)}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="think-row">
                <div className="think-who">
                  <span className="think-who-label">MNEM</span>
                </div>
                <div className="think-text">
                  querying vector store
                  <span className="blink-cursor" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="chat-foot">
          <div className="chat-foot-inner">
            <span className="chat-prompt">❯</span>
            <textarea
              ref={textareaRef}
              className="input-field"
              value={input}
              onChange={e => { setInput(e.target.value); autoResize(e.target); }}
              onKeyDown={onKey}
              placeholder="transmit to mnemos — memory context injected automatically"
              rows={1}
            />
            <div className="chat-btns">
              <button className="btn-road" onClick={() => setShowPlan(true)}>
                ROADMAP
              </button>
              <button
                className="btn-send"
                onClick={send}
                disabled={!input.trim() || loading}
              >
                SEND ↵
              </button>
            </div>
            <span className="sess-id">{sessionId.slice(0, 8)}</span>
          </div>
        </div>
      </div>

      {/* Recall trace rail */}
      <div className="recall-rail">
        <div className="rr-hd">
          <span className="rr-title">RECALL TRACE</span>
          {recalled.length > 0 && (
            <span className="rr-count">{recalled.length} hits</span>
          )}
        </div>

        {recalled.length === 0 ? (
          <p className="rr-empty">
            Recalled facts will appear here after the first exchange.
          </p>
        ) : (
          <>
            <div className="rr-list">
              {recalled.slice(0, 5).map((mu, i) => {
                const id = typeof mu === 'string' ? mu : (mu.fact_id || '');
                const text = mu.content || mu.text || '';
                const score = mu.score != null ? Number(mu.score) : 0;
                return (
                  <div key={i} className="rr-item">
                    <div className="rr-item-hd">
                      <span className="rr-id">{id.slice(0, 8)}</span>
                      <span className="rr-score">{score.toFixed(2)}</span>
                    </div>
                    {text && <div className="rr-text">{text.slice(0, 120)}</div>}
                    <div className="rr-cells">
                      {cellRow(score, 10).map((c, j) => (
                        <div key={j} className="rr-cell" style={{ background: c.bg }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="rr-formula">
              rank = cos_sim × e^(−Δt/t½)<br />
              recall boosts strength +0.05
            </p>
          </>
        )}
      </div>

      {showPlan && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setShowPlan(false)}>
          <div className="modal">
            <div>
              <div className="modal-h">Generate Roadmap</div>
              <div className="modal-sub">Creates a phased learning plan, saved to the Roadmap tab.</div>
            </div>
            <input
              className="modal-input"
              placeholder="Topic — e.g. Rust ownership model"
              value={planTopic}
              onChange={e => setPlanTopic(e.target.value)}
            />
            <input
              className="modal-input"
              placeholder="Background — e.g. know Python, new to systems"
              value={planBg}
              onChange={e => setPlanBg(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePlan()}
            />
            {planBusy
              ? <p className="modal-spin">Building your roadmap…</p>
              : (
                <div className="modal-btns">
                  <button className="btn-cancel" onClick={() => setShowPlan(false)}>Cancel</button>
                  <button className="btn-gen" onClick={handlePlan} disabled={!planTopic.trim()}>
                    Generate
                  </button>
                </div>
              )
            }
          </div>
        </div>
      )}
    </div>
  );
}
