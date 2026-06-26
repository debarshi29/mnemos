import axios from 'axios';

const http = axios.create({ baseURL: '' }); // Vite proxy forwards to :8000

export const sendMessage = (message, sessionId) =>
  http.post('/chat', { message, session_id: sessionId }).then(r => r.data);

/**
 * Stream a chat reply token-by-token via SSE.
 * onToken(str)  — called for each partial token
 * onDone(meta)  — called once with { episode_id, session_id, memory_used }
 */
export async function streamMessage(message, sessionId, onToken, onDone) {
  const resp = await fetch('/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop(); // retain incomplete trailing line
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = JSON.parse(line.slice(6));
      if (payload.done) onDone(payload);
      else if (payload.token) onToken(payload.token);
    }
  }
}

export const getFacts = (includeSuperseded = false) =>
  http.get('/memory/facts', { params: { include_superseded: includeSuperseded } }).then(r => r.data);

export const getFactWithProvenance = (factId) =>
  http.get(`/memory/fact/${factId}`).then(r => r.data);

export const triggerConsolidate = () =>
  http.post('/memory/consolidate', {}).then(r => r.data);

export const getConsolidationLog = () =>
  http.get('/memory/log').then(r => r.data);

export const getEpisodes = (limit = 50) =>
  http.get('/episodes', { params: { limit } }).then(r => r.data);

export const getGoals = () =>
  http.get('/goals').then(r => r.data);

export const updateGoalStatus = (goalId, status) =>
  http.patch(`/goals/${goalId}/status`, null, { params: { status } }).then(r => r.data);

export const createRoadmap = (topic, background, sessionId) =>
  http.post('/plan', { topic, background, session_id: sessionId }).then(r => r.data);

export const ingestSource = (source, kind) =>
  http.post('/memory/ingest', { source, kind }).then(r => r.data);
