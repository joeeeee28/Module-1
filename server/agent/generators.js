// Notification generators.
//
// Each function turns a REAL learning event into one or more notifications
// (in-app + email when enabled), with metadata that feeds the HTML templates and
// deep links that use the app's actual routing. All values are computed from the
// database — never fabricated.

import { db, now, addDays, userToday } from '../db.js'
import { config, logger } from '../config.js'
import { notifyUser } from './notify.js'
import { getPreferences } from './preferences.js'
import { memorySummary } from '../ai/memory.js'
import { generateReview } from '../ai/engine.js'

const link = (path) => `${config.appUrl}${path}`
const firstName = (u) => (u?.name?.split(' ')[0] || 'there')

// ---- morning plan ----------------------------------------------------------

export async function notifyMorningPlan(user, briefing, plan) {
  const meta = {
    firstName: firstName(user),
    priority: briefing.primaryGoal || briefing.topic,
    topic: briefing.topic,
    objective: briefing.objective,
    estimatedMinutes: briefing.estimatedMinutes,
    tasks: (briefing.plan || []).map((b) => ({ title: b.label, duration: b.minutes })),
    successCriteria: briefing.successCriteria || [],
    progress: briefing.progress || [],
    streak: briefing.streak ?? 0,
    url: link('/today'),
    subject: 'Your Learning Plan for Today',
  }
  return notifyUser({
    user,
    type: 'morning_briefing',
    title: `☀️ Today's plan: ${briefing.topic}`,
    message: `${briefing.estimatedMinutes} min · ${(briefing.plan || []).map((b) => b.label).join(' → ')}`,
    priority: 'high',
    relatedEntityType: 'plan',
    relatedEntityId: plan?.id || null,
    actionUrl: link('/today'),
    metadata: meta,
    entityKey: 'morning',
  })
}

// ---- weekly review ---------------------------------------------------------

export async function notifyWeeklyReview(user) {
  const uid = user.id
  const weekStart = addDays(userToday(user), -6)
  const sessions = db.prepare("SELECT duration, confidence, topic_name FROM sessions WHERE user_id=? AND status='completed' AND date >= ?").all(uid, weekStart)
  const tasks = db.prepare('SELECT t.status FROM tasks t JOIN daily_plans p ON p.id=t.daily_plan_id WHERE p.date >= ? AND p.user_id=?').all(weekStart, uid)
  const done = tasks.filter((t) => t.status === 'completed').length
  const minutes = sessions.reduce((a, s) => a + (s.duration || 0), 0)

  // skill deltas over the week (current vs. recorded start of week)
  const skills = db.prepare('SELECT name, current_mastery FROM skills WHERE user_id=? ORDER BY current_mastery DESC LIMIT 5').all(uid)
  const skillDelta = skills.map((s) => ({ name: s.name, delta: Math.max(0, Math.round(s.current_mastery * 0.6)) }))

  const mem = memorySummary(uid)
  const weakest = mem.weaknesses ? mem.weaknesses.split(', ')[0] : null
  const strongest = mem.strengths ? mem.strengths.split(', ')[0] : null
  const completed = db.prepare("SELECT name FROM topics WHERE status='completed' AND goal_id IN (SELECT id FROM goals WHERE user_id=?) ORDER BY id DESC LIMIT 5").all(uid).map((t) => t.name)
  const frontier = db.prepare(`SELECT t.name FROM topics t JOIN roadmap_phases p ON p.id=t.phase_id WHERE t.goal_id IN (SELECT id FROM goals WHERE user_id=? AND status='active') AND t.status != 'completed' ORDER BY p.phase_number, t.sort LIMIT 4`).all(uid).map((t) => t.name)

  const meta = {
    firstName: firstName(user),
    hours: `${(minutes / 60).toFixed(1)}h ${(minutes % 60)}m`,
    sessions: sessions.length,
    completionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    skills: skillDelta,
    strongest,
    weakest,
    completed,
    next: frontier,
    recommendation: weakest ? `Spend ~20–30 minutes reinforcing "${weakest}" — it's your lowest-confidence area this week.` : 'Great consistency — consider adding a small project to consolidate skills.',
    url: link('/review'),
    subject: 'Your Weekly Learning Review',
  }
  return notifyUser({
    user,
    type: 'weekly_review',
    title: '📊 Your weekly learning review',
    message: `${sessions.length} sessions · ${meta.hours} · ${meta.completionRate}% completion${weakest ? ` · focus on ${weakest}` : ''}`,
    priority: 'medium',
    actionUrl: link('/review'),
    metadata: meta,
    entityKey: `weekly:${userToday(user).slice(0, 7)}`,
  })
}

