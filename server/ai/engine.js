// LearnMate Learning Agent — a deterministic intelligent engine that reasons
// over the user's actual data. No external LLM required: every function below
// genuinely analyzes stored goals, roadmaps, sessions and assessments to make
// decisions (planning, adaptation, mastery, revision, reviews, coaching).

import { db, now, addDays, daysBetween, getSetting, setSetting } from '../db.js'
import { CATALOG, genericTopics } from './catalog.js'

const DIFF_ORDER = ['beginner', 'intermediate', 'advanced', 'expert']
const SPACED_INTERVALS = [1, 3, 7, 14, 30]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function findCatalogKey(name) {
  const n = name.toLowerCase()
  return Object.keys(CATALOG).find((k) => n.includes(k.toLowerCase()))
}

function topicsForGoal(goal) {
  const key = findCatalogKey(goal.name)
  return key ? CATALOG[key] : genericTopics(goal.name)
}

function phaseForLevel(level) {
  const lvl = (level || 'beginner').toLowerCase()
  const i = DIFF_ORDER.indexOf(lvl)
  return i <= 0 ? 1 : i === 1 ? 2 : 3
}

export function getGoalWithTopics(goalId) {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId)
  if (!goal) return null
  const phases = db
    .prepare('SELECT * FROM roadmap_phases WHERE goal_id = ? ORDER BY phase_number')
    .all(goalId)
  const topics = db
    .prepare(
      `SELECT t.*, p.phase_number FROM topics t
       JOIN roadmap_phases p ON p.id = t.phase_id
       WHERE t.goal_id = ? ORDER BY p.phase_number, t.sort`
    )
    .all(goalId)
  return { ...goal, phases, topics }
}

export function computeGoalProgress(goalId) {
  const topics = db.prepare('SELECT status FROM topics WHERE goal_id = ?').all(goalId)
  if (!topics.length) return 0
  const done = topics.filter((t) => t.status === 'completed').length
  const partial = topics.filter((t) => t.status === 'in_progress' || t.status === 'needs_review').length
  return Math.round(((done + partial * 0.4) / topics.length) * 100)
}

function frontierTopic(goalId) {
  const topics = db
    .prepare(
      `SELECT t.*, p.phase_number FROM topics t
       JOIN roadmap_phases p ON p.id = t.phase_id
       WHERE t.goal_id = ? AND t.status != 'completed'
       ORDER BY p.phase_number, t.sort LIMIT 1`
    )
    .get(goalId)
  return topics || null
}

function unlockUpTo(goalId, phaseNumber) {
  // unlock phases up to the frontier phase and make the frontier topic active
  db.prepare('UPDATE roadmap_phases SET status = ? WHERE goal_id = ? AND phase_number <= ?')
    .run('active', goalId, phaseNumber)
  const frontier = frontierTopic(goalId)
  if (frontier && frontier.status === 'locked') {
    db.prepare('UPDATE topics SET status = ? WHERE id = ?').run('not_started', frontier.id)
  }
}

function currentStreak(userId) {
  const rows = db
    .prepare(
      `SELECT DISTINCT date FROM sessions WHERE status='completed' AND user_id = ? ORDER BY date DESC`
    )
    .all(userId)
    .map((r) => r.date)
  const set = new Set(rows)
  let streak = 0
  let d = now()
  if (!set.has(d)) d = addDays(d, -1) // allow today not yet done
  while (set.has(d)) {
    streak += 1
    d = addDays(d, -1)
  }
  return streak
}

