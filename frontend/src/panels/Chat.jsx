import { useState, useRef, useEffect, useCallback } from 'react';
import { streamMessage, createRoadmap } from '../api';
import './Chat.css';

function fmt(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Pair flat message array into exchanges: { user, assistant }
// Standalone assistant messages (initial greeting) → { user: null, assistant }
function toExchanges(msgs) {
  const out = [];
  let pending = null;
  for (const m of msgs) {
    if (m.role === 'user') {
      pending = m;
    } else {
      out.push({ user: pending, assistant: m });
      pending = null;
    }
  }
  if (pending) out.push({ user: pending, assistant: null });
  return out;
}

export default function Chat({ sessionId }) {
  const [messages, setMessages] = useState([{
    role: 'assistant',
    content: "Hello. I'm Mnemos, your learning copilot. What are you working on?",
    memoryUsed: [],
    ts: Date.now(),
  }]);
  const [input, setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [planTopic, setPlanTopic] = useState('');
  const [planBg, setPlanBg]     = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const bottomRef  = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const autoResize = el => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 116) + 'px';
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
          setMessages(m => {
            const c = [...m], l = c[c.length - 1];
            c[c.length - 1] = { ...l, memoryUsed: meta.memory_used || [] };
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
        role: 'assistant', content: 'Planner failed — check backend logs.',
        memoryUsed: [], ts: Date.now(),
      }]);
    }
    setPlanBusy(false);
  };

  const exchanges = toExchanges(messages);

  return (
    <div className="chat">
      <div className="thread">
        {exchanges.map((ex, i) => (
          <div key={i} className="exchange">
            {ex.user && (
              <div className="user-line">
                <span className="user-text">{ex.user.content}</span>
              </div>
            )}

            {ex.assistant && (
              <>
                <div className="asst-text">{ex.assistant.content}</div>
                <div className="ex-rule">
                  <div className="ex-line" />
                  <div className="ex-meta">
                    {ex.assistant.memoryUsed?.length > 0 && (
                      <span className="ex-recalled">
                        {ex.assistant.memoryUsed.length} recalled
                      </span>
                    )}
                    <span>{fmt(ex.assistant.ts)}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}

        {loading && (
          <div className="typing-row">
            <div className="typing-dots">
              <div className="dot" />
              <div className="dot" />
              <div className="dot" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-foot">
        <div className="input-row">
          <div className="input-wrap">
            <textarea
              ref={textareaRef}
              className="input-field"
              value={input}
              onChange={e => { setInput(e.target.value); autoResize(e.target); }}
              onKeyDown={onKey}
              placeholder="Ask anything…"
              rows={1}
            />
          </div>
          <div className="input-btns">
            <button className="btn-road" onClick={() => setShowPlan(true)}>
              roadmap
            </button>
            <button
              className="btn-send"
              onClick={send}
              disabled={!input.trim() || loading}
            >
              Send
            </button>
          </div>
        </div>
        <div className="sess-id">{sessionId.slice(0, 8)}</div>
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
              : <div className="modal-btns">
                  <button className="btn-cancel" onClick={() => setShowPlan(false)}>Cancel</button>
                  <button className="btn-gen" onClick={handlePlan} disabled={!planTopic.trim()}>
                    Generate
                  </button>
                </div>
            }
          </div>
        </div>
      )}
    </div>
  );
}
