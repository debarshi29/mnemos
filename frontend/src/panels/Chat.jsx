import { useState, useRef, useEffect, useCallback } from 'react';
import { sendMessage, createRoadmap } from '../api';

const S = {
  root: {
    display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0,
    background: '#101a13',
  },
  messages: {
    flex: 1, overflowY: 'auto', padding: '2rem 0',
    display: 'flex', flexDirection: 'column', gap: '0.25rem',
  },
  msgGroup: (role) => ({
    display: 'flex', flexDirection: 'column',
    alignItems: role === 'user' ? 'flex-end' : 'flex-start',
    padding: '0.2rem 1.5rem',
  }),
  bubble: (role) => ({
    maxWidth: '70%',
    background: role === 'user' ? '#c5e063' : '#16241a',
    color: role === 'user' ? '#101a13' : '#e9efe4',
    borderRadius: role === 'user' ? '20px 20px 5px 20px' : '20px 20px 20px 5px',
    padding: '0.7rem 1.05rem',
    fontSize: '0.95rem', lineHeight: 1.6,
    fontFamily: "'Fraunces', serif",
    border: role === 'user' ? 'none' : '1px solid #1f3326',
    boxShadow: role === 'user' ? '0 1px 3px rgba(0,0,0,0.25)' : 'none',
  }),
  ts: {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.55rem',
    color: '#4a6b50', marginTop: '0.25rem', letterSpacing: '0.04em',
  },
  memoryPill: {
    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
    marginTop: '0.35rem',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.12em',
    color: '#7a9a3f', background: 'rgba(197,224,99,0.07)',
    border: '1px solid rgba(197,224,99,0.18)',
    borderRadius: 99, padding: '0.15rem 0.55rem',
  },
  typingBubble: {
    background: '#16241a', border: '1px solid #1f3326',
    borderRadius: '20px 20px 20px 5px',
    padding: '0.75rem 1.05rem', display: 'inline-flex', alignItems: 'center', gap: '4px',
  },
  dot: { width: 6, height: 6, borderRadius: '50%', background: '#7a9980', display: 'inline-block' },
  inputArea: {
    borderTop: '1px solid #1f3326', padding: '1rem 1.5rem 1.25rem',
    background: '#13201a', flexShrink: 0,
  },
  inputRow: {
    display: 'flex', gap: '0.6rem', alignItems: 'flex-end',
    background: '#16241a', border: '1px solid #2b4231',
    borderRadius: 16, padding: '0.5rem 0.5rem 0.5rem 1rem',
    transition: 'border-color 0.15s',
  },
  textarea: {
    flex: 1, resize: 'none', background: 'transparent', border: 'none',
    color: '#e9efe4', fontFamily: "'Fraunces', serif",
    fontSize: '0.95rem', lineHeight: 1.55,
    minHeight: 24, maxHeight: 140, padding: '0.3rem 0',
    outline: 'none', overflow: 'auto',
  },
  actions: { display: 'flex', gap: '0.4rem', alignItems: 'flex-end', flexShrink: 0 },
  roadmapBtn: {
    background: 'transparent', border: '1px solid #2b4231',
    color: '#6b8870', borderRadius: 10, padding: '0.5rem 0.75rem',
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.62rem',
    textTransform: 'uppercase', letterSpacing: '0.1em',
    cursor: 'pointer', transition: 'all 0.12s', flexShrink: 0,
  },
  sendBtn: (disabled) => ({
    background: disabled ? '#1f3326' : '#c5e063',
    color: disabled ? '#4a6b50' : '#101a13',
    border: 'none', borderRadius: 10, padding: '0.5rem 1.1rem',
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.72rem',
    fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em',
    cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0,
    transition: 'all 0.13s',
  }),
  planModal: {
    position: 'fixed', inset: 0, background: 'rgba(16,26,19,0.8)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    backdropFilter: 'blur(4px)',
  },
  planBox: {
    background: '#16241a', border: '1px solid #2b4231', borderRadius: 18,
    padding: '2rem', width: 440, maxWidth: '90vw',
    display: 'flex', flexDirection: 'column', gap: '1rem',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  planTitle: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1.15rem', color: '#e9efe4' },
  planInput: {
    background: '#1c2e21', border: '1px solid #2b4231', borderRadius: 10,
    padding: '0.7rem 0.9rem', color: '#e9efe4',
    fontFamily: "'Fraunces', serif", fontSize: '0.9rem', width: '100%',
    outline: 'none', transition: 'border-color 0.15s',
  },
  planHint: { fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.62rem', color: '#4a6b50' },
  planSpinner: { color: '#7a9980', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: '0.5rem' },
  planBtnRow: { display: 'flex', gap: '0.6rem' },
  cancelBtn: {
    flex: 1, background: 'transparent', border: '1px solid #2b4231', borderRadius: 10,
    padding: '0.65rem', color: '#6b8870', cursor: 'pointer',
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.7rem',
    textTransform: 'uppercase', letterSpacing: '0.1em',
  },
  generateBtn: {
    flex: 2, background: '#c5e063', border: 'none', borderRadius: 10,
    padding: '0.65rem', color: '#101a13', cursor: 'pointer',
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.7rem',
    fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em',
  },
};

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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const autoResize = (el) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }
    setMessages(m => [...m, { role: 'user', content: text, ts: Date.now() }]);
    setLoading(true);
    try {
      const data = await sendMessage(text, sessionId);
      setMessages(m => [...m, {
        role: 'assistant', content: data.reply,
        memoryUsed: data.memory_used, ts: Date.now(),
      }]);
    } catch {
      setMessages(m => [...m, {
        role: 'assistant',
        content: '(Backend offline — start the FastAPI server)',
        memoryUsed: [], ts: Date.now(),
      }]);
    }
    setLoading(false);
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
        content: `Roadmap created for **${data.topic}** — ${data.phases.length} phases saved to your goals. Switch to the Roadmap tab to track progress.`,
        memoryUsed: [], ts: Date.now(),
      }]);
      setShowPlan(false); setPlanTopic(''); setPlanBackground('');
    } catch {
      setMessages(m => [...m, {
        role: 'assistant',
        content: '(Planner failed — check backend logs)',
        memoryUsed: [], ts: Date.now(),
      }]);
    }
    setPlanLoading(false);
  };

  return (
    <div style={S.root}>
      <div style={S.messages}>
        {messages.map((m, i) => (
          <div key={i} className="msg-enter" style={S.msgGroup(m.role)}>
            <div style={S.bubble(m.role)}>{m.content}</div>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <span style={S.ts}>{fmt(m.ts)}</span>
              {m.memoryUsed?.length > 0 && (
                <span style={S.memoryPill}>⬡ {m.memoryUsed.length} recalled</span>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={S.msgGroup('assistant')}>
            <div style={S.typingBubble}>
              <span className="dot-1" style={S.dot} />
              <span className="dot-2" style={S.dot} />
              <span className="dot-3" style={S.dot} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={S.inputArea}>
        <div
          style={S.inputRow}
          onFocus={e => e.currentTarget.style.borderColor = '#3d6b47'}
          onBlur={e => e.currentTarget.style.borderColor = '#2b4231'}
        >
          <textarea
            ref={textareaRef}
            style={S.textarea}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(e.target); }}
            onKeyDown={handleKey}
            placeholder="Ask anything…"
            rows={1}
          />
          <div style={S.actions}>
            <button
              style={S.roadmapBtn}
              onClick={() => setShowPlan(true)}
              onMouseEnter={e => { e.currentTarget.style.color = '#c5e063'; e.currentTarget.style.borderColor = '#3d6b47'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#6b8870'; e.currentTarget.style.borderColor = '#2b4231'; }}
            >
              + roadmap
            </button>
            <button style={S.sendBtn(!input.trim() || loading)} onClick={send} disabled={!input.trim() || loading}>
              Send
            </button>
          </div>
        </div>
        <div style={{ marginTop: '0.4rem', textAlign: 'center' }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.55rem', color: '#2e4d38', letterSpacing: '0.08em' }}>
            session · {sessionId.slice(0, 8)}
          </span>
        </div>
      </div>

      {showPlan && (
        <div style={S.planModal} onClick={e => e.target === e.currentTarget && setShowPlan(false)}>
          <div style={S.planBox}>
            <div>
              <div style={S.planTitle}>Generate Roadmap</div>
              <div style={{ ...S.planHint, marginTop: '0.25rem' }}>Creates a phased learning plan saved to your Roadmap tab.</div>
            </div>
            <input
              style={S.planInput}
              placeholder="Topic — e.g. transformer architectures"
              value={planTopic}
              onChange={e => setPlanTopic(e.target.value)}
              onFocus={e => e.target.style.borderColor = '#3d6b47'}
              onBlur={e => e.target.style.borderColor = '#2b4231'}
            />
            <input
              style={S.planInput}
              placeholder="Your background — e.g. know Python, new to ML"
              value={planBackground}
              onChange={e => setPlanBackground(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePlan()}
              onFocus={e => e.target.style.borderColor = '#3d6b47'}
              onBlur={e => e.target.style.borderColor = '#2b4231'}
            />
            {planLoading ? (
              <p style={S.planSpinner}>Researching and building your roadmap…</p>
            ) : (
              <div style={S.planBtnRow}>
                <button style={S.cancelBtn} onClick={() => setShowPlan(false)}>Cancel</button>
                <button style={S.generateBtn} onClick={handlePlan} disabled={!planTopic.trim()}>Generate</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
