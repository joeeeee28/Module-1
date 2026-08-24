import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto'
import { db, migrate, now, addDays, getSetting, setSetting, userToday } from './db.js'
import { config, logger, aiConfigured, searchConfigured, VERSION } from './config.js'
import { seedIfEmpty } from './seed.js'
import {
  generateRoadmap,
  generateDailyPlan,
  completeTask,
  recomputeAllProgress,
  computeSkillMastery,
  computeSkillMasteryDetail,
  computeGoalProgress,
  generateAssessment,
  gradeAssessment,
  generateReview,
  coach,
  getGoalWithTopics,
  computePriorityScores,
  ensureSkillForGoal,
} from './ai/engine.js'
import { aiComplete } from './ai/provider.js'
import { discoverResources, getCurrentInfo } from './ai/discovery.js'
import { recordMemory, getMemory, deriveMemory, memorySummary } from './ai/memory.js'
import { runMorningAgent } from './agent/morning.js'
import { sendNotification, listNotifications, markRead, unreadCount } from './agent/notify.js'
import { logAgentRun, listAgentRuns } from './agent/runlog.js'
import { startScheduler, isSchedulerRunning } from './agent/scheduler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// scrypt password hashing (per-user salt)
const hashPassword = (pw, salt) => scryptSync(String(pw), salt, 64).toString('hex')
const verifyPassword = (pw, salt, expected) => {
  if (!salt || !expected) return false
  const actual = hashPassword(pw, salt)
  const a = Buffer.from(actual, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

migrate()
if (config.seedDemo) {
  seedIfEmpty()
  logger.info('seed', 'Demo seed enabled — creating sample account')
}

const app = express()
app.use(express.json({ limit: '2mb' }))

// ---------------- health check ----------------
app.get('/health', (req, res) => {
  let database = 'ok'
  let databaseError = null
  try {
    db.prepare('SELECT 1 AS ok').get()
  } catch (e) {
    database = 'error'
    databaseError = e.message
  }
  const status = database === 'ok' ? 'ok' : 'degraded'
  res.status(status === 'ok' ? 200 : 503).json({
    status,
    app: 'ok',
    database,
    databaseError,
    ai: aiConfigured() ? 'model-configured' : 'deterministic-engine',
    search: searchConfigured() ? 'configured' : 'unavailable',
    scheduler: isSchedulerRunning() ? 'running' : 'stopped',
    version: VERSION,
    time: new Date().toISOString(),
  })
})

// ---------------- auth helpers ----------------
const tokens = getSetting('tokens', {})
// When AUTH_SECRET is set, only a hash of each token is stored (defense in depth).
const hashToken = (t) =>
  config.authSecret ? createHmac('sha256', config.authSecret).update(t).digest('hex') : t
function issueToken(userId) {
  const tok = randomBytes(24).toString('hex')
  tokens[hashToken(tok)] = userId
  setSetting('tokens', tokens)
  return tok
}
function userIdFrom(req) {
  const h = req.headers.authorization || ''
  const tok = h.replace(/^Bearer\s+/i, '')
  return tokens[hashToken(tok)] || null
}
function currentUser(req) {
  const uid = userIdFrom(req) || db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id
  return db.prepare('SELECT * FROM users WHERE id = ?').get(uid) || null
}

// ---------------- auth ----------------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user) return res.status(401).json({ error: 'No account found for that email.' })
  if (user.password_hash && !verifyPassword(password || '', user.password_salt, user.password_hash))
    return res.status(401).json({ error: 'Incorrect password.' })
  const token = issueToken(user.id)
  const { password_hash, password_salt, ...safe } = user
  res.json({ token, user: safe })
})

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, timezone } = req.body || {}
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' })
  if (!password || String(password).length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' })
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) return res.status(409).json({ error: 'An account with that email already exists.' })
  const salt = randomBytes(16).toString('hex')
  const ins = db
    .prepare('INSERT INTO users (name, email, password_hash, password_salt, timezone) VALUES (?,?,?,?,?)')
    .run(name, email, hashPassword(password, salt), salt, timezone || 'UTC')
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ins.lastInsertRowid))
  const token = issueToken(user.id)
  const { password_hash, password_salt, ...safe } = user
  logAgentRun(user.id, 'Auth Agent', 'Account created', `email=${email}`)
  res.json({ token, user: safe })
})

app.get('/api/auth/me', (req, res) => {
  const u = currentUser(req)
  if (!u) return res.status(401).json({ error: 'Not authenticated' })
  const { password_hash, password_salt, ...safe } = u
  res.json({ user: safe })
})

// Non-secret runtime capabilities — lets the UI label AI/data sources honestly.
app.get('/api/config', (req, res) => {
  res.json({
    aiConfigured: aiConfigured(),
    searchConfigured: searchConfigured(),
    telegramConfigured: Boolean(config.telegramBotToken && config.telegramChatId),
    webhookConfigured: Boolean(config.webhookUrl),
    emailConfigured: Boolean(config.smtpHost && config.smtpFrom),
    seedDemo: config.seedDemo,
    version: VERSION,
  })
})

