import { useState, useRef, useEffect } from 'react';
import { sendMessage, createRoadmap } from '../api';

const S = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: '#16241a',
  },
  header: {
    padding: '1.25rem 1.5rem 1rem',
    borderBottom: '1px solid #2b4231',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  title: { fontFamily: "'Fraunces', serif", fontSize: '1.1rem', fontWeight: 600, color: '#e9efe4' },
  sessionLabel: {
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem',
    textTransform: 'uppercase', letterSpacing: '0.16em', color: '#9ab09a',
  },
  messages: {
    flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem',
    display: 'flex', flexDirection: 'column', gap: '1rem',
  },
  bubble: (role) => ({
    maxWidth: '80%',
    alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
    background: role === 'user' ? '#c5e063' : '#1c2e21',
    color: role === 'user' ? '#101a13' : '#e9efe4',
    borderRadius: role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
    padding: '0.75rem 1rem',
    fontSize: '0.95rem',
    lineHeight: 1.55,
    fontFamily: "'Fraunces', serif",
  }),
  memoryPill: {
    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
    marginTop: '0.5rem',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.12em',
    color: '#8aa83f', background: 'rgba(197,224,99,0.08)',
    border: '1px solid rgba(197,224,99,0.2)',
    borderRadius: 99, padding: '0.2rem 0.6rem',
  },
  inputRow: {
    borderTop: '1px solid #2b4231', padding: '1rem 1.5rem',
    display: 'flex', gap: '0.75rem', alignItems: 'flex-end',
    background: '#16241a',
  },
  textarea: {
    flex: 1, resize: 'none', background: '#1c2e21',
    border: '1px solid #2b4231', borderRadius: 12,
    padding: '0.75rem 1rem', color: '#e9efe4',
    fontFamily: "'Fraunces', serif", fontSize: '0.95rem', lineHeight: 1.5,
    minHeight: 44, maxHeight: 140,
    transition: 'border-color 0.15s',
  },
  sendBtn: {
    background: '#c5e063', color: '#101a13', border: 'none',
    borderRadius: 10, padding: '0.65rem 1.2rem',
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.75rem',
    fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em',
    cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-end',
    transition: 'background 0.15s',
  },
  roadmapBtn: {
    background: 'transparent', border: '1px solid #2b4231',
    color: '#9ab09a', borderRadius: 10, padding: '0.65rem 1rem',
    fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.65rem',
    fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.1em',
    cursor: 'pointer', flexShrink: 0,
  },
  planModal: {
    position: 'fixed', inset: 0, background: 'rgba(16,26,19,0.85)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  planBox: {
    background: '#16241a', border: '1px solid #2b4231', borderRadius: 16,
    padding: '2rem', width: 420, display: 'flex', flexDirection: 'column', gap: '1rem',
  },
  input: {
    background: '#1c2e21', border: '1px solid #2b4231', borderRadius: 8,
    padding: '0.65rem 0.9rem', color: '#e9efe4',
    fontFamily: "'Fraunces', serif", fontSize: '0.9rem', width: '100%',
  },
  spinner: { color: '#9ab09a', fontSize: '0.85rem', fontStyle: 'italic', padding: '0.5rem 0' },
};

export default function Chat({ sessionId, onMemoryUsed }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hello! I\'m Mnemos, your learning copilot. What are you working on today?', memoryUsed: [] }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [planTopic, setPlanTopic] = useState('');
  const [planBackground, setPlanBackground] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const data = await sendMessage(text, sessionId);
      setMessages(m => [...m, { role: 'assistant', content: data.reply, memoryUsed: data.memory_used }]);
      if (data.memory_used?.length > 0) onMemoryUsed?.(data.memory_used);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: '(Backend offline — start the FastAPI server)', memoryUsed: [] }]);
    }
    setLoading(false);
  };

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
        content: `Roadmap created for **${data.topic}** — ${data.phases.length} phases saved to your goals. Check the Memory Inspector to see them.`,
        memoryUsed: [],
      }]);
      setShowPlan(false); setPlanTopic(''); setPlanBackground('');
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: '(Planner failed — check backend logs)', memoryUsed: [] }]);
    }
    setPlanLoading(false);
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.title}>mnemos</span>
        <span style={S.sessionLabel}>session · {sessionId.slice(0, 8)}</span>
      </div>

      <div style={S.messages}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={S.bubble(m.role)}>{m.content}</div>
            {m.memoryUsed?.length > 0 && (
              <span style={S.memoryPill}>⬡ {m.memoryUsed.length} mem used</span>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ ...S.bubble('assistant'), color: '#9ab09a', fontStyle: 'italic' }}>thinking…</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={S.inputRow}>
        <button style={S.roadmapBtn} onClick={() => setShowPlan(true)}>+ roadmap</button>
        <textarea
          style={S.textarea}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask anything…"
          rows={1}
        />
        <button style={S.sendBtn} onClick={send} disabled={loading}>Send</button>
      </div>

      {showPlan && (
        <div style={S.planModal} onClick={e => e.target === e.currentTarget && setShowPlan(false)}>
          <div style={S.planBox}>
            <span style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: '1.1rem' }}>Generate Roadmap</span>
            <input style={S.input} placeholder="Topic (e.g. transformer architectures)" value={planTopic} onChange={e => setPlanTopic(e.target.value)} />
            <input style={S.input} placeholder="Your background (e.g. know Python, new to ML)" value={planBackground} onChange={e => setPlanBackground(e.target.value)} />
            {planLoading
              ? <p style={S.spinner}>Researching and building your roadmap…</p>
              : <button style={S.sendBtn} onClick={handlePlan}>Generate</button>
            }
          </div>
        </div>
      )}
    </div>
  );
}
