import { useState, useRef, useEffect, useCallback } from 'react';
import { streamMessage, createRoadmap, getFacts } from '../api';
import './Chat.css';

function fmt(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function confBar(conf) {
  const c = Math.max(0, Math.min(1, Number(conf)));
  const s = Math.round(c * 100);
  const l = Math.round(18 + c * 32);
  return `hsl(180,${s}%,${l}%)`;
}

export default function Chat({ sessionId }) {
  const [messages, setMessages] = useState([{
    role: 'assistant',
    content: "Hello. I'm Mnemos, your learning copilot. What are you working on?",
    memoryUsed: [],
    ts: Date.now(),
  }]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [expanded, setExpanded] = useState({});
  const [showPlan, setShowPlan]   = useState(false);
  const [planTopic, setPlanTopic] = useState('');
  const [planBg, setPlanBg]       = useState('');
  const [planBusy, setPlanBusy]   = useState(false);
  const [ctxFacts, setCtxFacts]   = useState([]);
  const [ctxOpen, setCtxOpen]     = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const bottomRef   = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    getFacts()
      .then(facts => {
        const sorted = [...facts].sort((a, b) => b.confidence - a.confidence);
        setCtxFacts(sorted.slice(0, 8));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const autoResize = el => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  };

  const copyMsg = (idx, text) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1400);
    });
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

        {/* ── Loaded context strip ── */}
        {ctxFacts.length > 0 && (
          <div className={`ctx-strip${ctxOpen ? ' open' : ''}`}>
            <div className="ctx-gutter" onClick={() => setCtxOpen(o => !o)}>
              <span className="ctx-label">ctx</span>
              <span className="ctx-chev">{ctxOpen ? '−' : '+'}</span>
            </div>
            <div className="ctx-body" onClick={() => !ctxOpen && setCtxOpen(true)}>
              {ctxOpen ? (
                <div className="ctx-fact-list">
                  {ctxFacts.map(f => (
                    <div key={f.fact_id} className="ctx-fact">
                      <span
                        className="ctx-fact-bar"
                        style={{ background: confBar(f.confidence) }}
                      />
                      <span className="ctx-fact-type">{f.fact_type}</span>
                      <span className="ctx-fact-text">{f.content}</span>
                      <span className="ctx-fact-conf">{Number(f.confidence).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ctx-summary">
                  <span className="ctx-n">{ctxFacts.length} facts loaded</span>
                  <span className="ctx-sep">·</span>
                  <span className="ctx-peek">{ctxFacts[0]?.content?.slice(0, 80)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Messages ── */}
        {messages.map((m, i) => {
          const isUser   = m.role === 'user';
          const hasRecall = !isUser && m.memoryUsed?.length > 0;
          const isOpen   = !!expanded[i];
          const isCopied = copiedIdx === i;
          return (
            <div
              key={i}
              className={`msg-row ${isUser ? 'user' : 'asst'}`}
              style={{ animationDelay: `${Math.min(i, 4) * 0.04}s` }}
            >
              <div className="msg-gutter">
                <span className="msg-time">{fmt(m.ts)}</span>
                {isUser && <span className="msg-mark">▸</span>}
              </div>

              <div className="msg-body">
                <button
                  className={`msg-copy${isCopied ? ' done' : ''}`}
                  onClick={() => copyMsg(i, m.content)}
                  title="Copy"
                >
                  {isCopied ? '✓' : '⎘'}
                </button>

                <div className="msg-text">{m.content}</div>

                {hasRecall && (
                  <div className="recall-bar">
                    <button
                      className={`recall-btn${isOpen ? ' open' : ''}`}
                      onClick={() => toggleExpand(i)}
                    >
                      memory
                      <span className="recall-count">{m.memoryUsed.length}</span>
                    </button>
                    {isOpen && (
                      <div className="recall-list">
                        {m.memoryUsed.slice(0, 6).map((mu, j) => {
                          const id    = typeof mu === 'string' ? mu : (mu.fact_id || '');
                          const text  = mu.content || mu.text || '';
                          const score = mu.score != null ? Number(mu.score).toFixed(2) : null;
                          return (
                            <div key={j} className="recall-item">
                              <span className="ri-id">{id.slice(0, 10)}</span>
                              <span className="ri-text">{text || id}</span>
                              {score && <span className="ri-score">{score}</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="think-row">
            <div className="think-gutter">
              <span className="think-dot" />
            </div>
            <div className="think-body">querying memory…</div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div className="chat-foot">
        <div className="foot-gutter">
          <span className="foot-prompt">›</span>
        </div>
        <div className="foot-body">
          <textarea
            ref={textareaRef}
            className="input-field"
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(e.target); }}
            onKeyDown={onKey}
            placeholder="Ask anything — memory context injected automatically"
            rows={1}
          />
          <div className="foot-actions">
            <span className="sess-id">{sessionId.slice(0, 8)}</span>
            <button className="btn-road" onClick={() => setShowPlan(true)}>roadmap</button>
            <button className="btn-send" onClick={send} disabled={!input.trim() || loading}>
              send ↵
            </button>
          </div>
          <div className="foot-note">conversation committed to memory after each turn</div>
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