// ---------------- profile ----------------
app.get('/api/user', (req, res) => {
  const u = currentUser(req)
  if (!u) return res.status(404).json({ error: 'No user' })
  const { password_hash, ...safe } = u
  res.json(safe)
})

app.put('/api/user', (req, res) => {
  const u = currentUser(req)
  if (!u) return res.status(404).json({ error: 'No user' })
  const b = req.body || {}
  const fields = ['name', 'role', 'career_goal', 'target_role', 'experience_level', 'daily_learning_minutes', 'preferred_days', 'briefing_time', 'learning_style', 'bio', 'timezone', 'notification_channel']
  const sets = []
  const vals = []
  for (const f of fields) {
    if (f in b) {
      sets.push(`${f} = ?`)
      vals.push(f === 'preferred_days' ? JSON.stringify(b[f]) : b[f])
    }
  }
  if (sets.length) {
    vals.push(u.id)
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  }
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)
  const { password_hash, password_salt, ...safe } = updated
  res.json(safe)
})

// ---------------- skills ----------------
app.get('/api/skills', (req, res) => {
  const uid = currentUser(req)?.id
  const skills = db.prepare('SELECT * FROM skills WHERE user_id = ? ORDER BY category, name').all(uid)
  res.json(skills.map((s) => ({ ...s, breakdown: computeSkillMasteryDetail(s) })))
})
app.post('/api/skills', (req, res) => {
  const uid = currentUser(req)?.id
  const { name, category, target_mastery, current_level, target_level } = req.body || {}
  if (!name) return res.status(400).json({ error: 'Skill name required' })
  const ins = db
    .prepare('INSERT INTO skills (user_id, name, category, target_mastery, current_level, target_level) VALUES (?,?,?,?,?,?)')
    .run(uid, name, category || 'Technical', target_mastery || 80, current_level || 'Beginner', target_level || 'Advanced')
  res.json(db.prepare('SELECT * FROM skills WHERE id = ?').get(Number(ins.lastInsertRowid)))
})
app.put('/api/skills/:id', (req, res) => {
  const uid = currentUser(req)?.id
  const b = req.body || {}
  const fields = ['name', 'category', 'target_mastery', 'current_level', 'target_level']
  const sets = []
  const vals = []
  for (const f of fields) if (f in b) { sets.push(`${f} = ?`); vals.push(b[f]) }
  if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE skills SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, uid) }
  res.json(db.prepare('SELECT * FROM skills WHERE id = ?').get(req.params.id))
})
app.delete('/api/skills/:id', (req, res) => {
  const uid = currentUser(req)?.id
  db.prepare('DELETE FROM skills WHERE id = ? AND user_id = ?').run(req.params.id, uid)
  res.json({ ok: true })
})

// ---------------- goals ----------------
app.get('/api/goals', (req, res) => {
  const uid = currentUser(req)?.id
  const goals = db.prepare(`SELECT * FROM goals WHERE user_id = ? ORDER BY CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, created_at DESC`).all(uid)
  res.json(goals)
})
app.post('/api/goals', (req, res) => {
  const uid = currentUser(req)?.id
  const b = req.body || {}
  if (!b.name) return res.status(400).json({ error: 'Goal name required' })
  const ins = db
    .prepare(
      `INSERT INTO goals (user_id, name, description, why, target_outcome, current_level, target_level, priority, deadline, hours_per_week, preferred_method, resources_json, related_goal)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      uid,
      b.name,
      b.description || '',
      b.why || '',
      b.target_outcome || '',
      b.current_level || 'Beginner',
      b.target_level || 'Advanced',
      b.priority || 'Medium',
      b.deadline || null,
      b.hours_per_week || 5,
      b.preferred_method || 'Hands-on / project-based',
      JSON.stringify(b.resources || []),
      b.related_goal || null
    )
  const id = Number(ins.lastInsertRowid)
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(id)
  generateRoadmap(id)
  ensureSkillForGoal(goal)
  recomputeAllProgress(uid)
  res.json(db.prepare('SELECT * FROM goals WHERE id = ?').get(id))
})
app.get('/api/goals/:id', (req, res) => {
  const uid = currentUser(req)?.id
  const g = getGoalWithTopics(req.params.id)
  if (!g || g.user_id !== uid) return res.status(404).json({ error: 'Not found' })
  res.json(g)
})
app.put('/api/goals/:id', (req, res) => {
  const uid = currentUser(req)?.id
  const b = req.body || {}
  const fields = ['name', 'description', 'why', 'target_outcome', 'current_level', 'target_level', 'priority', 'deadline', 'hours_per_week', 'preferred_method', 'related_goal', 'status']
  const sets = []
  const vals = []
  for (const f of fields) if (f in b) { sets.push(`${f} = ?`); vals.push(b[f]) }
  if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE goals SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, uid) }
  recomputeAllProgress(uid)
  res.json(db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id))
})
app.delete('/api/goals/:id', (req, res) => {
  const uid = currentUser(req)?.id
  db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').run(req.params.id, uid)
  recomputeAllProgress(uid)
  res.json({ ok: true })
})
app.post('/api/goals/:id/roadmap', (req, res) => {
  res.json(generateRoadmap(req.params.id))
})

// ---------------- topics ----------------
app.put('/api/topics/:id', (req, res) => {
  const uid = currentUser(req)?.id
  const b = req.body || {}
  const fields = ['name', 'description', 'difficulty', 'estimated_minutes', 'status']
  const sets = []
  const vals = []
  for (const f of fields) if (f in b) { sets.push(`${f} = ?`); vals.push(b[f]) }
  for (const f of ['concepts', 'exercises', 'success_criteria']) {
    if (f in b) { sets.push(`${f}_json = ?`); vals.push(JSON.stringify(b[f])) }
  }
  if ('project' in b) { sets.push('project = ?'); vals.push(b.project) }
  if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE topics SET ${sets.join(', ')} WHERE id = ?`).run(...vals) }
  recomputeAllProgress(uid)
  res.json(db.prepare('SELECT * FROM topics WHERE id = ?').get(req.params.id))
})