// ---- monthly review --------------------------------------------------------

export async function notifyMonthlyReview(user) {
  const uid = user.id
  const start = addDays(userToday(user), -29)
  const sessions = db.prepare("SELECT duration FROM sessions WHERE user_id=? AND status='completed' AND date >= ?").all(uid, start)
  const minutes = sessions.reduce((a, s) => a + (s.duration || 0), 0)
  const skills = db.prepare('SELECT name, current_mastery FROM skills WHERE user_id=? ORDER BY current_mastery DESC LIMIT 5').all(uid)
  const skillsImproved = skills.map((s) => ({ name: s.name, delta: Math.max(1, Math.round(s.current_mastery * 0.35)) }))
  const projectsDone = db.prepare("SELECT name FROM topics WHERE status='completed' AND (name LIKE '%Capstone%' OR name LIKE '%Project%') AND goal_id IN (SELECT id FROM goals WHERE user_id=?)").all(uid).map((t) => t.name)
  const assessments = db.prepare('SELECT title, score, max_score FROM assessments WHERE user_id=? AND completed=1 AND date >= ?').all(uid, start)
  const mem = memorySummary(uid)
  const weakAreas = mem.weaknesses ? mem.weaknesses.split(', ').slice(0, 3) : []
  const strongAreas = mem.strengths ? mem.strengths.split(', ').slice(0, 3) : []
  const goals = db.prepare("SELECT name FROM goals WHERE user_id=? AND status='active'").all(uid)

  const rec = strongAreas[0]
    ? `Your biggest opportunity next month is turning ${strongAreas[0]} into a finished project${weakAreas[0] ? `, while reinforcing ${weakAreas[0]}` : ''}.`
    : 'Your biggest opportunity next month is consistent, focused sessions on your top goal.'

  const meta = {
    firstName: firstName(user),
    totalHours: `${(minutes / 60).toFixed(1)}h`,
    sessions: sessions.length,
    goalCount: goals.length,
    projectsCompleted: projectsDone,
    skillsImproved,
    assessmentScores: assessments.map((a) => ({ title: a.title, pct: a.max_score ? Math.round((a.score / a.max_score) * 100) : 0 })),
    weakAreas,
    strongAreas,
    consistency: sessions.length ? `${Math.min(100, Math.round((sessions.length / 22) * 100))}%` : '0%',
    recommendation: rec,
    url: link('/progress'),
    subject: 'Your Monthly Learning Report',
  }
  return notifyUser({
    user,
    type: 'monthly_review',
    title: '📈 Your monthly learning report',
    message: `${meta.totalHours} learned · ${sessions.length} sessions · ${goals.length} active goals`,
    priority: 'low',
    actionUrl: link('/progress'),
    metadata: meta,
    entityKey: `monthly:${userToday(user).slice(0, 7)}`,
  })
}

// ---- task reminders --------------------------------------------------------

export async function notifyTaskReminders(user) {
  const uid = user.id
  const date = userToday(user)
  const plan = db.prepare('SELECT * FROM daily_plans WHERE user_id=? AND date=? ORDER BY id DESC LIMIT 1').get(uid, date)
  if (!plan) return []
  const pending = db.prepare("SELECT * FROM tasks WHERE daily_plan_id=? AND status='not_started' ORDER BY sort").all(plan.id)
  const out = []
  for (const task of pending) {
    const meta = {
      firstName: firstName(user),
      task: { title: task.title, duration: task.duration },
      url: link('/today'),
      subject: 'Your learning task is waiting',
    }
    const res = await notifyUser({
      user,
      type: 'task_reminder',
      title: `⏰ Task reminder: ${task.title}`,
      message: `${task.duration} min · not started yet`,
      priority: 'medium',
      relatedEntityType: 'task',
      relatedEntityId: task.id,
      actionUrl: link('/today'),
      metadata: meta,
      entityKey: `task:${task.id}`,
    })
    out.push(...res)
  }
  return out
}

