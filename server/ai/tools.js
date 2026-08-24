// LearnMate tool registry — a set of named, server-side tools the AI coach can
// call to read and mutate the user's REAL learning data. Every tool runs with
// the caller's user id, so data stays per-user. The intent router in agent.js
// maps a user message to one or more of these tools and composes an answer from
// the results. Tools never fake data — they query or update the database.

import { db, now, addDays, userToday } from '../db.js'
import {
  generateDailyPlan,
  completeTask,
  generateAssessment,
  gradeAssessment,
  generateReview,
  generateRoadmap,
  ensureSkillForGoal,
  recomputeAllProgress,
  computeGoalProgress,
  getGoalWithTopics,
  goalWeakArea,
} from './engine.js'
import { discoverResources, getCurrentInfo } from './discovery.js'
import { memorySummary } from './memory.js'

// ---- small query helpers used by several tools ----------------------------

function frontier(goalId) {
  return (
    db
      .prepare(
        `SELECT t.*, p.phase_number FROM topics t
         JOIN roadmap_phases p ON p.id = t.phase_id
         WHERE t.goal_id = ? AND t.status != 'completed'
         ORDER BY p.phase_number, t.sort LIMIT 1`
      )
      .get(goalId) || null
  )
}

function activeGoals(uid) {
  return db.prepare(`SELECT * FROM goals WHERE status='active' AND user_id = ? ORDER BY priority`).all(uid)
}

function topicForName(uid, name) {
  if (!name) return null
  const n = name.toLowerCase()
  const t = db
    .prepare(
      `SELECT t.*, g.name AS goal_name FROM topics t JOIN goals g ON g.id = t.goal_id
       WHERE t.goal_id IN (SELECT id FROM goals WHERE user_id = ?) AND lower(t.name) LIKE ? LIMIT 1`
    )
    .get(uid, `%${n}%`)
  return t || null
}

// ---- tool definitions -------------------------------------------------------

/**
 * Each tool: { name, description, handler(params, ctx) -> data }
 * `ctx` = { user, uid }. Handlers may be sync or async. `params` are
 * free-form and passed from the intent router.
 */
