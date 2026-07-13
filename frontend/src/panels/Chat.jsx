import { useState, useRef, useEffect, useCallback } from 'react';
import { streamMessage, createRoadmap } from '../api';
import './Chat.css';

function fmt(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function Chat({ sessionId }) {
  const [messages, setMessages] = useState([{
    role: 'assistant',
    content: "Hello! I'm Mnemos, your learning copilot. What are you working on today?",
    memoryUsed: [],
    ts: Date.now(),
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [planTopic, setPlanTopic] = useState('');
  const [planBackground, setPlanBackground] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const autoResize = (el) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 130) + 'px';
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setMessages(m => [...m, { role: 'user', content: text, ts: Date.now() }]);
    setLoading(true);

    try {
      let firstToken = true;
      await streamMessage(text, sessionId,
        (token) => {
          if (firstToken) {
            firstToken = false;
            setLoading(false);
            setMessages(m => [...m, { role: 'assistant', content: token, memoryUsed: [], ts: Date.now() }]);
          } else {
            setMessages(m => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, content: last.content + token };
              return copy;
            });
          }
        },
        (meta) => {
          setMessages(m => {
            const copy = [...m];
            const last = copy[copy.length - 1];
            copy[copy.length - 1] = { ...last, memoryUsed: meta.memory_used || [] };
            return copy;
          });
        },
      );
    } catch {
      setLoading(false);
      setMessages(m => [...m, {
        role: 'assistant',
        content: 'Backend offline — start the server with `make dev`',
        memoryUsed: [],
        ts: Date.now(),
      }]);
    }
  }, [input, loading, sessionId]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handlePlan = async () => {
    if (!planTopic.trim()) return;
    setPlanLoading(true);
    try {
      const data = await createRoadmap(planTopic, planBackground, sessionId);
      setMessages(m => [...m, {
        role: 'assistant',
        content: `Roadmap for "${data.topic}" created — ${data.phases.length} phases. Open the Roadmap tab to track progress.`,
        memoryUsed: [],
        ts: Date.now(),
      }]);
      setShowPlan(false);
      setPlanTopic('');
      setPlanBackground('');
    } catch {
      setMessages(m => [...m, {
        role: 'assistant',
        content: 'Planner failed — check backend logs.',
        memoryUsed: [],
        ts: Date.now(),
      }]);
    }
    setPlanLoading(false);
  };

  return (
    <div className="chat">
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`msg-row ${m.role} msg-enter`}>
            <div className="msg-inner">
              <div className={`msg-bubble ${m.role}`}>{m.content}</div>
              <div className="msg-meta">
                <span>{fmt(m.ts)}</span>
                {m.memoryUsed?.length > 0 && (
                  <span className="mem-badge">{m.memoryUsed.length} recalled</span>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="typing-wrap">
            <div className="typing-bubble">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-foot">
        <div className="chat-input-box">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(e.target); }}
            onKeyDown={handleKey}
            placeholder="Ask anything…"
            rows={1}
          />
          <div className="chat-btns">
            <button className="btn-roadmap" onClick={() => setShowPlan(true)}>
              + roadmap
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
        <div className="session-hint">{sessionId.slice(0, 8)}</div>
      </div>

      {showPlan && (
        <div
          className="plan-overlay"
          onClick={e => e.target === e.currentTarget && setShowPlan(false)}
        >
          <div className="plan-box">
            <div>
              <div className="plan-heading">Generate Roadmap</div>
              <div className="plan-sub">Creates a phased learning plan saved to the Roadmap tab.</div>
            </div>
            <input
              className="plan-input"
              placeholder="Topic — e.g. transformer architectures"
              value={planTopic}
              onChange={e => setPlanTopic(e.target.value)}
            />
            <input
              className="plan-input"
              placeholder="Your background — e.g. know Python, new to ML"
              value={planBackground}
              onChange={e => setPlanBackground(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePlan()}
            />
            {planLoading ? (
              <p className="plan-loading">Researching and building your roadmap…</p>
            ) : (
              <div className="plan-btn-row">
                <button className="btn-cancel" onClick={() => setShowPlan(false)}>Cancel</button>
                <button
                  className="btn-generate"
                  onClick={handlePlan}
                  disabled={!planTopic.trim()}
                >
                  Generate
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