// ---------------------------------------------------------------------------
// 1. Roadmap generator
// ---------------------------------------------------------------------------
export function generateRoadmap(goalId) {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId)
  if (!goal) throw new Error('Goal not found')

  db.prepare('DELETE FROM roadmap_phases WHERE goal_id = ?').run(goalId)
  db.prepare('DELETE FROM topics WHERE goal_id = ?').run(goalId)

  const topics = topicsForGoal(goal)
  const startPhase = phaseForLevel(goal.current_level)

  const phaseDefs = [
    { n: 1, title: 'Foundation', desc: 'Core concepts and fundamentals', diff: 'beginner' },
    { n: 2, title: 'Intermediate', desc: 'Deepening skills with practical exercises and mini projects', diff: 'intermediate' },
    { n: 3, title: 'Advanced', desc: 'Advanced concepts and real-world scenarios', diff: 'advanced' },
    { n: 4, title: 'Project', desc: 'Build a practical project using acquired skills', diff: 'advanced' },
    { n: 5, title: 'Assessment', desc: 'Test knowledge with questions, debugging and scenarios', diff: 'advanced' },
    { n: 6, title: 'Mastery', desc: 'Identify weak areas and reinforcement tasks', diff: 'advanced' },
  ]

  // classify catalog topics
  const beginner = topics.filter((t) => t.difficulty === 'beginner')
  const intermediate = topics.filter((t) => t.difficulty === 'intermediate')
  const advanced = topics.filter((t) => t.difficulty === 'advanced')
  const project = advanced.filter((t) => /capstone|project/i.test(t.name))
  const advRest = advanced.filter((t) => !/capstone|project/i.test(t.name))

  // respect start phase: skip material below the user's current level
  const groups = {
    1: startPhase <= 1 ? beginner : [],
    2: startPhase <= 2 ? intermediate : [],
    3: startPhase <= 3 ? advRest : [],
    4: project.length ? project : advRest.slice(-1),
  }
  // if skipping left a phase empty, backfill from the next group so roadmap stays rich
  if (startPhase === 2 && !groups[2].length) groups[2] = groups[3].slice(0, Math.min(3, groups[3].length))
  if (startPhase === 3 && !groups[3].length) groups[3] = groups[4].slice(0, Math.min(2, groups[4].length))

  const phaseMeta = {
    1: { title: 'Foundation', desc: 'Core concepts and fundamentals', diff: 'beginner' },
    2: { title: 'Intermediate', desc: 'Deepening skills with practical exercises and mini projects', diff: 'intermediate' },
    3: { title: 'Advanced', desc: 'Advanced concepts and real-world scenarios', diff: 'advanced' },
    4: { title: 'Project', desc: 'Build a practical project using acquired skills', diff: 'advanced' },
  }

  let sort = 0
  for (let n = 1; n <= 4; n++) {
    const topics = groups[n] || []
    const totalMin = topics.reduce((a, t) => a + (t.minutes || 40), 0)
    const status = n === startPhase ? 'active' : 'locked'
    const ins = db
      .prepare(
        'INSERT INTO roadmap_phases (goal_id, phase_number, title, description, status, estimated_minutes, sort) VALUES (?,?,?,?,?,?,?)'
      )
      .run(goalId, n, phaseMeta[n].title, phaseMeta[n].desc, status, totalMin, n)
    const phaseId = Number(ins.lastInsertRowid)
    topics.forEach((t) => {
      db.prepare(
        `INSERT INTO topics (goal_id, phase_id, name, description, difficulty, estimated_minutes, status, concepts_json, exercises_json, project, success_criteria_json, sort)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        goalId,
        phaseId,
        t.name,
        t.description,
        t.difficulty,
        t.minutes || 40,
        n === startPhase ? 'not_started' : 'locked',
        JSON.stringify(t.concepts || []),
        JSON.stringify(t.exercises || []),
        t.project || null,
        JSON.stringify(t.success || []),
        sort++
      )
    })
  }

  // Phase 5 — Assessment
  const a5 = db
    .prepare(
      'INSERT INTO roadmap_phases (goal_id, phase_number, title, description, status, estimated_minutes, sort) VALUES (?,?,?,?,?,?,?)'
    )
    .run(goalId, 5, 'Assessment', phaseDefs[4].desc, 'locked', 60, 5)
  const p5 = Number(a5.lastInsertRowid)
  db.prepare(
    `INSERT INTO topics (goal_id, phase_id, name, description, difficulty, estimated_minutes, status, concepts_json, exercises_json, success_criteria_json, sort)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    goalId,
    p5,
    `Assessment: ${goal.name}`,
    'Comprehensive assessment covering every phase of the roadmap.',
    'advanced',
    60,
    'locked',
    JSON.stringify(['Quick quiz', 'Concept test', 'Practical challenge', 'Debugging challenge', 'Scenario challenge']),
    JSON.stringify(['Complete all assessment types']),
    JSON.stringify(['Score 70% or higher across all assessment types']),
    sort++
  )

  // Phase 6 — Mastery
  const a6 = db
    .prepare(
      'INSERT INTO roadmap_phases (goal_id, phase_number, title, description, status, estimated_minutes, sort) VALUES (?,?,?,?,?,?,?)'
    )
    .run(goalId, 6, 'Mastery', phaseDefs[5].desc, 'locked', 45, 6)
  const p6 = Number(a6.lastInsertRowid)
  db.prepare(
    `INSERT INTO topics (goal_id, phase_id, name, description, difficulty, estimated_minutes, status, concepts_json, exercises_json, success_criteria_json, sort)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    goalId,
    p6,
    `Mastery & reinforcement: ${goal.name}`,
    'Targeted reinforcement of weak areas identified during the roadmap.',
    'advanced',
    45,
    'locked',
    JSON.stringify(['Revisit weak areas', 'Reinforcement exercises', 'Final confidence check']),
    JSON.stringify(['Complete reinforcement tasks for every weak area']),
    JSON.stringify(['Demonstrate mastery of all previously weak areas']),
    sort++
  )

  // unlock frontier appropriately
  unlockUpTo(goalId, startPhase)
  const progress = computeGoalProgress(goalId)
  db.prepare('UPDATE goals SET progress = ? WHERE id = ?').run(progress, goalId)

  return getGoalWithTopics(goalId)
}

// ---------------------------------------------------------------------------
// 2. Daily planner
// ---------------------------------------------------------------------------
export function generateDailyPlan(user, date = now()) {
  const goals = db.prepare(`SELECT * FROM goals WHERE status = 'active' AND user_id = ?`).all(user.id)
  const availableMin = user.daily_learning_minutes || 45

  // candidate frontier topics across all active goals
  const candidates = goals
    .map((g) => {
      const t = frontierTopic(g.id)
      return t ? { goal: g, topic: t } : null
    })
    .filter(Boolean)

  // priority: higher priority, lower progress, sooner deadline → first
  const pWeight = { High: 3, Medium: 2, Low: 1 }
  candidates.sort((a, b) => {
    const key = (c) =>
      (c.goal.progress || 0) / 100 -
      (pWeight[c.goal.priority] || 2) +
      0.001 * (c.goal.deadline ? daysBetween(now(), c.goal.deadline) : 999)
    return key(a) - key(b)
  })

  const dueRevisions = db
    .prepare(`SELECT * FROM revision_schedule WHERE status='pending' AND due_date <= ? AND user_id = ? ORDER BY due_date`)
    .all(date, user.id)

  // check for unfinished tasks from the most recent previous plan
  const yesterdayPlan = db
    .prepare(`SELECT id FROM daily_plans WHERE date < ? AND user_id = ? ORDER BY date DESC LIMIT 1`)
    .get(date, user.id)
  const unfinished = []
  if (yesterdayPlan) {
    const rows = db
      .prepare(`SELECT * FROM tasks WHERE daily_plan_id = ? AND status IN ('not_started','in_progress') ORDER BY sort`)
      .all(yesterdayPlan.id)
    unfinished.push(...rows)
  }

  const primary = candidates[0] || null
  const planTopic = primary ? primary.topic.name : 'Review & consolidation'
  const objective = primary
    ? `Build a working understanding of "${primary.topic.name}" toward "${primary.goal.name}".`
    : 'Consolidate recent learning and clear any backlog.'

  // build task list within budget
  const tasks = []
  let budget = availableMin

  const addTask = (type, title, description, duration, opts = {}) => {
    if (duration > budget + 5) duration = Math.max(5, budget)
    if (duration <= 0) return
    tasks.push({ type, title, description, duration: Math.min(duration, budget), goalId: opts.goalId ?? primary?.goal.id, topicId: opts.topicId ?? primary?.topic.id })
    budget -= Math.min(duration, budget)
  }
  const uid = user.id

  // 1. carry-over unfinished work first (continuity rule)
  for (const u of unfinished.slice(0, 2)) {
    addTask(u.type, u.title, u.description, u.duration, { goalId: u.goal_id, topicId: u.topic_id })
  }

  // 2. spaced revision (weave in, up to ~20% of time)
  if (dueRevisions.length && primary) {
    const r = dueRevisions[0]
    addTask('revise', `Revise: ${r.topic_name}`, 'Spaced-repetition review — actively recall the key concepts before re-reading.', Math.round(availableMin * 0.2), { goalId: r.goal_id, topicId: r.topic_id })
  }

  // 3. core learn / practice / build / test for the frontier topic
  if (primary) {
    const t = primary.topic
    const isReview = t.status === 'needs_review'
    const learnMin = Math.round(budget * 0.35)
    const practiceMin = Math.round(budget * 0.35)
    const buildMin = Math.round(budget * 0.2)
    const testMin = Math.max(5, budget - learnMin - practiceMin - buildMin)
    addTask(
      'learn',
      isReview ? `Reinforce: ${t.name}` : `Learn: ${t.name}`,
      isReview
        ? `You found this tough last time — go back to the basics and rebuild understanding before moving on.`
        : t.description || 'Study the core concepts for this topic.',
      learnMin
    )
    const ex = t.exercises_json ? JSON.parse(t.exercises_json) : []
    addTask('practice', 'Practice: hands-on exercise', ex[0] || `Complete a practical exercise on ${t.name}.`, practiceMin)
    if (t.project) {
      addTask('build', 'Build: mini project', t.project, buildMin)
    } else {
      addTask('build', 'Build: apply it', `Apply ${t.name} to a small hands-on task of your own.`, buildMin)
    }
    addTask('test', 'Test yourself', 'Answer a few quick questions to verify understanding.', testMin)
  } else if (!tasks.length) {
    addTask('practice', 'Free practice session', 'Choose any active goal and do one focused practice session.', availableMin)
  }

  // persist plan
  const ins = db
    .prepare('INSERT INTO daily_plans (user_id, date, primary_goal_id, topic, objective, estimated_minutes) VALUES (?,?,?,?,?,?)')
    .run(uid, date, primary?.goal.id || null, planTopic, objective, availableMin)
  const planId = Number(ins.lastInsertRowid)
  tasks.forEach((t, i) => {
    db.prepare(
      'INSERT INTO tasks (user_id, daily_plan_id, goal_id, topic_id, type, title, description, duration, status, sort) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(uid, planId, t.goalId || null, t.topicId || null, t.type, t.title, t.description, t.duration, 'not_started', i)
  })

  // success criteria
  let success = []
  if (primary?.topic) {
    const sc = primary.topic.success_criteria_json ? JSON.parse(primary.topic.success_criteria_json) : []
    success = sc.length
      ? sc
      : [`Explain ${primary.topic.name} in your own words`, `Complete the practice exercise`, `Apply it in a hands-on task`]
  }

  // briefing
  const briefing = buildBriefing(user, date, { planId, primary, planTopic, objective, tasks, success, availableMin })
  db.prepare('UPDATE daily_plans SET briefing_json = ? WHERE id = ?').run(JSON.stringify(briefing), planId)

  return { plan: db.prepare('SELECT * FROM daily_plans WHERE id = ?').get(planId), briefing }
}

// ---------------------------------------------------------------------------
// 3. Morning briefing
// ---------------------------------------------------------------------------
export function buildBriefing(user, date, ctx) {
  const { primary, planTopic, objective, tasks, success, availableMin } = ctx
  const yesterday = addDays(date, -1)
  const yDone = db
    .prepare(`SELECT COUNT(*) c FROM tasks t JOIN daily_plans p ON p.id=t.daily_plan_id WHERE p.date=? AND p.user_id=? AND t.status='completed'`)
    .get(yesterday, user.id).c
  const yTotal = db.prepare(`SELECT COUNT(*) c FROM tasks t JOIN daily_plans p ON p.id=t.daily_plan_id WHERE p.date=? AND p.user_id=?`).get(yesterday, user.id).c
  const yTopic = db.prepare(`SELECT topic FROM daily_plans WHERE date=? AND user_id=? ORDER BY id DESC LIMIT 1`).get(yesterday, user.id)

  const progressByGoal = db
    .prepare(`SELECT name, progress FROM goals WHERE status='active' AND user_id=? ORDER BY progress DESC`)
    .all(user.id)
  const streak = currentStreak(user.id)

  const blocks = ['learn', 'practice', 'build', 'test', 'revise']
  const plan = blocks
    .map((b) => {
      const ts = tasks.filter((t) => t.type === b)
      if (!ts.length) return null
      const total = ts.reduce((a, t) => a + t.duration, 0)
      return { type: b, label: blockLabel(b), minutes: total, items: ts.map((t) => t.title.replace(/^(Learn|Practice|Build|Test yourself|Revise):\s*/, '')) }
    })
    .filter(Boolean)

  return {
    greeting: `Good ${hourGreeting()}, ${user.name.split(' ')[0]} 👋`,
    primaryGoal: primary ? primary.goal.name : 'Consolidation',
    topic: planTopic,
    objective,
    estimatedMinutes: availableMin,
    plan,
    successCriteria: success,
    yesterday: yTotal
      ? { topic: yTopic?.topic || 'Learning', completed: yDone === yTotal, done: yDone, total: yTotal }
      : null,
    progress: progressByGoal.map((g) => ({ name: g.name, pct: g.progress || 0 })),
    streak,
  }
}

function hourGreeting() {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
}

function blockLabel(type) {
  return { learn: 'Learn', practice: 'Practice', build: 'Build', test: 'Test Yourself', revise: 'Revise' }[type] || type
}

// ---------------------------------------------------------------------------
// 4. Task completion + adaptive engine
// ---------------------------------------------------------------------------
export function completeTask(taskId, log) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
  if (!task) throw new Error('Task not found')
  db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(log.status || 'completed', taskId)

  const date = now()
  db.prepare(
    `INSERT INTO task_logs (task_id, date, status, actual_minutes, difficulty, confidence, notes, questions, learned)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    taskId,
    date,
    log.status || 'completed',
    log.actual_minutes || null,
    log.difficulty || null,
    log.confidence || null,
    log.notes || null,
    log.questions || null,
    log.learned || null
  )

  // record a session for analytics
  if (log.status === 'completed') {
    db.prepare(
      `INSERT INTO sessions (user_id, date, duration, goal_id, topic_id, topic_name, confidence, difficulty, notes, learned, status, kind)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(task.user_id, date, log.actual_minutes || task.duration, task.goal_id, task.topic_id, task.title.replace(/^(Learn|Practice|Build|Test yourself|Revise):\s*/, ''), log.confidence || 3, log.difficulty || 'medium', log.notes || null, log.learned || null, 'completed', task.type)

    if (task.type === 'revise') {
      markRevisionDone(task.topic_id)
    } else if (task.type === 'learn' || task.type === 'test') {
      maybeAdvanceTopic(task.topic_id, log)
    } else if (task.topic_id) {
      const t = db.prepare('SELECT status FROM topics WHERE id = ?').get(task.topic_id)
      if (t && t.status !== 'completed' && t.status !== 'needs_review') {
        db.prepare('UPDATE topics SET status = ? WHERE id = ?').run('in_progress', task.topic_id)
      }
    }
  }

  recomputeAllProgress(task.user_id)
  return task
}

function markRevisionDone(topicId) {
  if (!topicId) return
  const row = db
    .prepare(`SELECT id FROM revision_schedule WHERE topic_id = ? AND status='pending' ORDER BY due_date LIMIT 1`)
    .get(topicId)
  if (row) db.prepare(`UPDATE revision_schedule SET status='completed' WHERE id = ?`).run(row.id)
}

function maybeAdvanceTopic(topicId, log) {
  if (!topicId) return
  const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId)
  if (!topic) return
  const conf = log.confidence ?? 3
  if (conf >= 3) {
    db.prepare('UPDATE topics SET status = ? WHERE id = ?').run('completed', topicId)
    scheduleSpacedRevision(topicId, topic)
    advanceFrontier(topic.goal_id)
  } else {
    // not yet understood — do NOT advance. Schedule reinforcement instead.
    db.prepare('UPDATE topics SET status = ? WHERE id = ?').run('needs_review', topicId)
    const g = db.prepare('SELECT user_id FROM goals WHERE id = ?').get(topic.goal_id)
    db.prepare(
      `INSERT INTO revision_schedule (user_id, topic_id, goal_id, topic_name, due_date, interval_days, status, source)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(g?.user_id || null, topicId, topic.goal_id, topic.name, addDays(now(), 1), 1, 'pending', 'weak')
  }
}

function advanceFrontier(goalId) {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId)
  const topics = db
    .prepare(
      `SELECT t.*, p.phase_number FROM topics t JOIN roadmap_phases p ON p.id=t.phase_id
       WHERE t.goal_id = ? ORDER BY p.phase_number, t.sort`
    )
    .all(goalId)
  const next = topics.find((t) => t.status === 'locked')
  if (next) {
    db.prepare('UPDATE topics SET status = ? WHERE id = ?').run('not_started', next.id)
    db.prepare('UPDATE roadmap_phases SET status = ? WHERE goal_id = ? AND phase_number = ?').run('active', goalId, next.phase_number)
    // complete prior phases
    db.prepare('UPDATE roadmap_phases SET status = ? WHERE goal_id = ? AND phase_number < ?').run('completed', goalId, next.phase_number)
  } else {
    // all topics done → goal complete
    db.prepare('UPDATE goals SET status = ?, progress = 100 WHERE id = ?').run('completed', goalId)
  }
}

function scheduleSpacedRevision(topicId, topic) {
  const g = db.prepare('SELECT user_id FROM goals WHERE id = ?').get(topic.goal_id)
  SPACED_INTERVALS.forEach((days) => {
    db.prepare(
      `INSERT INTO revision_schedule (user_id, topic_id, goal_id, topic_name, due_date, interval_days, status, source)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(g?.user_id || null, topicId, topic.goal_id, topic.name, addDays(now(), days), days, 'pending', 'spaced')
  })
}

// ---------------------------------------------------------------------------
// 5. Mastery engine
// ---------------------------------------------------------------------------
export function recomputeAllProgress(userId) {
  const goals = userId
    ? db.prepare('SELECT id FROM goals WHERE user_id = ?').all(userId)
    : db.prepare('SELECT id FROM goals').all()
  for (const g of goals) {
    db.prepare('UPDATE goals SET progress = ? WHERE id = ?').run(computeGoalProgress(g.id), g.id)
    // phase progress
    const phases = db.prepare('SELECT id FROM roadmap_phases WHERE goal_id = ?').all(g.id)
    for (const p of phases) {
      const ts = db.prepare('SELECT status FROM topics WHERE phase_id = ?').all(p.id)
      if (!ts.length) continue
      const done = ts.filter((t) => t.status === 'completed').length
      db.prepare('UPDATE roadmap_phases SET progress = ? WHERE id = ?').run(Math.round((done / ts.length) * 100), p.id)
    }
  }

  const skills = userId
    ? db.prepare('SELECT * FROM skills WHERE user_id = ?').all(userId)
    : db.prepare('SELECT * FROM skills').all()
  for (const s of skills) {
    const mastery = computeSkillMastery(s)
    db.prepare('UPDATE skills SET current_mastery = ?, current_level = ? WHERE id = ?').run(mastery, levelFromMastery(mastery), s.id)
  }
}

function levelFromMastery(m) {
  if (m >= 85) return 'Expert'
  if (m >= 70) return 'Advanced'
  if (m >= 45) return 'Intermediate'
  if (m >= 15) return 'Beginner'
  return 'Novice'
}

export function computeSkillMastery(skill) {
  const goals = db
    .prepare('SELECT id FROM goals WHERE user_id = ? AND lower(name) LIKE ?')
    .all(skill.user_id, `%${skill.name.toLowerCase()}%`)
  const goalIds = goals.map((g) => g.id)
  if (!goalIds.length) return skill.current_mastery ?? 0

  const placeholders = goalIds.map(() => '?').join(',')
  const topics = db.prepare(`SELECT status FROM topics WHERE goal_id IN (${placeholders})`).all(...goalIds)
  const topicScore = topics.length
    ? (topics.filter((t) => t.status === 'completed').length / topics.length) * 100
    : 0

  const assessments = db
    .prepare(`SELECT score, max_score FROM assessments WHERE goal_id IN (${placeholders}) AND completed=1`)
    .all(...goalIds)
  const assessScore = assessments.length
    ? assessments.reduce((a, x) => a + (x.score / (x.max_score || 1)) * 100, 0) / assessments.length
    : 0

  const sessions = db
    .prepare(`SELECT confidence, date FROM sessions WHERE goal_id IN (${placeholders}) AND status='completed'`)
    .all(...goalIds)
  const confScore = sessions.length
    ? (sessions.reduce((a, x) => a + (x.confidence || 3), 0) / sessions.length / 5) * 100
    : 0
  const recentCount = sessions.filter((x) => daysBetween(x.date, now()) <= 14).length
  const recency = Math.min(100, recentCount * 25)

  const hasProject = topics.some((t) => t.status === 'completed' && /capstone|project|assessment|mastery/i.test(t.name || ''))

  const mastery =
    topicScore * 0.3 + assessScore * 0.35 + confScore * 0.2 + recency * 0.15 + (hasProject ? 10 : 0)
  return Math.max(0, Math.min(100, Math.round(mastery)))
}

// ---------------------------------------------------------------------------
// 6. Assessments
// ---------------------------------------------------------------------------
export function generateAssessment(kind, goalId, topicId) {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId)
  const topic = topicId ? db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId) : null
  const concepts = topic?.concepts_json ? JSON.parse(topic.concepts_json) : []
  const subject = topic ? topic.name : goal.name

  const questions = []
  if (kind === 'quick' || kind === 'concept') {
    const n = kind === 'quick' ? 5 : 10
    const pool = concepts.length ? concepts : [subject]
    for (let i = 0; i < n; i++) {
      const c = pool[i % pool.length]
      questions.push(mcqFromConcept(c, subject, i))
    }
  }
  if (kind === 'practical') {
    questions.push({
      type: 'open',
      prompt: `Practical challenge on ${subject}: implement a working solution from scratch, then describe what you built, the decisions you made, and how you'd test it.`,
    })
  }
  if (kind === 'debug') {
    questions.push({
      type: 'open',
      prompt: `Debugging challenge on ${subject}: below is a deliberately broken snippet. Identify the bug(s), explain the root cause, and provide the corrected version.\n\n\`\`\`\n# intentionally flawed example relating to ${subject}\n\`\`\``,
    })
  }
  if (kind === 'scenario') {
    questions.push({
      type: 'open',
      prompt: `Real-world scenario for ${subject}: you are given a realistic business/technical situation. Explain your approach, the trade-offs, and the solution you'd deliver.`,
    })
  }
  if (!questions.length) {
    for (let i = 0; i < 5; i++) questions.push(mcqFromConcept(subject, subject, i))
  }

  const uid = goal?.user_id
  const ins = db
    .prepare(
      'INSERT INTO assessments (user_id, goal_id, topic_id, title, kind, questions_json, date, difficulty) VALUES (?,?,?,?,?,?,?,?)'
    )
    .run(uid, goalId, topicId || null, `${kindLabel(kind)}: ${subject}`, kind, JSON.stringify(questions), now(), topic?.difficulty || 'intermediate')

  return db.prepare('SELECT * FROM assessments WHERE id = ?').get(Number(ins.lastInsertRowid))
}

function kindLabel(k) {
  return { quick: 'Quick Quiz', concept: 'Concept Test', practical: 'Practical Challenge', debug: 'Debugging Challenge', scenario: 'Scenario Challenge' }[k] || k
}

function mcqFromConcept(concept, subject, seed) {
  const distractorSets = [
    [`An unrelated practice with no connection to ${concept}`, `A deprecated approach that should be avoided`, `Only relevant in purely theoretical settings`],
    [`The opposite of ${concept}`, `A random term from another domain`, `Something that only applies to toy problems`],
    [`A synonym for an entirely different idea`, `An outdated technique no longer used`, `Irrelevant to ${subject} in practice`],
  ]
  const distractors = distractorSets[seed % distractorSets.length]
  const options = [
    { text: `To correctly apply ${concept} within ${subject}`, correct: true },
    ...distractors.map((d) => ({ text: d, correct: false })),
  ]
  // deterministic shuffle
  let s = seed + 1
  for (let i = options.length - 1; i > 0; i--) {
    s = (s * 16807) % 2147483647
    const j = s % (i + 1)
    ;[options[i], options[j]] = [options[j], options[i]]
  }
  return {
    type: 'mcq',
    prompt: `Which statement best describes "${concept}" as it applies to ${subject}?`,
    options,
  }
}

export function gradeAssessment(id, answers) {
  const a = db.prepare('SELECT * FROM assessments WHERE id = ?').get(id)
  if (!a) throw new Error('Assessment not found')
  const qs = JSON.parse(a.questions_json)
  let score = 0
  let max = 0
  qs.forEach((q, i) => {
    if (q.type === 'mcq') {
      max += 1
      const chosen = answers[i]
      const correct = q.options.find((o) => o.correct)
      if (chosen != null && q.options[chosen] && q.options[chosen].correct) score += 1
    }
  })
  const pct = max ? Math.round((score / max) * 100) : 0
  db.prepare('UPDATE assessments SET score = ?, max_score = ?, completed = 1, date = ? WHERE id = ?').run(score, max, now(), id)
  // weak areas → schedule revision if low
  if (pct < 70 && a.topic_id) {
    const t = db.prepare('SELECT * FROM topics WHERE id = ?').get(a.topic_id)
    if (t) {
      db.prepare(
        `INSERT INTO revision_schedule (user_id, topic_id, goal_id, topic_name, due_date, interval_days, status, source)
         VALUES (?,?,?,?,?,?,?)`
      ).run(a.user_id, t.id, t.goal_id, t.name, addDays(now(), 1), 1, 'pending', 'weak')
    }
  }
  recomputeAllProgress(a.user_id)
  return { score, max, pct }
}

// ---------------------------------------------------------------------------
// 7. Reviews
// ---------------------------------------------------------------------------
export function generateReview(period, userId) {
  const days = period === 'weekly' ? 7 : 30
  const start = addDays(now(), -days)
  const sessions = db
    .prepare(`SELECT * FROM sessions WHERE date >= ? AND status='completed' AND user_id = ?`)
    .all(start, userId)

  const totalMin = sessions.reduce((a, s) => a + (s.duration || 0), 0)
  const tasks = db
    .prepare(
      `SELECT t.* FROM tasks t JOIN daily_plans p ON p.id = t.daily_plan_id WHERE p.date >= ? AND p.user_id = ?`
    )
    .all(start, userId)
  const done = tasks.filter((t) => t.status === 'completed').length
  const completionRate = tasks.length ? Math.round((done / tasks.length) * 100) : 0
  const missed = tasks.filter((t) => t.status === 'skipped').length

  // group confidence by topic to find strong/weak
  const byTopic = {}
  for (const s of sessions) {
    const k = s.topic_name || 'General'
    if (!byTopic[k]) byTopic[k] = { sum: 0, n: 0 }
    byTopic[k].sum += s.confidence || 3
    byTopic[k].n += 1
  }
  const ranked = Object.entries(byTopic)
    .map(([name, v]) => ({ name, avg: v.sum / v.n }))
    .sort((a, b) => b.avg - a.avg)
  const strongest = ranked[0]?.name || '—'
  const weakest = ranked[ranked.length - 1]?.name || '—'

  const projectsDone = db
    .prepare(`SELECT COUNT(*) c FROM topics WHERE goal_id IN (SELECT id FROM goals WHERE user_id = ?) AND status='completed' AND (name LIKE '%Capstone%' OR name LIKE '%Project%')`)
    .get(userId).c

  const rec = weakest && weakest !== '—'
    ? `Spend ~20–30 minutes reinforcing "${weakest}" — it's your lowest-confidence area this ${period === 'weekly' ? 'week' : 'month'}.`
    : 'Keep your current pace; consider adding a small project to consolidate skills.'

  const summary = {
    period,
    start,
    completedSessions: sessions.length,
    learningMinutes: totalMin,
    learningHours: (totalMin / 60).toFixed(1),
    completionRate,
    strongest,
    weakest,
    biggestAchievement: projectsDone ? 'Completed a project/capstone milestone 🎉' : done ? `${done} tasks completed` : '—',
    missed,
    recommendation: rec,
  }

  db.prepare('INSERT INTO reviews (user_id, period, period_start, summary_json, recommendations) VALUES (?,?,?,?,?)')
    .run(userId, period, start, JSON.stringify(summary), rec)

  return { summary, next: planNextWeek(weakest, userId) }
}

function planNextWeek(weakest, userId) {
  const goals = db.prepare(`SELECT * FROM goals WHERE status='active' AND user_id = ?`).all(userId)
  const items = []
  if (weakest && weakest !== '—') items.push(`Reinforce "${weakest}"`)
  for (const g of goals.slice(0, 2)) {
    const t = frontierTopic(g.id)
    if (t) items.push(t.name)
  }
  return items.slice(0, 4)
}

// ---------------------------------------------------------------------------
// 8. Coach (context-aware)
// ---------------------------------------------------------------------------
export function coach(message, userId) {
  const m = (message || '').toLowerCase()
  const context = coachContext(userId)
  const goals = db.prepare(`SELECT * FROM goals WHERE status='active' AND user_id = ?`).all(userId)
  const goal = goals[0]
  const frontier = goal ? frontierTopic(goal.id) : null

  let reply
  if (/quiz me|test me|quiz/.test(m)) {
    const a = goal ? generateAssessment('quick', goal.id, frontier?.id) : null
    reply = a
      ? { type: 'quiz', text: `Here's a quick quiz on "${a.title.replace('Quick Quiz: ', '')}". Answer in the Assessments tab, or tell me your answer and I'll check it.`, assessmentId: a.id }
      : { type: 'text', text: 'Create a learning goal first so I have something to quiz you on.' }
  } else if (/harder|challenge me|difficult/.test(m)) {
    reply = { type: 'text', text: frontier ? `Challenge on "${frontier.name}": ${harderExercise(frontier)}` : 'Add an active goal and I can scale up the difficulty for you.' }
  } else if (/don't understand|explain|what is|how does|confused/.test(m)) {
    const concept = extractConcept(m, frontier)
    reply = { type: 'text', text: frontier ? simplerExplanation(frontier, concept) : explainGeneral(m) }
  } else if (/real.world|real world|example|scenario/.test(m)) {
    reply = { type: 'text', text: frontier ? realWorldExample(frontier) : 'Give me a topic and I can ground it in a real-world example.' }
  } else if (/what should i learn next|what next|next topic|what's next/.test(m)) {
    const next = frontier
    reply = { type: 'text', text: next ? `Based on your roadmap, next up is **"${next.name}"** (${next.estimated_minutes} min). It matters because: ${next.description}` : 'No active goals — create one and I will chart the path.' }
  } else if (/why am i learning|why this|why does it matter/.test(m)) {
    reply = { type: 'text', text: goal ? `You're learning "${goal.name}" because: ${goal.why || goal.description || 'it advances your career goals'}. Target outcome: ${goal.target_outcome || 'mastery'}.` : 'Create a goal with a "why" and I will connect every task back to it.' }
  } else if (/review this week|weekly review|this week|summarize my week/.test(m)) {
    const r = generateReview('weekly', userId)
    reply = { type: 'text', text: `Week so far — ${r.summary.completedSessions} sessions, ${r.summary.learningHours}h, ${r.summary.completionRate}% completion. Strongest: ${r.summary.strongest}. Watch out for: ${r.summary.weakest}.` }
  } else if (/project|build something|everything i learned/.test(m)) {
    reply = { type: 'text', text: goal ? projectSuggestion(goal) : 'Tell me what you want to build and I can break it into steps.' }
  } else if (/streak|how consistent|am i doing|progress report/.test(m)) {
    reply = { type: 'text', text: `Current streak: ${currentStreak(userId)} days 🔥. ${context.summary}` }
  } else if (/motivat|tired|give up|hard for me/.test(m)) {
    reply = { type: 'text', text: 'Consistency beats intensity — a small win today compounds. You are already ahead of where you were last week. Want me to generate a lighter plan for today?' }
  } else {
    reply = { type: 'text', text: fallbackAnswer(m, context) }
  }

  return { ...reply, context }
}

function coachContext(userId) {
  const goals = db.prepare(`SELECT * FROM goals WHERE status='active' AND user_id = ?`).all(userId)
  const skills = db.prepare(`SELECT * FROM skills WHERE user_id = ? ORDER BY current_mastery DESC LIMIT 3`).all(userId)
  const streak = currentStreak(userId)
  const summary = goals.length
    ? `Active goals: ${goals.map((g) => `${g.name} (${g.progress}%)`).join(', ')}.`
    : 'No active goals yet.'
  return { goals, skills, streak, summary }
}

function harderExercise(topic) {
  const ex = topic.exercises_json ? JSON.parse(topic.exercises_json) : []
  const base = ex[0] || `practice ${topic.name}`
  return `Take "${base}" and add constraints to raise the bar: handle edge cases, add error handling, optimize it, and write a test to prove it works.`
}

function simplerExplanation(topic, concept) {
  const focus = concept || topic.name
  const concepts = topic.concepts_json ? JSON.parse(topic.concepts_json) : []
  return `Let's make **"${focus}"** concrete. ${topic.description || ''} ${concepts.length ? `Key pieces to understand: ${concepts.slice(0, 4).join(', ')}. ` : ''}Start with a tiny example you can run yourself, then explain it back in one sentence. Where exactly does it stop making sense?`
}

function realWorldExample(topic) {
  return `**Real-world "${topic.name}"** — imagine a real team facing ${topic.description?.toLowerCase() || 'a practical problem'}. They apply this skill to ship a working result, handle the edge cases, and verify it. Try recreating that scenario yourself, even a simplified version, and you'll retain far more than from reading alone.`
}

function extractConcept(msg, topic) {
  if (!topic) return null
  const concepts = topic.concepts_json ? JSON.parse(topic.concepts_json) : []
  return concepts.find((c) => msg.includes(c.toLowerCase())) || null
}

function explainGeneral(msg) {
  return `I can explain concepts tied to your active goals. Give me a specific topic (e.g. "${msg.replace(/explain|what is|how does|don't understand/gi, '').trim() || 'a topic from your roadmap'}") and I'll break it down with examples, then suggest a practice exercise.`
}

function projectSuggestion(goal) {
  const topics = db.prepare(`SELECT name FROM topics WHERE goal_id = ? AND status='completed'`).all(goal.id)
  const names = topics.map((t) => t.name)
  return `Let's build a project with "${goal.name}". Use what you've covered (${names.slice(0, 4).join(', ') || 'your progress so far'}) to build one small, complete deliverable. I'll help you break it into: (1) scope, (2) core implementation, (3) polish & tests. What sounds useful — a tool, a report, or an automation?`
}

function fallbackAnswer(msg, context) {
  return `Here's where you stand: ${context.summary} Streak: ${context.streak} days. I can help you: explain a concept, quiz you, give a harder exercise, review your week, suggest a project, or plan what to learn next. Try one of those and I'll use your real learning data to answer.`
}