// ---------------- daily plan + tasks ----------------
app.get('/api/plan/today', (req, res) => {
  const uid = currentUser(req)?.id
  const u = currentUser(req)
  const date = req.query.date || userToday(u)
  let plan = db.prepare('SELECT * FROM daily_plans WHERE date = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get(date, uid)
  if (!plan) {
    const u = currentUser(req)
    plan = generateDailyPlan(u, date).plan
  }
  const tasks = db.prepare('SELECT * FROM tasks WHERE daily_plan_id = ? ORDER BY sort').all(plan.id)
  res.json({ plan, tasks, briefing: JSON.parse(plan.briefing_json || '{}') })
})
app.post('/api/plan/generate', (req, res) => {
  const u = currentUser(req)
  const date = req.body?.date || userToday(u)
  const { plan, briefing } = generateDailyPlan(u, date)
  const tasks = db.prepare('SELECT * FROM tasks WHERE daily_plan_id = ? ORDER BY sort').all(plan.id)
  logAgentRun(u.id, 'Planner Agent', 'Generated daily plan (manual)', `planId=${plan.id} topic=${briefing.topic}`)
  res.json({ plan, tasks, briefing })
})
app.post('/api/tasks/:id/complete', (req, res) => {
  const uid = currentUser(req)?.id
  try {
    completeTask(req.params.id, req.body || {})
    deriveMemory(uid)
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})
app.put('/api/tasks/:id', (req, res) => {
  const b = req.body || {}
  if (b.status) db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(b.status, req.params.id)
  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id))
})

// ---------------- assessments ----------------
app.get('/api/assessments', (req, res) => {
  const uid = currentUser(req)?.id
  const list = db.prepare('SELECT * FROM assessments WHERE user_id = ? ORDER BY date DESC, id DESC').all(uid)
  res.json(list)
})
app.get('/api/assessments/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
  if (!a) return res.status(404).json({ error: 'Not found' })
  a.questions = JSON.parse(a.questions_json || '[]')
  res.json(a)
})
app.post('/api/assessments', (req, res) => {
  const { kind, goal_id, topic_id } = req.body || {}
  const a = generateAssessment(kind || 'quick', goal_id, topic_id || null)
  a.questions = JSON.parse(a.questions_json || '[]')
  res.json(a)
})
app.post('/api/assessments/:id/grade', (req, res) => {
  const { answers } = req.body || {}
  res.json(gradeAssessment(req.params.id, answers || []))
})

