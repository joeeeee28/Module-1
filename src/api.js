const TOKEN_KEY = 'learnmate_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request(method, url, body) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b),
  put: (u, b) => request('PUT', u, b),
  del: (u) => request('DELETE', u),

  // auth
  login: (email, password) => api.post('/api/auth/login', { email, password }),
  signup: (name, email, password) => api.post('/api/auth/signup', { name, email, password }),
  me: () => api.get('/api/auth/me'),

  // data
  user: () => api.get('/api/user'),
  saveUser: (b) => api.put('/api/user', b),
  skills: () => api.get('/api/skills'),
  addSkill: (b) => api.post('/api/skills', b),
  saveSkill: (id, b) => api.put(`/api/skills/${id}`, b),
  delSkill: (id) => api.del(`/api/skills/${id}`),

  goals: () => api.get('/api/goals'),
  createGoal: (b) => api.post('/api/goals', b),
  goal: (id) => api.get(`/api/goals/${id}`),
  saveGoal: (id, b) => api.put(`/api/goals/${id}`, b),
  delGoal: (id) => api.del(`/api/goals/${id}`),
  regenerateRoadmap: (id) => api.post(`/api/goals/${id}/roadmap`),
  saveTopic: (id, b) => api.put(`/api/topics/${id}`, b),

  today: (date) => api.get(`/api/plan/today${date ? `?date=${date}` : ''}`),
  generatePlan: (date) => api.post('/api/plan/generate', { date }),
  completeTask: (id, b) => api.post(`/api/tasks/${id}/complete`, b),
  setTaskStatus: (id, status) => api.put(`/api/tasks/${id}`, { status }),

  assessments: () => api.get('/api/assessments'),
  assessment: (id) => api.get(`/api/assessments/${id}`),
  generateAssessment: (b) => api.post('/api/assessments', b),
  grade: (id, answers) => api.post(`/api/assessments/${id}/grade`, { answers }),

  sessions: () => api.get('/api/sessions'),
  logSession: (b) => api.post('/api/sessions', b),

  resources: () => api.get('/api/resources'),
  addResource: (b) => api.post('/api/resources', b),
  delResource: (id) => api.del(`/api/resources/${id}`),

  notes: () => api.get('/api/notes'),
  note: (topicId) => api.get(`/api/notes/${topicId}`),
  saveNote: (topicId, content, goal_id) => api.put(`/api/notes/${topicId}`, { content, goal_id }),
  noteAction: (action, content) => api.post('/api/notes/action', { action, content }),

  reviews: () => api.get('/api/reviews'),
  generateReview: (period) => api.post('/api/reviews/generate', { period }),

  coach: (message) => api.post('/api/coach', { message }),
  briefing: () => api.get('/api/briefing'),
  calendar: (month) => api.get(`/api/calendar?month=${month}`),
  dashboard: () => api.get('/api/dashboard'),
  settings: () => api.get('/api/settings'),
  saveSettings: (notifications) => api.put('/api/settings', { notifications }),
}