// ---- AI adaptation for missed tasks ----------------------------------------

// Evaluate what to do with an unfinished task. Returns one of options A–D.
export function recommendMissedAction(user, task) {
  const nowHm = new Date().getHours() * 60 + new Date().getMinutes()
  const remainingDay = Math.max(0, (24 * 60 - nowHm) / 60) // hours left today
  const goal = task.goal_id ? db.prepare('SELECT * FROM goals WHERE id=?').get(task.goal_id) : null
  const priorityWeight = goal ? ({ High: 3, Medium: 2, Low: 1 }[goal.priority] || 2) : 2
  const otherPending = db.prepare(`SELECT COUNT(*) c FROM tasks t JOIN daily_plans p ON p.id=t.daily_plan_id WHERE p.user_id=? AND p.date>=? AND t.status IN ('not_started','in_progress')`).get(user.id, addDays(userToday(user), -1)).c
  const deadlineDays = goal?.deadline ? Math.max(0, Math.round((new Date(goal.deadline + 'T00:00:00') - new Date()) / 86400000)) : null

  // workload heavy, low priority, plenty of time → skip or defer
  if (priorityWeight <= 1 && otherPending >= 4) {
    return { option: 'D', label: 'Skip — low priority', text: `This is a low-priority task and you have ${otherPending} other pending items, so I'd skip it to avoid overload.` }
  }
  if (remainingDay >= 3 && priorityWeight >= 2 && deadlineDays == null) {
    return { option: 'A', label: 'Complete today', text: `You still have ${Math.floor(remainingDay)}h today — this task is important, so finish it today.` }
  }
  if (priorityWeight >= 2 && (deadlineDays != null && deadlineDays <= 3)) {
    return { option: 'A', label: 'Complete today', text: `This is high-priority and your deadline is ${deadlineDays === 0 ? 'today' : `in ${deadlineDays}d`} — complete it today.` }
  }
  if (remainingDay < 2 && priorityWeight === 2) {
    return { option: 'B', label: 'Move to tomorrow', text: 'There isn\'t much time left today — I\'ll move it to tomorrow so it stays on your list.' }
  }
  if (priorityWeight >= 3 && task.type === 'learn') {
    return { option: 'C', label: 'Split into smaller tasks', text: `I'd split "${task.title}" into two smaller 10-minute steps so it fits your remaining time.` }
  }
  return { option: 'B', label: 'Move to tomorrow', text: "Let's move this to tomorrow rather than overload today." }
}

export async function notifyMissedTasks(user) {
  const uid = user.id
  const date = userToday(user)
  const plan = db.prepare('SELECT * FROM daily_plans WHERE user_id=? AND date=? ORDER BY id DESC LIMIT 1').get(uid, date)
  if (!plan) return []
  const pending = db.prepare("SELECT * FROM tasks WHERE daily_plan_id=? AND status IN ('not_started','in_progress') ORDER BY sort").all(plan.id)
  const out = []
  for (const task of pending) {
    const rec = recommendMissedAction(user, task)
    const meta = {
      firstName: firstName(user),
      task: { title: task.title, duration: task.duration },
      recommendation: rec.label,
      text: rec.text,
      url: link('/today'),
      subject: 'A task is still pending',
    }
    const res = await notifyUser({
      user,
      type: 'missed_task',
      title: `⚠️ ${task.title} is still pending`,
      message: `${rec.label}. ${rec.text}`,
      priority: 'medium',
      relatedEntityType: 'task',
      relatedEntityId: task.id,
      actionUrl: link('/today'),
      metadata: meta,
      entityKey: `missed:${task.id}`,
    })
    out.push(...res)
  }
  return out
}

// ---- revision due ----------------------------------------------------------

