import { useState, useRef, useEffect, useCallback } from 'react';
import { streamMessage, createRoadmap } from '../api';
import './Chat.css';

function fmt(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  const [expanded, setExpanded] = useState({}); // which message indexes have recall expanded
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
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setMessages(m => [...m, { role: 'user', content: text, ts: Date.now(), memoryUsed: [] }]);
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
        },
      );
    } catch {
      setLoading(false);
      setMessages(m => [...m, {
        role: 'assistant',
        content: 'Backend offline — run `make dev` to start the server.',
        memoryUsed: [], ts: Date.now(),
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
        memoryUsed: [], ts: Date.now(),
      }]);
      setShowPlan(false); setPlanTopic(''); setPlanBg('');
    } catch {
      setMessages(m => [...m, {
        role: 'assistant',
        content: 'Planner failed — check backend logs.',
        memoryUsed: [], ts: Date.now(),
      }]);
    }
    setPlanBusy(false);
  };

  const toggleExpand = idx => setExpanded(e => ({ ...e, [idx]: !e[idx] }));

  return (
    <div className="chat">
      <div className="thread-wrap">
        <div className="thread">
          {messages.map((m, i) => {
            const hasRecall = m.role === 'assistant' && m.memoryUsed?.length > 0;
            const isOpen = !!expanded[i];
            return (
              <div key={i} className="msg-row" style={{ animationDelay: `${Math.min(i, 4) * 0.04}s` }}>
                <div className="msg-who">
                  <span className={`msg-role ${m.role === 'user' ? 'you' : 'sys'}`}>
                    {m.role === 'user' ? 'YOU' : 'MNM'}
                  </span>
                  <span className="msg-ts">{fmt(m.ts)}</span>
                </div>
                <div className="msg-body">
                  <div className="msg-text">{m.content}</div>
                  {hasRecall && (
                    <>
                      <button
                        className={`recall-toggle${isOpen ? ' open' : ''}`}
                        onClick={() => toggleExpand(i)}
                      >
                        <span className="recall-chevron">{isOpen ? '▾' : '▸'}</span>
                        {m.memoryUsed.length} fact{m.memoryUsed.length !== 1 ? 's' : ''} recalled
                      </button>
                      {isOpen && (
                        <div className="recall-facts">
                          {m.memoryUsed.slice(0, 6).map((mu, j) => {
                            const id = typeof mu === 'string' ? mu : (mu.fact_id || '');
                            const text = mu.content || mu.text || '';
                            const score = mu.score != null ? Number(mu.score).toFixed(2) : null;
                            return (
                              <div key={j} className="recall-fact">
                                <span className="recall-fact-id">{id.slice(0, 10)}</span>
                                <span className="recall-fact-text">{text || id}</span>
                                {score && <span className="recall-fact-score">{score}</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="think-row">
              <div className="think-who">
                <span className="think-who-label">MNM</span>
              </div>
              <div className="think-body">
                <span className="blink-cursor" />
                querying memory
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="chat-foot-outer">
        <div className="chat-foot">
          <textarea
            ref={textareaRef}
            className="input-field"
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(e.target); }}
            onKeyDown={onKey}
            placeholder="Ask anything — memory context injected automatically"
            rows={1}
          />
          <div className="input-foot">
            <span className="sess-id">{sessionId.slice(0, 8)}</span>
            <div className="input-actions">
              <button className="btn-road" onClick={() => setShowPlan(true)}>roadmap</button>
              <button
                className="btn-send"
                onClick={send}
                disabled={!input.trim() || loading}
              >
                send ↵
              </button>
            </div>
          </div>
        </div>
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
