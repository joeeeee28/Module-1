// LearnMate Chat Agent — the multi-turn intent router.
//
// It turns a user message (plus conversation history) into a set of real tool
// calls against the user's actual learning data, and composes a readable reply
// from the results. It tracks "focus" — the topic/goal the conversation is
// currently about — so pronouns like "it", "that" and "make it harder" resolve
// correctly without the user repeating themselves. When an LLM API key is
// configured, open-ended intents are enriched with a model answer that is given
// the same real tool context; otherwise the deterministic engine answers.

import { db, now, addDays } from '../db.js'
import { config, logger } from '../config.js'
import { aiComplete } from './provider.js'
import { tools as toolRegistry } from './tools.js'
import { logAgentRun } from '../agent/runlog.js'
import { deriveMemory } from './memory.js'

// ---- small context helpers --------------------------------------------------

function activeGoals(uid) {
  return db.prepare(`SELECT * FROM goals WHERE status='active' AND user_id = ? ORDER BY priority`).all(uid)
}

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

function firstFrontier(uid) {
  const g = activeGoals(uid)[0]
  return g ? { goal: g, topic: frontier(g.id) } : { goal: null, topic: null }
}

function matchTopic(uid, phrase) {
  if (!phrase) return null
  const n = phrase.toLowerCase()
  const topics = db
    .prepare(
      `SELECT t.id, t.name FROM topics t
       WHERE t.goal_id IN (SELECT id FROM goals WHERE user_id = ?)`
    )
    .all(uid)
  for (const t of topics) {
    const tn = t.name.toLowerCase()
    if (tn.includes(n) || n.includes(tn)) return t
  }
  return null
}

// ---- intent detection -------------------------------------------------------

