// LearnMate Chat Agent tests (Node built-in test runner).
// Exercises the multi-turn AI coach over the real HTTP API: intent routing,
// conversation persistence, real DB writes from tools, and per-user isolation.
//
//   npm test
//
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// ---- isolate the database BEFORE importing the app ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learnmate-chat-test-'))
process.env.NODE_ENV = 'test'
process.env.DATABASE_PATH = path.join(tmp, 'chat.db')
process.env.LOG_DIR = path.join(tmp, 'logs')
process.env.LOG_LEVEL = 'error'
process.env.SEED_DEMO = 'false'

let server
let baseUrl

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

async function signup(name, email) {
  const r = await req('POST', '/api/auth/signup', { name, email, password: 'pass1234' })
  assert.equal(r.status, 200)
  return r.data
}

async function createGoal(token, name) {
  const g = await req('POST', '/api/goals', {
    name,
    current_level: 'Beginner',
    target_level: 'Advanced',
    priority: 'High',
  }, token)
  assert.equal(g.status, 200)
  return g.data
}

async function chat(token, message, conversationId) {
  const r = await req('POST', '/api/chat', { message, conversationId }, token)
  assert.equal(r.status, 200, `chat failed: ${JSON.stringify(r.data)}`)
  return r.data
}

before(async () => {
  const mod = await import('../server/index.js')
  const app = mod.app
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://localhost:${server.address().port}`
})