// ---------------- sessions / reflection ----------------
app.get('/api/sessions', (req, res) => {
  const uid = currentUser(req)?.id
  const sessions = db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 200').all(uid)
  res.json(sessions)
})
app.post('/api/sessions', (req, res) => {
  const uid = currentUser(req)?.id
  const b = req.body || {}
  const ins = db
    .prepare(
      `INSERT INTO sessions (user_id, date, duration, goal_id, topic_id, topic_name, confidence, difficulty, notes, learned, status, kind)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(uid, now(), b.duration || 0, b.goal_id || null, b.topic_id || null, b.topic_name || null, b.confidence || null, b.difficulty || null, b.notes || null, b.learned || null, 'completed', 'reflect')
  recomputeAllProgress(uid)
  res.json(db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(ins.lastInsertRowid)))
})

// Real session tracker: START → (time passes) → END with reflection.
app.post('/api/sessions/start', (req, res) => {
  const uid = currentUser(req)?.id
  const { goal_id, topic_id, topic_name } = req.body || {}
  const nowIso = new Date().toISOString()
  const ins = db
    .prepare(
      `INSERT INTO sessions (user_id, date, goal_id, topic_id, topic_name, status, kind, started_at)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(uid, userToday(currentUser(req)), goal_id || null, topic_id || null, topic_name || null, 'in_progress', 'learn', nowIso)
  logAgentRun(uid, 'Session Agent', 'Started learning session', `sessionId=${ins.lastInsertRowid}`)
  res.json(db.prepare('SELECT * FROM sessions WHERE id = ?').get(Number(ins.lastInsertRowid)))
})
app.get('/api/sessions/active', (req, res) => {
  const uid = currentUser(req)?.id
  const active = db.prepare(`SELECT * FROM sessions WHERE user_id = ? AND status='in_progress' ORDER BY id DESC LIMIT 1`).get(uid)
  res.json(active || null)
})
app.post('/api/sessions/:id/end', (req, res) => {
  const uid = currentUser(req)?.id
  const b = req.body || {}
  const s = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, uid)
  if (!s) return res.status(404).json({ error: 'Session not found' })
  const endedAt = new Date().toISOString()
  const duration = s.started_at ? Math.max(1, Math.round((new Date(endedAt) - new Date(s.started_at)) / 60000)) : (b.duration || 0)
  db.prepare(
    `UPDATE sessions SET status='completed', ended_at=?, duration=?, confidence=?, difficulty=?, notes=?, learned=?, understood=?, difficult_part=?, need_help=? WHERE id=?`
  ).run(endedAt, duration, b.confidence ?? null, b.difficulty ?? null, b.notes ?? null, b.learned ?? null, b.understood ?? null, b.difficult ?? null, b.need_help ?? null, s.id)
  recomputeAllProgress(uid)
  deriveMemory(uid)
  logAgentRun(uid, 'Session Agent', 'Ended learning session', `sessionId=${s.id} duration=${duration}m`)
  res.json(db.prepare('SELECT * FROM sessions WHERE id = ?').get(s.id))
})