export const tools = [
  {
    name: 'get_user_profile',
    description: "Return the user's profile: name, role, career goal, experience level and learning preferences.",
    handler: (params, { user }) => {
      const { password_hash, password_salt, ...safe } = user
      return {
        profile: safe,
        daily_minutes: user.daily_learning_minutes,
        timezone: user.timezone,
        learning_style: user.learning_style,
        career_goal: user.career_goal,
        target_role: user.target_role,
      }
    },
  },
  {
    name: 'get_learning_goals',
    description: "Return the user's active learning goals with progress, priority, deadline and current level.",
    handler: (params, { uid }) => {
      const goals = activeGoals(uid).map((g) => ({
        id: g.id,
        name: g.name,
        progress: computeGoalProgress(g.id),
        priority: g.priority,
        deadline: g.deadline,
        current_level: g.current_level,
        target_level: g.target_level,
        why: g.why,
        status: g.status,
      }))
      return { goals }
    },
  },
  {
    name: 'get_current_roadmap',
    description: "Return the user's current roadmap for the first active goal, including phases and the next topic to study.",
    handler: (params, { uid }) => {
      const goals = activeGoals(uid)
      const goal = params?.goal_id ? db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(params.goal_id, uid) : goals[0]
      if (!goal) return { goal: null, phases: [], nextTopic: null }
      const g = getGoalWithTopics(goal.id)
      const phases = g.phases.map((p) => ({
        phase: p.phase_number,
        title: p.title,
        status: p.status,
        progress: p.progress,
        topics: g.topics.filter((t) => t.phase_id === p.id).map((t) => ({ id: t.id, name: t.name, status: t.status, difficulty: t.difficulty })),
      }))
      const f = frontier(goal.id)
      return { goal: { id: goal.id, name: goal.name, progress: g.progress }, phases, nextTopic: f ? { id: f.id, name: f.name } : null }
    },
  },
  {
    name: 'get_skill_mastery',
    description: "Return the user's skills with current mastery level and category.",
    handler: (params, { uid }) => {
      const skills = db.prepare('SELECT name, category, current_mastery, target_mastery, current_level FROM skills WHERE user_id = ? ORDER BY current_mastery DESC').all(uid)
      return { skills }
    },
  },
  {
    name: 'get_recent_sessions',
    description: 'Return the most recent completed learning sessions with topic, duration, confidence and difficulty.',
    handler: (params, { uid }) => {
      const limit = Math.min(Number(params?.limit) || 10, 50)
      const sessions = db.prepare('SELECT topic_name, date, duration, confidence, difficulty FROM sessions WHERE user_id = ? AND status="completed" ORDER BY date DESC, id DESC LIMIT ?').all(uid, limit)
      return { sessions }
    },
  },
  {
    name: 'get_pending_tasks',
    description: "Return the user's pending tasks for today's plan (or the latest plan).",
    handler: (params, { user }) => {
      const uid = user.id
      const date = userToday(user)
      let plan = db.prepare('SELECT * FROM daily_plans WHERE date = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get(date, uid)
      if (!plan) plan = db.prepare('SELECT * FROM daily_plans WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 1').get(uid)
      if (!plan) return { plan: null, tasks: [] }
      const tasks = db.prepare("SELECT id, title, type, duration, status, description FROM tasks WHERE daily_plan_id = ? AND status != 'completed' ORDER BY sort").all(plan.id)
      return { plan: { id: plan.id, date: plan.date, topic: plan.topic }, tasks }
    },
  },
  {
    name: 'get_revision_tasks',
    description: "Return the user's spaced-repetition revision tasks that are due or upcoming.",
    handler: (params, { user }) => {
      const uid = user.id
      const date = userToday(user)
      const due = db.prepare("SELECT topic_name, due_date, interval_days FROM revision_schedule WHERE user_id = ? AND status='pending' AND due_date <= ? ORDER BY due_date LIMIT 20").all(uid, date)
      const upcoming = db.prepare("SELECT topic_name, due_date, interval_days FROM revision_schedule WHERE user_id = ? AND status='pending' AND due_date > ? ORDER BY due_date LIMIT 10").all(uid, date)
      return { due, upcoming, count: due.length }
    },
  },
  {
    name: 'create_learning_plan',
    description: 'Generate a fresh adaptive daily plan for today and return its tasks.',
    handler: (params, { user }) => {
      const { plan, briefing } = generateDailyPlan(user)
      const tasks = db.prepare('SELECT id, title, type, duration, status FROM tasks WHERE daily_plan_id = ? ORDER BY sort').all(plan.id)
      return { plan: { id: plan.id, date: plan.date, topic: plan.topic, objective: plan.objective }, tasks, briefing }
    },
  },
  {
    name: 'complete_learning_task',
    description: "Mark a learning task as completed, recording confidence and difficulty. Returns the updated task.",
    handler: (params, { uid }) => {
      const taskId = Number(params?.taskId)
      if (!taskId) throw new Error('taskId is required')
      const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, uid)
      if (!task) throw new Error('Task not found')
      completeTask(taskId, {
        status: 'completed',
        confidence: Number(params.confidence) || 3,
        difficulty: params.difficulty || 'medium',
        actual_minutes: params.actualMinutes || task.duration,
        learned: params.learned || null,
      })
      return db.prepare('SELECT id, title, type, duration, status FROM tasks WHERE id = ?').get(taskId)
    },
  },
  {
    name: 'reschedule_learning_task',
    description: 'Move a pending task to a later date (or mark it to revisit), returning the rescheduled task.',
    handler: (params, { uid }) => {
      const taskId = Number(params?.taskId)
      if (!taskId) throw new Error('taskId is required')
      const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, uid)
      if (!task) throw new Error('Task not found')
      const date = params.date || addDays(now(), 1)
      // move the owning plan to the target date so the task surfaces there
      db.prepare('UPDATE daily_plans SET date = ? WHERE id = ?').run(date, task.daily_plan_id)
      db.prepare("UPDATE tasks SET status = 'not_started' WHERE id = ?").run(taskId)
      return { id: task.id, title: task.title, status: 'not_started', new_date: date }
    },
  },
  {
    name: 'create_learning_goal',
    description: 'Create a new learning goal, generating its roadmap and a linked skill. Returns the new goal.',
    handler: (params, { uid }) => {
      const name = params?.name
      if (!name) throw new Error('Goal name is required')
      const ins = db
        .prepare(
          `INSERT INTO goals (user_id, name, description, why, target_outcome, current_level, target_level, priority, deadline, hours_per_week, preferred_method)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          uid,
          name,
          params.description || '',
          params.why || '',
          params.target_outcome || '',
          params.current_level || 'Beginner',
          params.target_level || 'Advanced',
          params.priority || 'Medium',
          params.deadline || null,
          Number(params.hours_per_week) || 5,
          params.preferred_method || 'Hands-on / project-based'
        )
      const id = Number(ins.lastInsertRowid)
      const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(id)
      generateRoadmap(id)
      ensureSkillForGoal(goal)
      recomputeAllProgress(uid)
      return { goal: { id: goal.id, name: goal.name, status: goal.status, progress: computeGoalProgress(goal.id) } }
    },
  },
  {
    name: 'generate_assessment',
    description: 'Generate a quick quiz on the user’s current topic. Returns the assessment questions.',
    handler: (params, { uid }) => {
      const goals = activeGoals(uid)
      const goal = params?.goal_id ? db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(params.goal_id, uid) : goals[0]
      if (!goal) throw new Error('Create a learning goal first so I can quiz you.')
      const f = frontier(goal.id)
      const a = generateAssessment('quick', goal.id, f?.id)
      return {
        assessment: { id: a.id, title: a.title, kind: a.kind, questions: JSON.parse(a.questions_json || '[]') },
      }
    },
  },
  {
    name: 'get_assessment_results',
    description: 'Return the user’s recent completed assessment scores.',
    handler: (params, { uid }) => {
      const rows = db.prepare('SELECT title, score, max_score, date, completed FROM assessments WHERE user_id = ? AND completed=1 ORDER BY date DESC, id DESC LIMIT 10').all(uid)
      return { assessments: rows.map((r) => ({ title: r.title, score: r.score, max_score: r.max_score, pct: r.max_score ? Math.round((r.score / r.max_score) * 100) : 0, date: r.date })) }
    },
  },
  {
    name: 'discover_learning_resources',
    description: 'Discover official docs and curated learning resources for a topic.',
    handler: async (params, { uid }) => {
      const topic = params?.topic
      if (!topic) throw new Error('A topic is required to discover resources.')
      const results = await discoverResources(topic, { limit: 5 })
      return { topic, results }
    },
  },
  {
    name: 'save_learning_resource',
    description: 'Save a resource link for later. Returns the saved resource.',
    handler: (params, { uid }) => {
      const { title, url, type } = params || {}
      if (!title) throw new Error('title is required')
      const ins = db.prepare('INSERT INTO resources (user_id, title, url, type, source) VALUES (?,?,?,?,?)').run(uid, title, url || null, type || 'link', 'agent')
      return db.prepare('SELECT * FROM resources WHERE id = ?').get(Number(ins.lastInsertRowid))
    },
  },
  {
    name: 'create_note',
    description: 'Create or update a note for a topic. Returns the saved note.',
    handler: (params, { uid }) => {
      const { topicId, content, goalId } = params || {}
      if (!topicId || !content) throw new Error('topicId and content are required')
      const existing = db.prepare('SELECT id FROM notes WHERE topic_id = ? AND user_id = ?').get(topicId, uid)
      if (existing) {
        db.prepare("UPDATE notes SET content = ?, updated_at = datetime('now') WHERE id = ?").run(content, existing.id)
      } else {
        db.prepare('INSERT INTO notes (user_id, goal_id, topic_id, content) VALUES (?,?,?,?)').run(uid, goalId || null, topicId, content)
      }
      return db.prepare('SELECT id, topic_id, content, updated_at FROM notes WHERE topic_id = ? AND user_id = ?').get(topicId, uid)
    },
  },
  {
    name: 'get_weekly_progress',
    description: 'Return aggregate weekly progress: sessions, minutes, completion rate, assessment score.',
    handler: (params, { user }) => {
      const uid = user.id
      const weekStart = addDays(userToday(user), -6)
      const sessions = db.prepare("SELECT duration, confidence FROM sessions WHERE user_id = ? AND status='completed' AND date >= ?").all(uid, weekStart)
      const tasks = db.prepare('SELECT t.status FROM tasks t JOIN daily_plans p ON p.id = t.daily_plan_id WHERE p.date >= ? AND p.user_id = ?').all(weekStart, uid)
      const done = tasks.filter((t) => t.status === 'completed').length
      const assess = db.prepare('SELECT score, max_score FROM assessments WHERE user_id = ? AND completed=1 AND date >= ?').all(uid, weekStart)
      const minutes = sessions.reduce((a, s) => a + (s.duration || 0), 0)
      return {
        weekStart,
        sessions: sessions.length,
        minutes,
        hours: (minutes / 60).toFixed(1),
        completionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
        assessmentScore: assess.length ? Math.round(assess.reduce((a, x) => a + (x.score / (x.max_score || 1)) * 100, 0) / assess.length) : null,
      }
    },
  },
  {
    name: 'generate_weekly_review',
    description: 'Generate a weekly review summary from the user’s real activity.',
    handler: (params, { uid }) => {
      const r = generateReview('weekly', uid)
      return { summary: r.summary, next: r.next }
    },
  },
  {
    name: 'get_learning_memory',
    description: "Return the user's derived learning memory: strengths, weaknesses, struggles, projects.",
    handler: (params, { uid }) => {
      return { memory: memorySummary(uid) }
    },
  },
  {
    name: 'get_current_info',
    description: 'Return a short, current real-world explanation of a topic from the discovery index.',
    handler: async (params, { uid }) => {
      const topic = params?.topic
      if (!topic) throw new Error('A topic is required.')
      const info = await getCurrentInfo(topic)
      return { topic, info }
    },
  },
  {
    name: 'get_weak_areas',
    description: "Identify the user's weak areas from low-confidence sessions, needs-review topics and low assessment scores.",
    handler: (params, { user }) => {
      const uid = user.id
      const weakTopics = db.prepare("SELECT name FROM topics WHERE status='needs_review' AND goal_id IN (SELECT id FROM goals WHERE user_id = ?)").all(uid).map((t) => t.name)
      const weakSessions = db.prepare("SELECT topic_name FROM sessions WHERE user_id = ? AND status='completed' AND confidence <= 2 AND topic_name IS NOT NULL GROUP BY topic_name LIMIT 5").all(uid).map((s) => s.topic_name)
      const lowAssess = db.prepare("SELECT title FROM assessments WHERE user_id = ? AND completed=1 AND (score*1.0/max_score) < 0.6 LIMIT 5").all(uid).map((a) => a.title)
      const memory = memorySummary(uid)
      const memoryWeak = memory.weaknesses ? memory.weaknesses.split(', ').slice(0, 5) : []
      return {
        weakTopics,
        weakSessions,
        lowAssessmentAreas: lowAssess,
        memoryWeak,
        combined: [...new Set([...weakTopics, ...weakSessions, ...memoryWeak])].slice(0, 8),
      }
    },
  },
  {
    name: 'explain_topic',
    description: 'Explain a topic using the roadmap’s real concept list and description.',
    handler: (params, { uid }) => {
      const name = params?.topic
      let topic = topicForName(uid, name)
      if (!topic) {
        const goals = activeGoals(uid)
        topic = goals[0] ? frontier(goals[0].id) : null
      }
      if (!topic) return { found: false }
      const concepts = JSON.parse(topic.concepts_json || '[]')
      const exercises = JSON.parse(topic.exercises_json || '[]')
      return {
        found: true,
        topic: { id: topic.id, name: topic.name, description: topic.description, goal: topic.goal_name },
        concepts: concepts.slice(0, 6),
        exercises: exercises.slice(0, 3),
      }
    },
  },
]

export const toolMap = Object.fromEntries(tools.map((t) => [t.name, t]))

export async function callTool(name, params, ctx) {
  const tool = toolMap[name]
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  return await tool.handler(params || {}, ctx)
}