after(() => {
  server?.close()
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ---------------------------------------------------------------------------
test('greeting: a new chat starts and the coach introduces itself', async () => {
  const u = await signup('Greet User', 'greet@test.com')
  const r = await chat(u.token, 'hi')
  assert.equal(r.intent, 'greeting')
  assert.ok(r.conversation, 'a conversation is created')
  assert.ok(/coach/i.test(r.reply.content))
  assert.ok(r.reply.role === 'assistant')
})

test('plan generation: creates today plan with real tasks', async () => {
  const u = await signup('Plan User', 'planchat@test.com')
  await createGoal(u.token, 'Learn Python automation')
  const r = await chat(u.token, 'what should I learn today')
  assert.equal(r.intent, 'plan')
  assert.ok(/plan/i.test(r.reply.content))
  assert.ok(Array.isArray(r.data?.tasks) && r.data.tasks.length >= 1, 'plan returns tasks')
})

test('explain topic: answers with the current roadmap topic', async () => {
  const u = await signup('Explain User', 'explainchat@test.com')
  await createGoal(u.token, 'Become proficient in Python')
  const r = await chat(u.token, 'what is my current topic')
  assert.equal(r.intent, 'explain')
  assert.ok(/Let's unpack|Python|concept/i.test(r.reply.content))
})

test('easier/harder: adjusts difficulty using conversation focus', async () => {
  const u = await signup('Diff User', 'diff@test.com')
  await createGoal(u.token, 'Learn Python')
  const harder = await chat(u.token, 'give me a harder exercise')
  assert.equal(harder.intent, 'harder')
  assert.ok(/harder|challenge|edge cases/i.test(harder.reply.content))

  const easier = await chat(u.token, 'make it easier', harder.conversation.id)
  assert.equal(easier.intent, 'easier')
  assert.ok(/easier|approachable|concrete/i.test(easier.reply.content))
})

test('task completion: writes a real DB change', async () => {
  const u = await signup('Task User', 'taskchat@test.com')
  await createGoal(u.token, 'Learn SQL')
  await req('POST', '/api/plan/generate', {}, u.token)
  const before = await req('GET', '/api/plan/today', undefined, u.token)
  const pending = (before.data.tasks || []).filter((t) => t.status !== 'completed').length
  assert.ok(pending >= 1, 'plan has pending tasks')

  const r = await chat(u.token, 'complete the task')
  assert.equal(r.intent, 'task_complete')
  assert.ok(/complete/i.test(r.reply.content))

  const after = await req('GET', '/api/plan/today', undefined, u.token)
  const done = (after.data.tasks || []).filter((t) => t.status === 'completed').length
  assert.ok(done >= 1, 'a task was actually marked completed in the DB')
})

test('persistence: messages survive across turns in one conversation', async () => {
  const u = await signup('Persist User', 'persist@test.com')
  await createGoal(u.token, 'Learn Python')
  const first = await chat(u.token, 'show me my roadmap')
  const second = await chat(u.token, 'what should I learn today', first.conversation.id)

  assert.equal(second.conversation.id, first.conversation.id)
  const conv = await req('GET', `/api/chat/conversations/${first.conversation.id}`, undefined, u.token)
  assert.equal(conv.status, 200)
  assert.ok(conv.data.messages.length >= 4, `expected >=4 messages, got ${conv.data.messages.length}`)
  const roles = conv.data.messages.map((m) => m.role)
  assert.deepEqual([...new Set(roles)].sort(), ['assistant', 'user'])
})

test('weak areas: identifies low-confidence topics', async () => {
  const u = await signup('Weak User', 'weakchat@test.com')
  // seed a low-confidence session for a specific topic
  await req('POST', '/api/sessions', { topic_name: 'Python functions', confidence: 1 }, u.token)
  const r = await chat(u.token, 'what am I weak at')
  assert.equal(r.intent, 'weak')
  assert.ok(/Python functions|weak|focus/i.test(r.reply.content))
})

test('roadmap: returns the goal roadmap phases', async () => {
  const u = await signup('Roadmap User', 'roadmapchat@test.com')
  await createGoal(u.token, 'Learn SQL')
  const r = await chat(u.token, 'show me my roadmap')
  assert.equal(r.intent, 'roadmap')
  assert.ok(/Phase 1|roadmap/i.test(r.reply.content))
  assert.ok(r.data?.phases?.length >= 4)
})

test('quiz: generates a quiz on the current topic', async () => {
  const u = await signup('Quiz User', 'quizchat@test.com')
  await createGoal(u.token, 'Learn Python')
  const r = await chat(u.token, 'quiz me')
  assert.equal(r.intent, 'quiz')
  assert.ok(/quiz/i.test(r.reply.content))
  assert.ok(r.data?.assessment?.questions?.length >= 1)
})

test('weekly review: summarizes the week', async () => {
  const u = await signup('Weekly User', 'weeklychat@test.com')
  await createGoal(u.token, 'Learn Python')
  await req('POST', '/api/sessions', { topic_name: 'Python basics', duration: 20, confidence: 4 }, u.token)
  const r = await chat(u.token, 'summarize my week')
  assert.equal(r.intent, 'weekly')
  assert.ok(/week|sessions|completion/i.test(r.reply.content))
})

test('goal creation: creates a real goal + roadmap', async () => {
  const u = await signup('Goal User', 'goalchat@test.com')
  const r = await chat(u.token, 'create a goal: become proficient in SQL')
  assert.equal(r.intent, 'goal_create')
  assert.ok(/created the goal/i.test(r.reply.content))
  const goals = await req('GET', '/api/goals', undefined, u.token)
  assert.ok(goals.data.some((g) => /SQL/i.test(g.name)), 'SQL goal was created')
})

test('profile: reports the user profile', async () => {
  const u = await signup('Profile User', 'profilechat@test.com')
  const r = await chat(u.token, 'tell me about myself')
  assert.equal(r.intent, 'profile')
  assert.ok(/Profile User|Name/i.test(r.reply.content))
})

test('deletion: deleting a conversation removes it and its messages', async () => {
  const u = await signup('Delete User', 'deletechat@test.com')
  const r = await chat(u.token, 'hello')
  const id = r.conversation.id
  const del = await req('DELETE', `/api/chat/conversations/${id}`, undefined, u.token)
  assert.equal(del.status, 200)
  assert.equal(del.data.ok, true)
  const gone = await req('GET', `/api/chat/conversations/${id}`, undefined, u.token)
  assert.equal(gone.status, 404)
})

test('cross-user isolation: conversations are never shared between users', async () => {
  const a = await signup('Alice', 'alice@test.com')
  const b = await signup('Bob', 'bob@test.com')

  const aChat = await chat(a.token, 'this is alice private chat')
  const aId = aChat.conversation.id

  // Bob cannot list Alice's conversation
  const bList = await req('GET', '/api/chat/conversations', undefined, b.token)
  assert.ok(!bList.data.some((c) => c.id === aId), "Bob must not see Alice's conversation")

  // Bob cannot read Alice's conversation
  const bRead = await req('GET', `/api/chat/conversations/${aId}`, undefined, b.token)
  assert.equal(bRead.status, 404)

  // And Bob's own chat still works
  const bChat = await chat(b.token, 'bob chat')
  assert.ok(bChat.conversation.id !== aId)
})

test('streaming: SSE endpoint returns progressive tokens then metadata', async () => {
  const u = await signup('Stream User', 'stream@test.com')
  await createGoal(u.token, 'Learn Python')
  const res = await fetch(baseUrl + `/api/chat/stream?conversationId=&message=${encodeURIComponent('what should I learn today')}`, {
    headers: { Authorization: `Bearer ${u.token}` },
  })
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.ok(text.includes('data: {'), 'emits SSE events')
  assert.ok(text.includes('"delta"'), 'streams deltas')
  assert.ok(text.includes('"meta"'), 'emits final metadata event')
})
