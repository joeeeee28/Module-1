import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { db, migrate, now, addDays, getSetting, setSetting } from './db.js'
import { seedIfEmpty } from './seed.js'
import {
  generateRoadmap,
  generateDailyPlan,
  completeTask,
  recomputeAllProgress,
  computeSkillMastery,
  computeGoalProgress,
  generateAssessment,
  gradeAssessment,
  generateReview,
  coach,
  getGoalWithTopics,
} from './ai/engine.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const hash = (s) => createHash('sha256').update(String(s)).digest('hex')

migrate()
seedIfEmpty()

const app = express()
app.use(express.json({ limit: '2mb' }))

// ---------------- auth helpers ----------------
const tokens = getSetting('tokens', {})
function issueToken(userId) {
  const tok = randomBytes(24).toString('hex')
  tokens[tok] = userId
  setSetting('tokens', tokens)
  return tok
}
function userIdFrom(req) {
  const h = req.headers.authorization || ''
  const tok = h.replace(/^Bearer\s+/i, '')
  return tokens[tok] || null
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
  if (user.password_hash && user.password_hash !== hash(password || ''))
    return res.status(401).json({ error: 'Incorrect password.' })
  const token = issueToken(user.id)
  const { password_hash, ...safe } = user
  res.json({ token, user: safe })
})

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body || {}
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' })
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) return res.status(409).json({ error: 'An account with that email already exists.' })
  const ins = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)')
    .run(name, email, hash(password || ''))
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ins.lastInsertRowid))
  const token = issueToken(user.id)
  const { password_hash, ...safe } = user
  res.json({ token, user: safe })
})

app.get('/api/auth/me', (req, res) => {
  const u = currentUser(req)
  if (!u) return res.status(401).json({ error: 'Not authenticated' })
  const { password_hash, ...safe } = u
  res.json({ user: safe })
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
  const fields = ['name', 'role', 'career_goal', 'target_role', 'experience_level', 'daily_learning_minutes', 'preferred_days', 'briefing_time', 'learning_style', 'bio']
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
  const { password_hash, ...safe } = updated
  res.json(safe)
})

// ---------------- skills ----------------
app.get('/api/skills', (req, res) => {
  const uid = currentUser(req)?.id
  const skills = db.prepare('SELECT * FROM skills WHERE user_id = ? ORDER BY category, name').all(uid)
  res.json(skills)
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
  generateRoadmap(id)
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
  const date = req.query.date || now()
  let plan = db.prepare('SELECT * FROM daily_plans WHERE date = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get(date, uid)
  if (!plan) {
    const u = currentUser(req)
    plan = generateDailyPlan(u, date).plan
  }
  const tasks = db.prepare('SELECT * FROM tasks WHERE daily_plan_id = ? ORDER BY sort').all(plan.id)
  res.json({ plan, tasks, briefing: JSON.parse(plan.briefing_json || '{}') })
})
app.post('/api/plan/generate', (req, res) => {
  const date = req.body?.date || now()
  const u = currentUser(req)
  const { plan, briefing } = generateDailyPlan(u, date)
  const tasks = db.prepare('SELECT * FROM tasks WHERE daily_plan_id = ? ORDER BY sort').all(plan.id)
  res.json({ plan, tasks, briefing })
})
app.post('/api/tasks/:id/complete', (req, res) => {
  try {
    completeTask(req.params.id, req.body || {})
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
    db.prepare('UPDATE notes SET content = ?, updated_at = datetime("now") WHERE topic_id = ? AND user_id = ?').run(content || '', req.params.topicId, uid)
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
app.post('/api/coach', (req, res) => {
  const uid = currentUser(req)?.id
  const { message } = req.body || {}
  res.json(coach(message, uid))
})

// ---------------- briefing ----------------
app.get('/api/briefing', (req, res) => {
  const uid = currentUser(req)?.id
  const date = now()
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
  const date = now()

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
  res.json({ notifications: notif, briefingTime: u?.briefing_time || '07:30' })
})
app.put('/api/settings', (req, res) => {
  if (req.body?.notifications) setSetting('notifications', req.body.notifications)
  res.json({ ok: true })
})

// ---------------- static frontend ----------------
const dist = path.join(__dirname, '..', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')))
}

const PORT = process.env.PORT || 4000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`LearnMate server running on http://0.0.0.0:${PORT}`)
})