// ---------------- resources ----------------
app.get('/api/resources', (req, res) => {
  const uid = currentUser(req)?.id
  const list = db.prepare('SELECT * FROM resources WHERE user_id = ? ORDER BY id DESC').all(uid)
  res.json(list)
})
app.post('/api/resources', (req, res) => {
  const uid = currentUser(req)?.id
  const b = req.body || {}
  if (!b.title) return res.status(400).json({ error: 'Title required' })
  const ins = db
    .prepare('INSERT INTO resources (user_id, goal_id, topic_id, title, url, type, notes) VALUES (?,?,?,?,?,?,?)')
    .run(uid, b.goal_id || null, b.topic_id || null, b.title, b.url || null, b.type || 'Website', b.notes || null)
  res.json(db.prepare('SELECT * FROM resources WHERE id = ?').get(Number(ins.lastInsertRowid)))
})
app.delete('/api/resources/:id', (req, res) => {
  const uid = currentUser(req)?.id
  db.prepare('DELETE FROM resources WHERE id = ? AND user_id = ?').run(req.params.id, uid)
  res.json({ ok: true })
})
// Live resource discovery — real lookups with honest source/verification labels.
app.post('/api/resources/discover', async (req, res) => {
  const uid = currentUser(req)?.id
  const { topic, goal_id } = req.body || {}
  if (!topic) return res.status(400).json({ error: 'Topic required' })
  try {
    const results = await discoverResources(topic, { limit: 8 })
    logAgentRun(uid, 'Resource Agent', 'Discovered resources', `${topic}: ${results.length} results`, results.length ? 'SUCCESS' : 'EMPTY')
    res.json({ topic, results, liveAvailable: results.some((r) => r.verified) })
  } catch (e) {
    logger.error('resources', 'Discovery failed', { error: e.message })
    logAgentRun(uid, 'Resource Agent', 'Discovery failed', e.message, 'FAILED')
    res.json({ topic, results: [], liveAvailable: false, message: 'Live resource discovery is temporarily unavailable. Using your saved resources instead.' })
  }
})
app.post('/api/resources/import', (req, res) => {
  const uid = currentUser(req)?.id
  const { goal_id, topic, items } = req.body || {}
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' })
  const ins = db.prepare(
    `INSERT INTO resources (user_id, goal_id, topic_id, title, url, type, source, topic, verified, last_verified)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  )
  const saved = []
  for (const it of items) {
    const r = ins.run(uid, goal_id || null, it.topic_id || null, it.title, it.url, it.type || 'Web', it.source || 'discovered', topic || null, it.verified ? 1 : 0, it.lastVerified || null)
    saved.push(db.prepare('SELECT * FROM resources WHERE id = ?').get(Number(r.lastInsertRowid)))
  }
  res.json(saved)
})

// ---------------- notes ----------------
app.get('/api/notes', (req, res) => {
  const uid = currentUser(req)?.id
  const rows = db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC').all(uid)
  res.json(rows)
})
app.get('/api/notes/:topicId', (req, res) => {
  const uid = currentUser(req)?.id
  const n = db.prepare('SELECT * FROM notes WHERE topic_id = ? AND user_id = ?').get(req.params.topicId, uid)
  res.json(n || { topic_id: req.params.topicId, content: '' })
})
app.put('/api/notes/:topicId', (req, res) => {
  const uid = currentUser(req)?.id
  const { content, goal_id } = req.body || {}
  const existing = db.prepare('SELECT id FROM notes WHERE topic_id = ? AND user_id = ?').get(req.params.topicId, uid)
  if (existing) {
    db.prepare("UPDATE notes SET content = ?, updated_at = datetime('now') WHERE topic_id = ? AND user_id = ?").run(content || '', req.params.topicId, uid)
  } else {
    db.prepare('INSERT INTO notes (user_id, goal_id, topic_id, content) VALUES (?,?,?,?)').run(uid, goal_id || null, req.params.topicId, content || '')
  }
  res.json(db.prepare('SELECT * FROM notes WHERE topic_id = ? AND user_id = ?').get(req.params.topicId, uid))
})
app.post('/api/notes/action', (req, res) => {
  const { action, content } = req.body || {}
  res.json(noteAction(action, content))
})

function noteAction(action, content) {
  const text = content || ''
  const headings = [...text.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1])
  const bullets = [...text.matchAll(/^[-*]\s+(.+)$/gm)].map((m) => m[1])
  const lines = text.split('\n').filter((l) => l.trim())
  switch (action) {
    case 'summarize':
      return {
        title: 'Summary',
        content:
          `**Summary**\n\n${headings.length ? 'Key sections: ' + headings.join(' · ') + '\n\n' : ''}` +
          `${bullets.length ? bullets.map((b) => `- ${b}`).join('\n') : ''}` +
          `${!headings.length && !bullets.length ? (text.length > 300 ? text.slice(0, 300) + '…' : text) : ''}`,
      }
    case 'flashcards':
      return {
        title: 'Flashcards',
        content:
          (headings.length
            ? headings.map((h, i) => `**Q${i + 1}:** What is the key idea of "${h}"?\n\n**A:** ${bullets[i] || 'Summarize it in your own words — then check your notes.'}\n\n---\n`).join('\n')
            : bullets.length
              ? bullets.map((b, i) => `**Q${i + 1}:** ${b.replace(/^[A-Z][^.]+/, (m) => m)}?\n\n**A:** Recall from memory, then verify.\n\n---\n`).join('\n')
              : 'Add headings or bullet points to your notes to auto-generate flashcards.')
          .replace(/\n---\n$/, ''),
      }
    case 'quiz':
      return {
        title: 'Quiz questions',
        content:
          (headings.length ? headings.map((h, i) => `${i + 1}. Explain "${h}" and give an example.\n`).join('') : '') +
          (bullets.length ? bullets.map((b, i) => `${(headings.length || 0) + i + 1}. True or false: ${b}\n`).join('') : ''),
      }
    case 'gaps': {
      const questions = text.split('\n').filter((l) => /\?\s*$/.test(l.trim()))
      const gaps = questions.length
        ? questions
        : headings.length
          ? headings.map((h) => `"${h}" — expand with an example and an edge case.`)
          : ['Add question marks (?) or section headings to help me spot gaps.']
      return { title: 'Identified gaps', content: gaps.map((g, i) => `${i + 1}. ${g}`).join('\n') }
    }
    case 'simplify':
      return {
        title: 'Simplified',
        content:
          '**In plain terms:**\n\n' +
          (bullets.length
            ? bullets.map((b) => `- ${b.replace(/\b(utilize|leverage|facilitate|subsequently|aforementioned|comprehensive|significant)\b/gi, (w) => ({ utilize: 'use', leverage: 'use', facilitate: 'help', subsequently: 'later', aforementioned: 'the above', comprehensive: 'full', significant: 'big' }[w.toLowerCase()] || w))}`).join('\n')
            : text.replace(/\b(utilize|leverage|facilitate|subsequently|aforementioned|comprehensive|significant)\b/gi, (w) => ({ utilize: 'use', leverage: 'use', facilitate: 'help', subsequently: 'later', aforementioned: 'the above', comprehensive: 'full', significant: 'big' }[w.toLowerCase()] || w))),
      }
    default:
      return { title: 'Action', content: text }
  }
}

// ---------------- reviews ----------------
app.get('/api/reviews', (req, res) => {
  const uid = currentUser(req)?.id
  const list = db.prepare('SELECT * FROM reviews WHERE user_id = ? ORDER BY id DESC').all(uid).map((r) => ({ ...r, summary: JSON.parse(r.summary_json || '{}') }))
  res.json(list)
})
app.post('/api/reviews/generate', (req, res) => {
  const uid = currentUser(req)?.id
  const period = req.body?.period === 'monthly' ? 'monthly' : 'weekly'
  res.json(generateReview(period, uid))
})

// ---------------- coach ----------------
app.post('/api/coach', async (req, res) => {
  const uid = currentUser(req)?.id
  const { message } = req.body || {}
  if (!message) return res.status(400).json({ error: 'Message required' })

  // 1. deterministic engine always runs first — it owns the user's data and
  //    produces honest, context-aware answers (quiz generation, next-step, …)
  const engineReply = coach(message, uid)

  // 2. If a real model is configured, ask it with full context and use its
  //    answer for open-ended questions (explain, advise, motivate, …)
  if (aiConfigured() && isOpenEnded(message)) {
    const ctx = coachContextFor(uid)
    const system =
      'You are a personal learning coach. Use ONLY the provided user context. ' +
      'Be concise and practical. If the context lacks data, say so. Never invent ' +
      'the user\'s progress. Mark recommendations as recommendations, not facts.'
    const text = await aiComplete(system, `User context:\n${ctx}\n\nUser question: ${message}`)
    if (text) {
      logAgentRun(uid, 'Coach Agent', 'Answered via AI model', message.slice(0, 80))
      return res.json({ role: 'ai', text, type: 'text', source: 'model', context: engineReply.context })
    }
  }

  logAgentRun(uid, 'Coach Agent', 'Answered via engine', message.slice(0, 80))
  res.json({ ...engineReply, source: 'engine' })
})

function isOpenEnded(msg) {
  const m = (msg || '').toLowerCase()
  return !/quiz|test me/.test(m)
}

function coachContextFor(uid) {
  const goals = db.prepare(`SELECT name, status, progress, deadline FROM goals WHERE user_id = ?`).all(uid)
  const skills = db.prepare(`SELECT name, current_mastery, current_level FROM skills WHERE user_id = ?`).all(uid)
  const recent = db.prepare(`SELECT date, topic_name, confidence, difficulty FROM sessions WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 10`).all(uid)
  const assessments = db.prepare(`SELECT title, score, max_score FROM assessments WHERE user_id = ? AND completed=1 ORDER BY date DESC LIMIT 5`).all(uid)
  const mem = memorySummary(uid)
  return JSON.stringify({ goals, skills, recentSessions: recent, assessments, memory: mem }, null, 2)
}

// ---------------- briefing ----------------
app.get('/api/briefing', (req, res) => {
  const uid = currentUser(req)?.id
  const u = currentUser(req)
  const date = userToday(u)
  let plan = db.prepare('SELECT * FROM daily_plans WHERE date = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get(date, uid)
  if (!plan) {
    const u = currentUser(req)
    plan = generateDailyPlan(u, date).plan
  }
  res.json(JSON.parse(plan.briefing_json || '{}'))
})

// ---------------- calendar ----------------
app.get('/api/calendar', (req, res) => {
  const uid = currentUser(req)?.id
  const month = req.query.month || now().slice(0, 7)
  const events = []
  const plans = db.prepare('SELECT * FROM daily_plans WHERE date LIKE ? AND user_id = ?').all(month + '%', uid)
  for (const p of plans) {
    const done = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE daily_plan_id = ? AND status='completed'`).get(p.id).c
    const total = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE daily_plan_id = ?`).get(p.id).c
    events.push({ date: p.date, type: 'session', title: p.topic, status: done && done === total ? 'completed' : done ? 'partial' : 'planned', meta: `${done}/${total} tasks` })
  }
  const deadlines = db.prepare(`SELECT * FROM goals WHERE deadline IS NOT NULL AND deadline LIKE ? AND user_id = ?`).all(month + '%', uid)
  for (const g of deadlines) events.push({ date: g.deadline, type: 'deadline', title: `Deadline: ${g.name}`, status: 'planned' })
  const revisions = db.prepare(`SELECT * FROM revision_schedule WHERE due_date LIKE ? AND user_id = ?`).all(month + '%', uid)
  for (const r of revisions) events.push({ date: r.due_date, type: 'revision', title: `Revise: ${r.topic_name}`, status: r.status === 'pending' ? 'planned' : 'completed' })
  const skipped = db.prepare(`SELECT t.*, p.date FROM tasks t JOIN daily_plans p ON p.id = t.daily_plan_id WHERE t.status='skipped' AND p.date LIKE ? AND p.user_id = ?`).all(month + '%', uid)
  for (const s of skipped) events.push({ date: s.date, type: 'missed', title: s.title, status: 'missed' })
  res.json(events)
})

// ---------------- dashboard ----------------
app.get('/api/dashboard', (req, res) => {
  const u = currentUser(req)
  const uid = u.id
  const date = userToday(u)

  let plan = db.prepare('SELECT * FROM daily_plans WHERE date = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get(date, uid)
  if (!plan) plan = generateDailyPlan(u, date).plan
  const tasks = db.prepare('SELECT * FROM tasks WHERE daily_plan_id = ? ORDER BY sort').all(plan.id)
  const doneTasks = tasks.filter((t) => t.status === 'completed').length

  const skills = db.prepare('SELECT * FROM skills WHERE user_id = ?').all(uid)
  const goals = db.prepare(`SELECT * FROM goals WHERE user_id = ? AND status != 'archived'`).all(uid)
  const activeGoals = goals.filter((g) => g.status === 'active')

  const sessions = db.prepare(`SELECT * FROM sessions WHERE status='completed' AND user_id = ?`).all(uid)
  const totalMinutes = sessions.reduce((a, s) => a + (s.duration || 0), 0)

  // weekly
  const weekStart = addDays(date, -6)
  const weekTasks = db.prepare(`SELECT t.* FROM tasks t JOIN daily_plans p ON p.id = t.daily_plan_id WHERE p.date >= ? AND p.user_id = ?`).all(weekStart, uid)
  const weekDone = weekTasks.filter((t) => t.status === 'completed').length
  const weekPlannedMin = db.prepare(`SELECT COALESCE(SUM(estimated_minutes),0) s FROM daily_plans WHERE date >= ? AND user_id = ?`).get(weekStart, uid).s
  const weekActualMin = sessions.filter((s) => s.date >= weekStart).reduce((a, s) => a + (s.duration || 0), 0)
  const weekAssess = db.prepare(`SELECT * FROM assessments WHERE completed=1 AND date >= ? AND user_id = ?`).all(weekStart, uid)
  const weekAssessScore = weekAssess.length ? Math.round(weekAssess.reduce((a, x) => a + (x.score / (x.max_score || 1)) * 100, 0) / weekAssess.length) : null

  const avgMastery = skills.length ? Math.round(skills.reduce((a, s) => a + s.current_mastery, 0) / skills.length) : 0
  const skillsInProgress = skills.filter((s) => s.current_mastery < (s.target_mastery || 80) && s.current_mastery > 0).length

  const streak = computeStreak(uid)

  // upcoming
  const upcoming = []
  for (const g of activeGoals) {
    if (g.deadline) upcoming.push({ type: 'deadline', title: `Deadline: ${g.name}`, date: g.deadline })
  }
  const revs = db.prepare(`SELECT * FROM revision_schedule WHERE status='pending' AND due_date >= ? AND user_id = ? ORDER BY due_date LIMIT 5`).all(date, uid)
  for (const r of revs) upcoming.push({ type: 'revision', title: `Revise: ${r.topic_name}`, date: r.due_date })
  upcoming.sort((a, b) => a.date.localeCompare(b.date))

  res.json({
    user: u,
    today: { date, done: doneTasks, total: tasks.length, plan, tasks, briefing: JSON.parse(plan.briefing_json || '{}') },
    kpis: {
      streak,
      learningHours: Math.round((totalMinutes / 60) * 10) / 10,
      skillsInProgress,
      completionRate: weekTasks.length ? Math.round((weekDone / weekTasks.length) * 100) : 0,
      masteryScore: avgMastery,
      activeGoals: activeGoals.length,
    },
    goals: activeGoals.map((g) => ({ ...g })),
    skills,
    weekly: {
      plannedHours: (weekPlannedMin / 60).toFixed(1),
      actualHours: (weekActualMin / 60).toFixed(1),
      completion: weekTasks.length ? Math.round((weekDone / weekTasks.length) * 100) : 0,
      assessmentScore: weekAssessScore,
    },
    upcoming,
  })
})

function computeStreak(userId) {
  const rows = db.prepare(`SELECT DISTINCT date FROM sessions WHERE status='completed' AND user_id = ? ORDER BY date DESC`).all(userId).map((r) => r.date)
  const set = new Set(rows)
  let streak = 0
  let d = now()
  if (!set.has(d)) d = addDays(d, -1)
  while (set.has(d)) { streak += 1; d = addDays(d, -1) }
  return streak
}

// ---------------- settings / notifications ----------------
app.get('/api/settings', (req, res) => {
  const notif = getSetting('notifications', {
    morningBriefing: true,
    learningReminder: true,
    deadlineReminder: true,
    revisionReminder: true,
    weeklyReview: true,
  })
  const u = currentUser(req)
  res.json({ notifications: notif, briefingTime: u?.briefing_time || '07:30', timezone: u?.timezone || 'UTC', channel: u?.notification_channel || 'in-app' })
})
app.put('/api/settings', (req, res) => {
  const u = currentUser(req)
  if (req.body?.notifications) setSetting('notifications', req.body.notifications)
  if (req.body?.timezone || req.body?.channel) {
    const sets = []
    const vals = []
    if (req.body.timezone) { sets.push('timezone = ?'); vals.push(req.body.timezone) }
    if (req.body.channel) { sets.push('notification_channel = ?'); vals.push(req.body.channel) }
    vals.push(u.id)
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  }
  res.json({ ok: true })
})

// In-app notification inbox + read state.
app.get('/api/notifications', (req, res) => {
  const uid = currentUser(req)?.id
  res.json(listNotifications(uid))
})
app.get('/api/notifications/unread', (req, res) => {
  const uid = currentUser(req)?.id
  res.json({ count: unreadCount(uid) })
})
app.post('/api/notifications/:id/read', (req, res) => {
  const uid = currentUser(req)?.id
  markRead(uid, req.params.id)
  res.json({ ok: true })
})
app.post('/api/notifications/read-all', (req, res) => {
  const uid = currentUser(req)?.id
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(uid)
  res.json({ ok: true })
})

// ---------------- agent (automation) ----------------
app.get('/api/agent/activity', (req, res) => {
  const uid = currentUser(req)?.id
  const limit = Number(req.query.limit || 100)
  res.json(listAgentRuns(uid, limit))
})
// Manual morning-agent run (for the current user).
app.post('/api/agent/run-morning', async (req, res) => {
  const uid = currentUser(req)?.id
  try {
    const result = await runMorningAgent(uid, { notify: true })
    res.json({ ok: true, skipped: result.skipped || false, briefing: result.briefing })
  } catch (e) {
    logger.error('agent', 'run-morning failed', { error: e.message, stack: e.stack })
    res.status(500).json({ error: e.message })
  }
})
// Cron-triggered morning runs for ALL users (protected by ADMIN_TOKEN).
app.post('/api/agent/cron/morning', async (req, res) => {
  const auth = req.headers['x-admin-token'] || req.query.token
  if (!config.adminToken || auth !== config.adminToken) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const users = db.prepare('SELECT * FROM users').all()
  const results = []
  for (const u of users) {
    try {
      const r = await runMorningAgent(u.id, { notify: true })
      results.push({ userId: u.id, skipped: r.skipped || false, topic: r.briefing.topic })
    } catch (e) {
      results.push({ userId: u.id, error: e.message })
    }
  }
  res.json({ ran: users.length, results })
})

// ---------------- learning memory ----------------
app.get('/api/memory', (req, res) => {
  const uid = currentUser(req)?.id
  const mem = getMemory(uid)
  res.json({ entries: mem, summary: memorySummary(uid) })
})
app.post('/api/memory', (req, res) => {
  const uid = currentUser(req)?.id
  const { category, content } = req.body || {}
  if (!category || !content) return res.status(400).json({ error: 'category and content required' })
  recordMemory(uid, category, content, 'user')
  res.json({ ok: true })
})

// ---------------- projects ----------------
app.get('/api/projects', (req, res) => {
  const uid = currentUser(req)?.id
  const projects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY id DESC').all(uid)
  res.json(projects.map((p) => ({ ...p, requirements: JSON.parse(p.requirements_json || '[]'), technologies: JSON.parse(p.technologies_json || '[]'), milestones: JSON.parse(p.milestones_json || '[]') })))
})
app.post('/api/projects', (req, res) => {
  const uid = currentUser(req)?.id
  const b = req.body || {}
  if (!b.name) return res.status(400).json({ error: 'Project name required' })
  const ins = db
    .prepare(
      `INSERT INTO projects (user_id, goal_id, name, objective, requirements_json, technologies_json, milestones_json)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(uid, b.goal_id || null, b.name, b.objective || '', JSON.stringify(b.requirements || []), JSON.stringify(b.technologies || []), JSON.stringify(b.milestones || []))
  logAgentRun(uid, 'Project Agent', 'Created project', b.name)
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(ins.lastInsertRowid)))
})
app.put('/api/projects/:id', (req, res) => {
  const uid = currentUser(req)?.id
  const b = req.body || {}
  const fields = ['name', 'objective', 'status', 'evaluation']
  const sets = []
  const vals = []
  for (const f of fields) if (f in b) { sets.push(`${f} = ?`); vals.push(b[f]) }
  if ('requirements' in b) { sets.push('requirements_json = ?'); vals.push(JSON.stringify(b.requirements)) }
  if ('technologies' in b) { sets.push('technologies_json = ?'); vals.push(JSON.stringify(b.technologies)) }
  if ('milestones' in b) { sets.push('milestones_json = ?'); vals.push(JSON.stringify(b.milestones)) }
  if (b.status === 'completed') { sets.push('completed_at = ?'); vals.push(new Date().toISOString()) }
  if (sets.length) { vals.push(req.params.id); db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, uid) }
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id))
})

// ---------------- static frontend ----------------
const dist = path.join(__dirname, '..', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))
}

export function startServer(port = config.port) {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`LearnMate server running on http://0.0.0.0:${port}`)
    startScheduler()
    logger.info('server', `LearnMate listening on :${port}`, {
      ai: aiConfigured() ? 'model-configured' : 'deterministic-engine',
      search: searchConfigured(),
      seedDemo: config.seedDemo,
    })
  })
  return server
}

export { app }

// Start only when run directly (not when imported by tests or scripts).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  startServer()
}
