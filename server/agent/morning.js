// The Daily/Morning Agent — the full automated pipeline executed each morning:
//   load profile → goals → roadmap progress → yesterday → missed → deadlines →
//   weak areas → revision → (optional live info) → priority decision →
//   generate + persist plan → send notification.
//
// The plan is always dynamically generated from current data — never a static
// message. Every step is logged to agent_runs.

import { db, userToday } from '../db.js'
import { logger } from '../config.js'
import { generateDailyPlan, computePriorityScores, goalWeakArea } from '../ai/engine.js'
import { memorySummary, deriveMemory } from '../ai/memory.js'
import { discoverResources, getCurrentInfo } from '../ai/discovery.js'
import { notifyMorningPlan } from './generators.js'
import { logAgentRun } from './runlog.js'

export async function runMorningAgent(userId, { notify = true } = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!user) throw new Error('User not found')

  const today = userToday(user)
  logAgentRun(userId, 'Daily Agent', 'Started morning run', `date=${today} tz=${user.timezone}`)

  // 0. derive fresh memory from recent activity
  deriveMemory(userId)
  const memory = memorySummary(userId)

  // 1. compute priority across active goals (decision engine)
  const scores = computePriorityScores(user)
  logAgentRun(userId, 'Planner Agent', 'Computed goal priorities',
    scores.slice(0, 3).map((s) => `${s.goal.name}:${s.score}`).join(', '))

  // 2. reuse today's plan if it already exists (avoid duplicates), else generate
  let plan = db
    .prepare('SELECT * FROM daily_plans WHERE user_id = ? AND date = ? ORDER BY id DESC LIMIT 1')
    .get(userId, today)
  let briefing = plan ? JSON.parse(plan.briefing_json || '{}') : null
  const reused = Boolean(plan)

  if (reused) {
    logAgentRun(userId, 'Daily Agent', 'Plan already exists for today — reusing', `planId=${plan.id}`)
  } else {
    const generated = generateDailyPlan(user, today)
    plan = generated.plan
    briefing = generated.briefing
    logAgentRun(userId, 'Planner Agent', 'Generated daily plan', `planId=${plan.id} topic=${briefing.topic}`)
  }

  // 3. enrich briefing with real, current resources + live info where reachable
  let resource = null
  let currentInfo = null
  try {
    const found = await discoverResources(briefing.topic, { limit: 1 })
    resource = found.find((r) => r.verified) || found[0] || null
    if (resource) {
      db.prepare(
        `INSERT INTO resources (user_id, goal_id, title, url, type, source, topic, verified, last_verified)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(userId, plan.primary_goal_id || null, resource.title, resource.url, resource.type, resource.source, briefing.topic, resource.verified ? 1 : 0, resource.lastVerified || null)
      logAgentRun(userId, 'Resource Agent', 'Recommended resource', `${resource.title} (${resource.source}, verified=${resource.verified})`)
    }
    currentInfo = await getCurrentInfo(briefing.topic)
  } catch (e) {
    logger.warn('morning', 'Live enrichment unavailable — using saved resources', { error: e.message })
    logAgentRun(userId, 'Resource Agent', 'Live discovery unavailable', e.message, 'WARN')
  }

  const enriched = {
    ...briefing,
    why: scores[0] ? `This supports your "${scores[0].goal.name}" goal (${scores[0].goal.why || 'a priority for your career'}).` : '',
    weakArea: memory.weaknesses || null,
    recommendedResource: resource || null,
    currentInfo,
    liveDataStatus: currentInfo ? 'current' : 'unavailable',
  }

  db.prepare('UPDATE daily_plans SET briefing_json = ? WHERE id = ?').run(JSON.stringify(enriched), plan.id)
  logAgentRun(userId, 'Daily Agent', 'Briefing enriched', `resource=${resource ? 'yes' : 'no'} live=${currentInfo ? 'yes' : 'no'}`)

  // 4. send the morning notification (in-app + email when enabled)
  if (notify) {
    try {
      const results = await notifyMorningPlan(user, enriched, plan)
      const ok = results.every((r) => r.status === 'delivered')
      logAgentRun(userId, 'Notification Agent', 'Morning notification', results.map((r) => `${r.channel}:${r.status}`).join(', '), ok ? 'SUCCESS' : 'PARTIAL')
    } catch (e) {
      logAgentRun(userId, 'Notification Agent', 'Morning notification', e.message, 'FAILED')
    }
  } else {
    logAgentRun(userId, 'Notification Agent', 'Skipped (notify=false)', '')
  }

  logAgentRun(userId, 'Daily Agent', 'Finished morning run', `planId=${plan.id}`)
  return { plan: db.prepare('SELECT * FROM daily_plans WHERE id = ?').get(plan.id), briefing: enriched, skipped: reused }
}