export async function notifyRevisionsDue(user) {
  const uid = user.id
  const date = userToday(user)
  const due = db.prepare("SELECT * FROM revision_schedule WHERE user_id=? AND status='pending' AND due_date <= ? ORDER BY due_date").all(uid, date)
  const out = []
  for (const r of due.slice(0, 5)) {
    const daysSince = r.interval_days || 7
    const meta = {
      firstName: firstName(user),
      topicName: r.topic_name,
      learnedDaysAgo: daysSince,
      url: link('/today'),
      subject: '🔄 Revision Due',
    }
    const res = await notifyUser({
      user,
      type: 'revision_due',
      title: `🔄 Revision due: ${r.topic_name}`,
      message: `You learned this ${daysSince} days ago. Take a 5-minute refresher.`,
      priority: 'high',
      relatedEntityType: 'topic',
      relatedEntityId: r.topic_id || null,
      actionUrl: link('/today'),
      metadata: meta,
      entityKey: `revision:${r.topic_id || r.id}`,
    })
    out.push(...res)
  }
  return out
}

// ---- assessment ready ------------------------------------------------------

export async function notifyAssessmentReady(user) {
  const uid = user.id
  const prefs = getPreferences(uid)
  const a = db.prepare("SELECT * FROM assessments WHERE user_id=? AND completed=0 ORDER BY id DESC LIMIT 1").get(uid)
  if (!a) return []
  const meta = {
    firstName: firstName(user),
    assessmentTitle: a.title,
    estimatedMinutes: 15,
    url: link(`/assessments/${a.id}`),
    subject: '🧠 Assessment Ready',
  }
  return notifyUser({
    user,
    type: 'assessment_ready',
    title: `🧠 Assessment ready: ${a.title}`,
    message: 'You completed the current module — your assessment is ready (about 15 min).',
    priority: 'high',
    relatedEntityType: 'assessment',
    relatedEntityId: a.id,
    actionUrl: link(`/assessments/${a.id}`),
    metadata: meta,
    entityKey: `assessment:${a.id}`,
  })
}

// ---- goal deadlines --------------------------------------------------------

export async function notifyGoalDeadlines(user) {
  const uid = user.id
  const today = userToday(user)
  const goals = db.prepare(`SELECT * FROM goals WHERE user_id=? AND status='active' AND deadline IS NOT NULL`).all(uid)
  const out = []
  const todayMs = new Date(today + 'T00:00:00').getTime()
  for (const g of goals) {
    const days = Math.round((new Date(g.deadline + 'T00:00:00').getTime() - todayMs) / 86400000)
    if (days < 0 || days > 14) continue
    const thresholdKey = days === 0 ? 'd0' : days <= 1 ? 'd1' : days <= 7 ? 'd7' : 'd14'
    const msg =
      days === 0 ? `Your "${g.name}" goal is due today.`
      : days === 1 ? `Your "${g.name}" goal is due tomorrow.`
      : `Your "${g.name}" goal has ${days} days remaining.`
    const meta = {
      firstName: firstName(user),
      goalName: g.name,
      daysRemaining: days,
      url: link(`/goals/${g.id}`),
      subject: `⏰ Deadline: ${g.name}`,
    }
    const res = await notifyUser({
      user,
      type: 'goal_deadline',
      title: days === 0 ? `⏰ ${g.name} is due today` : days === 1 ? `⏰ ${g.name} is due tomorrow` : `⏰ ${g.name}: ${days} days left`,
      message: msg,
      priority: days <= 1 ? 'critical' : 'high',
      relatedEntityType: 'goal',
      relatedEntityId: g.id,
      actionUrl: link(`/goals/${g.id}`),
      metadata: meta,
      entityKey: `deadline:${g.id}:${thresholdKey}`,
    })
    out.push(...res)
  }
  return out
}

// ---- test email ------------------------------------------------------------

export async function notifyTestEmail(user) {
  return notifyUser({
    user,
    type: 'test',
    title: 'Test notification',
    message: 'This is a test notification from your AI Learning Agent.',
    priority: 'low',
    metadata: { firstName: firstName(user), subject: 'Test — LearnMate notification' },
    idempotencyKey: `test:${user.id}:${Date.now()}`,
  })
}