const INTENT_RULES = [
  ['greeting', /^(hi|hello|hey|yo|good (morning|afternoon|evening)|sup)\b/i],
  ['profile', /about me|my profile|who am i|tell me about myself|my setup/i],
  ['goal_create', /(create|add|make|set up).{0,20}goal|want to (learn|master|become)|new goal|i('| a)?m learning/i],
  ['resources', /resource|material|tutorial|link|docs|where (can i|do i) (learn|find)|recommend/i],
  ['quiz', /quiz|test me|question me/i],
  ['explain', /explain|what is|what('| i)s|how does|how do|don('| i)t understand|confused|define|tell me about|help me understand/i],
  ['roadmap', /roadmap|my path|phases|what should i learn next|what('| i)s next|next topic|plan my learning/i],
  ['plan', /(create|generate|make|show).{0,20}plan|today('| i)s plan|what should i learn today|my plan|schedule|plan for today/i],
  ['task_complete', /complete|mark (it|the task|done)|done (with )?(the )?task|finish(ed)? (the )?task|task.{0,10}done/i],
  ['reschedule', /reschedule|postpone|move (it|the task|this).{0,15}later|push .{0,10}back|do it (tomorrow|another day|later)/i],
  ['harder', /harder|more challenging|challenge me|tougher|give me a harder|difficult(er)? version/i],
  ['easier', /easier|simpler|too hard|less advanced|beginner.{0,5}level|break it down more|step by step/i],
  ['weak', /weak|struggl|not good at|trouble (with|understanding)|need help (with|on)|improve on|where should i/i],
  ['remind', /remind me (to|about)|remind me|set a reminder|remember to|nudge me/i],
  ['notif_email_morning', /send me.{0,20}(plan|briefing|schedule).{0,20}email|by email every morning|email.{0,10}(my )?(plan|morning|daily)|morning.{0,15}email|daily.{0,10}email/i],
  ['notif_stop_task_email', /stop.{0,15}(task|reminder).{0,15}email|no (more )?task (reminder )?emails|don('| i)t send.{0,20}(task|reminder)|turn off.{0,15}(task|reminder|email)/i],
  ['weekly', /weekly review|review (my|this) week|this week|summarize my week|how was my week|week in review/i],
  ['progress', /progress|how am i doing|am i (on track|doing)|status update|how('| i)s it going/i],
  ['memory', /what have i learned|what do i know|my strengths|remember|recap/i],
  ['goals', /my goals|what am i learning|list my (goals|topics)|show (my )?goals/i],
  ['sessions', /recent sessions|last time i (studied|learned)|what did i (study|learn)/i],
  ['motivate', /motivat|tired|give up|unmotivated|feeling down|burned out/i],
  ['fallback', /./s],
]

function detectIntent(message) {
  const m = message.toLowerCase()
  for (const [intent, re] of INTENT_RULES) {
    if (re.test(m)) return intent
  }
  return 'fallback'
}

// ---- tool invocation --------------------------------------------------------

function tool(name) {
  const t = toolRegistry.find((x) => x.name === name)
  if (!t) throw new Error(`Unknown tool: ${name}`)
  return t
}

// Synchronous invocation for tools with sync handlers.
function callSync(name, user, params = {}) {
  return tool(name).handler(params || {}, { user, uid: user.id })
}

async function callAsync(name, user, params = {}) {
  return await tool(name).handler(params || {}, { user, uid: user.id })
}

// ---- renderers (pure functions of tool data) --------------------------------

function planReplyText(data) {
  const tasks = data.tasks || []
  const lines = tasks.map((t) => `- **${t.title}** · ${t.duration} min (${t.type})`)
  return `Here's today's plan — **${data.plan?.topic}**. ${data.plan?.objective || ''}\n\n` +
    `${lines.join('\n') || '_No tasks yet — add a goal first._'}\n\n` +
    `Say **"mark it done"** when you finish a task and I'll log it.`
}

function roadmapText(data) {
  if (!data.goal) return "You don't have an active goal yet. Tell me what you want to learn and I'll build your roadmap."
  const phases = data.phases
    .map((p) => `**Phase ${p.phase}: ${p.title}** (${p.status})\n  ${(p.topics || []).map((t) => (t.status === 'completed' ? '✅' : t.status === 'not_started' ? '→' : '·') + ' ' + t.name).join('\n  ')}`)
    .join('\n')
  return `Here's your roadmap for **${data.goal.name}** (${data.goal.progress}% complete):\n\n${phases}\n\nNext up: **${data.nextTopic?.name || 'roadmap complete'}**. Say **"quiz me"** to test yourself.`
}

function explainText(data) {
  if (!data?.found) return "I couldn't find that topic on your roadmap. Tell me which goal it's part of."
  const concepts = data.concepts || []
  const exercises = data.exercises || []
  return `Let's unpack **${data.topic.name}**.\n\n${data.topic.description || ''}\n\n` +
    (concepts.length ? `**Key ideas:** ${concepts.join(' · ')}\n\n` : '') +
    (exercises.length ? `**Try this:** ${exercises[0]}\n\n` : '') +
    `Want me to go **easier** or give you a **harder** challenge on this?`
}

function harderText(data) {
  if (!data?.found) return "Add an active goal and I can scale up the difficulty for you."
  const ex = data.exercises || []
  const base = ex[0] || `practice ${data.topic.name}`
  return `Challenge on **${data.topic.name}** 💪\n\nTake *"${base}"* and raise the bar: handle edge cases, add error handling, optimize it, and write a test to prove it works.`
}

function easierText(data) {
  if (!data?.found) return "Add an active goal and I can break a topic down for you."
  const concepts = data.concepts || []
  return `No problem — let's make **${data.topic.name}** approachable.\n\n${data.topic.description || ''}\n\n` +
    (concepts.length ? `Focus on just these core pieces first: ${concepts.slice(0, 3).join(' · ')}.\n\n` : '') +
    `Try explaining one of those back to me in a sentence. Want a gentle practice exercise?`
}

function quizText(data) {
  const a = data.assessment
  const qs = a.questions || []
  const lines = qs.map((q, i) => {
    let s = `${i + 1}. ${q.prompt}`
    if (Array.isArray(q.options) && q.options.length) {
      s += '\n' + q.options.map((o, oi) => `   ${String.fromCharCode(97 + oi)}) ${o.text}`).join('\n')
    }
    return s
  })
  return `Here's a quick quiz on **${a.title.replace(/^Quick Quiz:\s*/, '')}** — ${qs.length} questions:\n\n` +
    lines.join('\n\n') +
    `\n\nAnswer here or in the **Assessments** tab and I'll check them!`
}

function weakText(data) {
  const combined = data.combined || []
  if (!combined.length) return "Looking at your activity, I don't see obvious weak areas right now — nice consistency! Ask me to quiz you to spot-check."
  return `Based on your recent sessions, focus on these:\n\n${combined.map((w) => `- ${w}`).join('\n')}\n\nWant me to schedule a revision or give you a practice challenge?`
}

function completedText(data) {
  if (!data?.id) return "I couldn't find a task to mark done. Generate today's plan first."
  return `Done! Marked **${data.title}** as complete. ✅ Nice work — keep it up.`
}

function rescheduledText(data) {
  if (!data?.id) return "I couldn't find a task to reschedule."
  return `Moved **${data.title}** to **${data.new_date}**. I'll keep it on your list for that day.`
}

function weeklyText(data) {
  const s = data.summary
  return `Here's your week in review 📊\n\n` +
    `- **${s.completedSessions}** sessions · **${s.learningHours}h** learned\n` +
    `- **${s.completionRate}%** task completion\n` +
    `- Strongest: **${s.strongest}**\n` +
    `- Watch out for: **${s.weakest}**\n` +
    (s.biggestAchievement ? `- 🏆 ${s.biggestAchievement}\n` : '') +
    `\n**Recommendation:** ${s.recommendation}`
}

function progressText(data) {
  return `Here's your progress:\n\n` +
    `- **This week:** ${data.sessions} sessions · ${data.hours}h · ${data.completionRate}% completion` +
    (data.assessmentScore != null ? `\n- **Assessment score:** ${data.assessmentScore}%` : '')
}

function memoryText(data) {
  const m = data.memory
  const parts = []
  if (m.strengths) parts.push(`**Strengths:** ${m.strengths}`)
  if (m.weaknesses) parts.push(`**Weaknesses:** ${m.weaknesses}`)
  if (m.projects) parts.push(`**Projects:** ${m.projects}`)
  if (!parts.length) return "I haven't built up much memory of your learning yet. Complete a few sessions and I'll start recognizing patterns."
  return "Here's what I remember about your learning:\n\n" + parts.join('\n')
}

function goalCreatedText(data) {
  return `I've created the goal **${data.goal.name}** and generated a full roadmap (with a linked skill). 🎯\n\nSay **"roadmap"** to see it, or **"plan for today"** to start.`
}

function resourcesText(data) {
  const results = data.results || []
  if (!results.length) return `I couldn't find fresh resources for **${data.topic}**. Try a more specific topic.`
  return `Here are some resources for **${data.topic}**:\n\n` +
    results.map((r, i) => `${i + 1}. **${r.title}** — ${r.url}`).join('\n')
}

function goalsText(data) {
  if (!data.goals.length) return "You don't have any active goals yet. Tell me what you want to learn and I'll create one."
  return `Your active goals:\n\n` + data.goals.map((g) => `- **${g.name}** · ${g.progress}% · ${g.priority}`).join('\n')
}

function sessionsText(data) {
  if (!data.sessions.length) return "You don't have any completed sessions yet. Start a session in Today's Learning and I'll track it."
  return `Your recent sessions:\n\n` + data.sessions.map((s) => `- **${s.topic_name}** · ${s.date} · ${s.duration}m · confidence ${s.confidence}/5`).join('\n')
}

function profileText(data) {
  const p = data.profile
  const lines = [
    `- **Name:** ${p.name}`,
    p.role ? `- **Role:** ${p.role}` : null,
    p.career_goal ? `- **Career goal:** ${p.career_goal}` : null,
    p.target_role ? `- **Target role:** ${p.target_role}` : null,
    `- **Daily learning budget:** ${p.daily_learning_minutes || 45} min`,
    `- **Timezone:** ${p.timezone || 'UTC'}`,
    p.learning_style ? `- **Learning style:** ${p.learning_style}` : null,
  ].filter(Boolean)
  return `Here's what I know about you:\n\n` + lines.join('\n')
}

// ---- LLM enrichment ---------------------------------------------------------

function isOpenEnded(intent) {
  return ['explain', 'resources', 'motivate', 'fallback'].includes(intent)
}

async function enrichWithLLM(intent, message, context) {
  if (!isOpenEnded(intent)) return null
  try {
    const system =
      'You are a personal learning coach inside LearnMate. Answer using ONLY the provided real user context. ' +
      'Be concise and practical. If the context lacks data, say so. Never invent the user\'s progress.'
    const userMsg = `User context:\n${JSON.stringify(context, null, 2)}\n\nUser question: ${message}`
    return await aiComplete(system, userMsg)
  } catch (e) {
    logger.warn('agent', 'LLM enrichment failed, using engine reply', { error: e.message })
    return null
  }
}

function agentContext(uid, user) {
  return {
    user: { name: user?.name, role: user?.role, career_goal: user?.career_goal },
    goals: db.prepare(`SELECT name, progress FROM goals WHERE status='active' AND user_id = ?`).all(uid),
    skills: db.prepare(`SELECT name, current_mastery FROM skills WHERE user_id = ? ORDER BY current_mastery DESC LIMIT 3`).all(uid),
    recentSessions: db.prepare(`SELECT topic_name, date, confidence FROM sessions WHERE user_id = ? AND status='completed' ORDER BY date DESC LIMIT 5`).all(uid),
  }
}

// ---- text extraction --------------------------------------------------------

function extractGoalName(message) {
  let m = message.replace(/^(create|add|make|set up)\s+(a\s+)?goal[:,]?\s*/i, '')
  m = m.replace(/^i('| a)?m learning\s+/i, '')
  m = m.replace(/^i want to (learn|master|become proficient in)\s+/i, '')
  m = m.replace(/[.!?]+$/, '').trim()
  return m
}

function extractTopicPhrase(message) {
  let m = message.replace(/recommend|resources|materials?|tutorials?|links?|docs|for|on|about|find|give me/gi, '')
  return m.replace(/[.!?]+$/, '').trim()
}

function extractReminderTopic(message, fallback) {
  let m = message.replace(/^(remind me|please remind me|set a reminder|nudge me)\s+/i, '')
  m = m.replace(/\bto (study|learn|review|practice|do|work on|revisit)\b/i, '')
  m = m.replace(/\b(tomorrow|tonight|today|this (morning|afternoon|evening)|next (week|weekend)|in the morning|in the evening|at \d+\s?[ap]m)\b.*$/i, '')
  m = m.replace(/[.!?]+$/, '').trim()
  return m || fallback || 'your current topic'
}

function extractReminderWhen(message) {
  const m = message.toLowerCase()
  if (/tonight/.test(m)) return 'tonight'
  if (/this afternoon/.test(m)) return 'this afternoon'
  if (/this evening/.test(m)) return 'this evening'
  if (/in the morning/.test(m)) return 'tomorrow morning'
  if (/next week/.test(m)) return 'next week'
  if (/tomorrow|in the morning/.test(m)) return 'tomorrow morning'
  return 'tomorrow morning'
}

// ---- public entry point -----------------------------------------------------

/**
 * Process a user message and return { content, source, intent, tool, data, focus }.
 *
 * opts:
 *   - history: previous turns [{ role, content }] (used for context / LLM only)
 *   - conversation: the conversation row, so stored focus_json can be read;
 *     the resolved focus is returned (never mutated here — the caller persists it).
 */
export async function handleMessage(message, userId, opts = {}) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!user) throw new Error('User not found')

  let focus = {}
  try {
    focus = JSON.parse(opts.conversation?.focus_json || '{}') || {}
  } catch {
    focus = {}
  }

  const intent = detectIntent(message)
  let content
  let toolName = null
  let data = null

  // If the message explicitly names a roadmap topic, that becomes the focus.
  const explicitTopic = matchTopic(userId, message)
  if (explicitTopic) focus = { type: 'topic', id: explicitTopic.id, name: explicitTopic.name }

  switch (intent) {
    case 'greeting':
      content = `Hi ${user.name.split(' ')[0]}! I'm your learning coach — I work from your **real** goals, roadmap and history. Ask me to plan your day, quiz you, explain a topic, point out weak areas, or review your week.`
      break
    case 'profile':
      toolName = 'get_user_profile'
      data = callSync('get_user_profile', user)
      content = profileText(data)
      break
    case 'goals':
      toolName = 'get_learning_goals'
      data = callSync('get_learning_goals', user)
      content = goalsText(data)
      break
    case 'sessions':
      toolName = 'get_recent_sessions'
      data = callSync('get_recent_sessions', user)
      content = sessionsText(data)
      break
    case 'plan':
      toolName = 'create_learning_plan'
      data = callSync('create_learning_plan', user)
      content = planReplyText(data)
      break
    case 'roadmap':
      toolName = 'get_current_roadmap'
      data = callSync('get_current_roadmap', user)
      content = roadmapText(data)
      break
    case 'explain':
      toolName = 'explain_topic'
      data = callSync('explain_topic', user, { topic: focus?.name })
      content = explainText(data)
      if (data?.found) focus = { type: 'topic', id: data.topic.id, name: data.topic.name }
      break
    case 'harder':
      toolName = 'explain_topic'
      data = callSync('explain_topic', user, { topic: focus?.name })
      content = harderText(data)
      if (data?.found) focus = { type: 'topic', id: data.topic.id, name: data.topic.name }
      break
    case 'easier':
      toolName = 'explain_topic'
      data = callSync('explain_topic', user, { topic: focus?.name })
      content = easierText(data)
      if (data?.found) focus = { type: 'topic', id: data.topic.id, name: data.topic.name }
      break
    case 'quiz':
      toolName = 'generate_assessment'
      try {
        data = callSync('generate_assessment', user)
        content = quizText(data)
      } catch (e) {
        content = e.message
      }
      break
    case 'weak':
      toolName = 'get_weak_areas'
      data = callSync('get_weak_areas', user)
      content = weakText(data)
      break
    case 'task_complete': {
      const pending = callSync('get_pending_tasks', user)
      toolName = 'complete_learning_task'
      data = callSync('complete_learning_task', user, { taskId: pending?.tasks?.[0]?.id, confidence: 3 })
      deriveMemory(userId)
      content = completedText(data)
      break
    }
    case 'reschedule': {
      const pending = callSync('get_pending_tasks', user)
      toolName = 'reschedule_learning_task'
      data = callSync('reschedule_learning_task', user, { taskId: pending?.tasks?.[0]?.id, date: addDays(now(), 1) })
      content = rescheduledText(data)
      break
    }
    case 'weekly':
      toolName = 'generate_weekly_review'
      data = callSync('generate_weekly_review', user)
      content = weeklyText(data)
      break
    case 'progress':
      toolName = 'get_weekly_progress'
      data = callSync('get_weekly_progress', user)
      content = progressText(data)
      break
    case 'memory':
      toolName = 'get_learning_memory'
      data = callSync('get_learning_memory', user)
      content = memoryText(data)
      break
    case 'goal_create': {
      const name = extractGoalName(message)
      toolName = 'create_learning_goal'
      try {
        data = callSync('create_learning_goal', user, { name: name || message })
        deriveMemory(userId)
        content = goalCreatedText(data)
      } catch (e) {
        content = e.message
      }
      break
    }
    case 'resources': {
      const topic = focus?.name || extractTopicPhrase(message) || firstFrontier(userId).topic?.name
      toolName = 'discover_learning_resources'
      data = await callAsync('discover_learning_resources', user, { topic })
      content = resourcesText(data)
      break
    }
    case 'remind': {
      const topic = extractReminderTopic(message, firstFrontier(userId).topic?.name)
      toolName = 'create_reminder'
      data = await callAsync('create_reminder', user, { topic, when: extractReminderWhen(message) })
      content = `Got it — I've scheduled a reminder to study **${topic}** ${data.reminder.when}. You'll see it in your notifications. 🔔`
      break
    }
    case 'notif_email_morning': {
      toolName = 'set_notification_preferences'
      data = callSync('set_notification_preferences', user, { emailMorning: true })
      content = `Done — I've enabled your **daily learning plan email** so it arrives each morning. You can adjust this anytime in Notification Settings. 📧`
      break
    }
    case 'notif_stop_task_email': {
      toolName = 'set_notification_preferences'
      data = callSync('set_notification_preferences', user, { emailTaskReminders: false })
      content = `Done — I've turned off **task reminder emails**. Your in-app notifications are still active, and you can re-enable email anytime in Notification Settings.`
      break
    }
    case 'motivate':
      content = `You've got this. 💪 Consistency beats intensity — a small win today compounds. You're already further than you were last week. Want me to generate a lighter plan for today?`
      break
    default: {
      const goals = callSync('get_learning_goals', user).goals
      const summary = goals.length ? `Active goals: ${goals.map((g) => `**${g.name}** (${g.progress}%)`).join(', ')}.` : 'No active goals yet.'
      content = `Here's where you stand: ${summary}\n\nI can help you **plan today**, **quiz you**, **explain a topic**, point out **weak areas**, review your **week**, or **create a goal**. What would help most?`
    }
  }

  // LLM enrichment for open-ended intents (only when a model key is configured)
  const useModel = isOpenEnded(intent) && Boolean(config.openaiApiKey || config.anthropicApiKey)
  if (useModel) {
    const llm = await enrichWithLLM(intent, message, agentContext(userId, user))
    if (llm) content = llm
  }

  logAgentRun(userId, 'Chat Agent', `intent=${intent}${toolName ? ` tool=${toolName}` : ''}`, message.slice(0, 80))

  return { content, source: useModel ? 'model' : 'engine', intent, tool: toolName, data, focus }
}
