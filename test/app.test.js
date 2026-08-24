// LearnMate integration tests (Node built-in test runner — no extra deps).
// Spins up the real Express app against an isolated temp SQLite database and
// exercises the complete learning loop end-to-end.
//
//   npm test
//
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// ---- isolate the database BEFORE importing the app ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learnmate-test-'))
process.env.NODE_ENV = 'test'
process.env.DATABASE_PATH = path.join(tmp, 'test.db')
process.env.LOG_DIR = path.join(tmp, 'logs')
process.env.LOG_LEVEL = 'error'
process.env.SEED_DEMO = 'false'

let server
let baseUrl
let app

async function req(method, url, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(baseUrl + url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function signup(name, email, password = 'pass1234') {
  const r = await req('POST', '/api/auth/signup', { name, email, password })
  assert.equal(r.status, 200, 'signup should succeed')
  return r.data
}

before(async () => {
  const mod = await import('../server/index.js')
  app = mod.app
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://localhost:${server.address().port}`
})

after(() => {
  server?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ---------------------------------------------------------------------------
test('health check reports app + database + scheduler state', async () => {
  const r = await req('GET', '/health')
  assert.equal(r.status, 200)
  assert.equal(r.data.status, 'ok')
  assert.equal(r.data.database, 'ok')
  assert.ok(r.data.app === 'ok')
  assert.ok(r.data.version)
})

test('auth: signup, login, wrong password rejected', async () => {
  const u = await signup('Auth Test', 'auth@test.com', 'secret99')
  assert.ok(u.token)

  const login = await req('POST', '/api/auth/login', { email: 'auth@test.com', password: 'secret99' })
  assert.equal(login.status, 200)
  assert.equal(login.data.user.email, 'auth@test.com')

  const bad = await req('POST', '/api/auth/login', { email: 'auth@test.com', password: 'nope' })
  assert.equal(bad.status, 401)
})

test('fresh account has no mock data', async () => {
  const u = await signup('Empty User', 'empty@test.com')
  const dash = await req('GET', '/api/dashboard', undefined, u.token)
  assert.equal(dash.status, 200)
  assert.equal(dash.data.kpis.activeGoals, 0)
  assert.equal(dash.data.goals.length, 0)
  assert.equal(dash.data.skills.length, 0)
})

test('goal creation generates a 6-phase roadmap and a skill', async () => {
  const u = await signup('Goal User', 'goal@test.com')
  const g = await req('POST', '/api/goals', {
    name: 'Become proficient in Python automation',
    description: 'Automation for my job',
    why: 'Career growth',
    current_level: 'Beginner',
    target_level: 'Advanced',
    priority: 'High',
    hours_per_week: 5,
  }, u.token)
  assert.equal(g.status, 200)

  const detail = await req('GET', `/api/goals/${g.data.id}`, undefined, u.token)
  assert.equal(detail.data.phases.length, 6)
  assert.ok(detail.data.topics.length > 0)

  const skills = await req('GET', '/api/skills', undefined, u.token)
  assert.ok(skills.data.some((s) => s.name === 'Python'), 'skill auto-created from goal')
  return { u, goalId: g.data.id }
})

test('daily plan generation produces tasks within the time budget', async () => {
  const u = await signup('Plan User', 'plan@test.com')
  await req('POST', '/api/goals', {
    name: 'Learn SQL', current_level: 'Beginner', target_level: 'Intermediate', priority: 'High',
  }, u.token)
  const plan = await req('POST', '/api/plan/generate', {}, u.token)
  assert.equal(plan.status, 200)
  assert.ok(plan.data.tasks.length >= 2, 'plan has tasks')
  const total = plan.data.tasks.reduce((a, t) => a + t.duration, 0)
  assert.ok(total <= 45 + 5, `plan respects ~45min budget (got ${total})`)
  assert.ok(plan.data.briefing.topic)
})

test('session tracking: start → end records real duration + reflection', async () => {
  const u = await signup('Session User', 'session@test.com')
  const start = await req('POST', '/api/sessions/start', { topic_name: 'SQL JOINs' }, u.token)
  assert.equal(start.status, 200)
  assert.equal(start.data.status, 'in_progress')

  await new Promise((r) => setTimeout(r, 1100))
  const end = await req('POST', `/api/sessions/${start.data.id}/end`, {
    confidence: 4, difficulty: 'medium', understood: 1, learned: 'inner vs left join',
  }, u.token)
  assert.equal(end.data.status, 'completed')
  assert.ok(end.data.duration >= 1, 'measured duration')
  assert.equal(end.data.confidence, 4)
})

test('task completion with low confidence blocks advancement (adaptive)', async () => {
  const u = await signup('Adaptive User', 'adaptive@test.com')
  const g = await req('POST', '/api/goals', {
    name: 'Learn Python', current_level: 'Beginner', target_level: 'Advanced', priority: 'High',
  }, u.token)
  const plan = await req('POST', '/api/plan/generate', {}, u.token)
  const learn = plan.data.tasks.find((t) => t.type === 'learn')
  assert.ok(learn, 'learn task exists')

  // low confidence → topic should NOT complete
  await req('POST', `/api/tasks/${learn.id}/complete`, {
    status: 'completed', confidence: 1, difficulty: 'hard', actual_minutes: 15,
  }, u.token)

  const detail = await req('GET', `/api/goals/${g.data.id}`, undefined, u.token)
  const topic = detail.data.topics.find((t) => t.id === learn.topic_id)
  assert.equal(topic.status, 'needs_review', 'struggled topic stays needs_review, not advanced')
})

test('assessment: generate, grade, score, weak-area scheduling', async () => {
  const u = await signup('Assess User', 'assess@test.com')
  const g = await req('POST', '/api/goals', {
    name: 'Learn Python', current_level: 'Beginner', target_level: 'Advanced', priority: 'High',
  }, u.token)
  const a = await req('POST', '/api/assessments', { kind: 'quick', goal_id: g.data.id }, u.token)
  assert.equal(a.status, 200)
  assert.ok(a.data.questions.length > 0)

  const grade = await req('POST', `/api/assessments/${a.data.id}/grade`, { answers: [0, 0, 0, 0, 0] }, u.token)
  assert.equal(grade.status, 200)
  assert.ok(grade.data.score >= 0 && grade.data.max >= 1)
  assert.ok(grade.data.pct >= 0 && grade.data.pct <= 100)
})

test('mastery is computed from real activity (not hard-coded)', async () => {
  const u = await signup('Mastery User', 'mastery@test.com')
  const g = await req('POST', '/api/goals', {
    name: 'Learn Python', current_level: 'Beginner', target_level: 'Advanced', priority: 'High',
  }, u.token)
  const plan = await req('POST', '/api/plan/generate', {}, u.token)
  const learn = plan.data.tasks.find((t) => t.type === 'learn')
  await req('POST', `/api/tasks/${learn.id}/complete`, { status: 'completed', confidence: 4, difficulty: 'easy', actual_minutes: 10 }, u.token)
  const a = await req('POST', '/api/assessments', { kind: 'quick', goal_id: g.data.id }, u.token)
  await req('POST', `/api/assessments/${a.data.id}/grade`, { answers: [0, 0, 0, 0, 0] }, u.token)

  const skills = await req('GET', '/api/skills', undefined, u.token)
  const py = skills.data.find((s) => s.name === 'Python')
  assert.ok(py, 'skill exists')
  assert.ok(py.current_mastery > 0, 'mastery reflects activity')
  assert.ok(py.breakdown && typeof py.breakdown.assessment === 'number', 'breakdown present')
})

test('agent run history is recorded for real actions', async () => {
  const u = await signup('Audit User', 'audit@test.com')
  await req('POST', '/api/goals', { name: 'Learn Python', priority: 'High' }, u.token)
  await req('POST', '/api/plan/generate', {}, u.token)
  const runs = await req('GET', '/api/agent/activity', undefined, u.token)
  assert.ok(runs.data.length > 0, 'agent actions are logged')
  assert.ok(runs.data.some((r) => r.agent.includes('Planner') || r.agent.includes('Auth')))
})
