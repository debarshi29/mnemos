import axios from 'axios';

const http = axios.create({ baseURL: '' }); // Vite proxy forwards to :8000

export const sendMessage = (message, sessionId) =>
  http.post('/chat', { message, session_id: sessionId }).then(r => r.data);

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
