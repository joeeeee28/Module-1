// LearnMate Notification System tests (Node built-in test runner).
//
// Covers the end-to-end notification flow: task creation, plan generation →
// in-app notification, morning email generation, provider acceptance → status
// update, read/unread, deep links, task reminders, task-completion suppression,
// revision notifications, and email-failure handling with the in-app copy intact.
//
//   npm test
//
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// ---- isolate the database BEFORE importing the app ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learnmate-notif-test-'))
process.env.NODE_ENV = 'test'
process.env.DATABASE_PATH = path.join(tmp, 'notif.db')
process.env.LOG_DIR = path.join(tmp, 'logs')
process.env.LOG_LEVEL = 'error'
process.env.SEED_DEMO = 'false'
process.env.NOTIFICATION_ENV = 'development'
process.env.EMAIL_PROVIDER = 'log'
process.env.EMAIL_FROM = 'LearnMate <noreply@test.local>'

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

async function setupLearner(prefix) {
  const u = await signup(prefix + ' User', prefix.toLowerCase() + '@test.com')
  const g = await req('POST', '/api/goals', { name: 'Learn Python automation', current_level: 'Beginner', target_level: 'Advanced', priority: 'High' }, u.token)
  assert.equal(g.status, 200)
  return u
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
test('T1: create a learning task → task exists in the database', async () => {
  const u = await setupLearner('Task')
  const plan = await req('POST', '/api/plan/generate', {}, u.token)
  assert.equal(plan.status, 200)
  assert.ok(Array.isArray(plan.data.tasks) && plan.data.tasks.length >= 1, 'plan has tasks')
  const first = plan.data.tasks[0]
  const detail = await req('GET', '/api/plan/today', undefined, u.token)
  const found = detail.data.tasks.find((t) => t.id === first.id)
  assert.ok(found, 'task persisted in DB')
  assert.ok(found.title)
})

test('T2: generate today’s plan → in-app notification created', async () => {
  const u = await setupLearner('Plan')
  await req('POST', '/api/plan/generate', {}, u.token)
  const notif = await req('GET', '/api/notifications?channel=in-app', undefined, u.token)
  const morning = notif.data.find((n) => n.type === 'morning_briefing')
  assert.ok(morning, 'morning plan in-app notification created')
  assert.equal(morning.channel, 'in-app')
  assert.equal(morning.status, 'delivered')
})

test('T3 + T4: morning agent generates + sends morning email (provider accepts)', async () => {
  const u = await setupLearner('Morning')
  // enable verified email
  await req('PUT', '/api/notifications/preferences', { email: { enabled: true, address: 'morning@test.com', verified: true } }, u.token)
  // run the morning agent pipeline (plan + notification)
  const run = await req('POST', '/api/agent/run-morning', {}, u.token)
  assert.equal(run.status, 200)
  // drain the email queue so the provider actually processes it
  const { processEmailQueue } = await import('../server/agent/notify.js')
  await processEmailQueue()
  const notif = await req('GET', '/api/notifications/history?channel=email', undefined, u.token)
  const emailRow = notif.data.notifications.find((n) => n.type === 'morning_briefing')
  assert.ok(emailRow, 'morning email notification exists')
  assert.equal(emailRow.channel, 'email')
  assert.equal(emailRow.status, 'sent', 'email marked sent once provider accepted it')
  // an in-app copy is always available
  const inApp = await req('GET', '/api/notifications?channel=in-app', undefined, u.token)
  assert.ok(inApp.data.find((n) => n.type === 'morning_briefing'))
})

test('T5: opening a notification marks it read', async () => {
  const u = await setupLearner('Read')
  await req('POST', '/api/plan/generate', {}, u.token)
  const unread1 = await req('GET', '/api/notifications/unread', undefined, u.token)
  const list = await req('GET', '/api/notifications', undefined, u.token)
  const target = list.data.find((n) => !n.read)
  assert.ok(target)
  await req('POST', `/api/notifications/${target.id}/read`, {}, u.token)
  const unread2 = await req('GET', '/api/notifications/unread', undefined, u.token)
  assert.equal(unread2.data.count, Math.max(0, unread1.data.count - 1))
  const refreshed = await req('GET', '/api/notifications', undefined, u.token)
  const row = refreshed.data.find((n) => n.id === target.id)
  assert.equal(row.read, 1)
})

test('T6: clicking a notification deep-links to the correct page', async () => {
  const u = await setupLearner('Link')
  await req('POST', '/api/plan/generate', {}, u.token)
  const notif = await req('GET', '/api/notifications', undefined, u.token)
  const morning = notif.data.find((n) => n.type === 'morning_briefing')
  assert.ok(morning, 'morning notification exists')
  assert.ok(morning.action_url, 'notification carries a deep link')
  const pathName = morning.action_url.replace(/^https?:\/\/[^/]+/, '')
  assert.ok(pathName.startsWith('/'), 'deep link is an app route')
  assert.equal(pathName, '/today', 'morning plan links to /today')
})

test('T7: incomplete task → reminder generated per settings', async () => {
  const u = await setupLearner('Remind')
  await req('POST', '/api/plan/generate', {}, u.token)
  // leave tasks incomplete, then trigger the task-reminder generator
  const g = await req('POST', '/api/notifications/generate', { type: 'task_reminder' }, u.token)
  assert.equal(g.status, 200)
  assert.ok(g.data.created > 0, 'task reminder notification created')
  const reminders = await req('GET', '/api/notifications?channel=in-app', undefined, u.token)
  assert.ok(reminders.data.some((n) => n.type === 'task_reminder'))
})

test('T8: completed task → its reminder is suppressed', async () => {
  const u = await setupLearner('Done')
  const plan = await req('POST', '/api/plan/generate', {}, u.token)
  const pending = plan.data.tasks.filter((t) => t.status !== 'completed')
  for (const t of pending) {
    await req('POST', `/api/tasks/${t.id}/complete`, { status: 'completed', confidence: 4 }, u.token)
  }
  const g = await req('POST', '/api/notifications/generate', { type: 'task_reminder' }, u.token)
  assert.equal(g.data.created, 0, 'no reminder for fully-completed plan')
})

test('T9: revision becomes due → revision notification created', async () => {
  const u = await setupLearner('Revise')
  const { db } = await import('../server/db.js')
  const uid = u.user?.id || (await req('GET', '/api/user', undefined, u.token)).data?.id
  // direct DB insert simulates spaced-repetition scheduling a due revision
  db.prepare('INSERT INTO revision_schedule (user_id, topic_name, due_date, interval_days, status) VALUES (?,?,date(\'now\'),7,\'pending\')').run(uid, 'SQL JOINs')
  const g = await req('POST', '/api/notifications/generate', { type: 'revision' }, u.token)
  assert.ok(g.data.created > 0, 'revision notification created')
  const rev = await req('GET', '/api/notifications', undefined, u.token)
  assert.ok(rev.data.some((n) => n.type === 'revision_due'))
})

test('T10: email delivery fails → failure recorded, in-app copy stays', async () => {
  const u = await setupLearner('Fail')
  await req('PUT', '/api/notifications/preferences', { email: { enabled: true, address: 'fail@test.com', verified: true } }, u.token)
  const uid = u.user?.id || (await req('GET', '/api/user', undefined, u.token)).data?.id

  // Force a provider that cannot connect so delivery genuinely fails.
  const { config } = await import('../server/config.js')
  const { notifyUser, processEmailQueue } = await import('../server/agent/notify.js')
  config.emailProvider = 'smtp'
  config.smtpHost = '127.0.0.1'
  config.smtpPort = 1
  config.emailFrom = 'LearnMate <noreply@test.local>'

  const user = (await req('GET', '/api/user', undefined, u.token)).data
  const results = await notifyUser({
    user,
    type: 'goal_deadline',
    title: 'Deadline test',
    message: 'A test deadline',
    priority: 'high',
    metadata: { subject: 'Deadline test' },
    entityKey: `t10:${Date.now()}`,
  })
  // Exhaust the bounded retry (max 3) so the email is recorded as failed.
  await processEmailQueue()
  await processEmailQueue()
  await processEmailQueue()

  const inApp = results.find((r) => r.channel === 'in-app')
  assert.equal(inApp.status, 'delivered', 'in-app notification always delivered')
  const email = results.find((r) => r.channel === 'email')
  // Re-fetch email row for post-drain status
  const { db } = await import('../server/db.js')
  const emailRow = db.prepare('SELECT * FROM notifications WHERE id = ?').get(email.id)
  assert.equal(emailRow.status, 'failed', 'failed email recorded')
  assert.ok(emailRow.error, 'failure error recorded')
})
