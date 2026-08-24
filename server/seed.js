import { createHash } from 'node:crypto'
import { db, now, addDays } from './db.js'
import { generateRoadmap, generateDailyPlan, recomputeAllProgress } from './ai/engine.js'

const hash = (s) => createHash('sha256').update(s).digest('hex')

export function seedIfEmpty() {
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c
  if (users > 0) return

  // ---- user ----
  const u = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, role, career_goal, target_role, experience_level, daily_learning_minutes, preferred_days, briefing_time, learning_style)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      'Alex Morgan',
      'alex@example.com',
      hash('demo'),
      'IT Support Specialist',
      'Transition into a Solutions Architect / Automation Engineer role',
      'Solutions Architect',
      'Intermediate',
      45,
      JSON.stringify(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']),
      '07:30',
      'Hands-on / project-based'
    )
  const userId = Number(u.lastInsertRowid)

  // ---- skills ----
  const skillRows = [
    ['Python', 'Technical', 42, 85, 'Intermediate', 'Advanced'],
    ['SQL', 'Technical', 67, 80, 'Intermediate', 'Advanced'],
    ['JavaScript', 'Technical', 30, 70, 'Beginner', 'Intermediate'],
    ['REST APIs', 'Technical', 45, 80, 'Intermediate', 'Advanced'],
    ['Git/GitHub', 'Technical', 55, 75, 'Intermediate', 'Advanced'],
    ['AI', 'Technical', 25, 70, 'Beginner', 'Intermediate'],
    ['AI Agents', 'Technical', 15, 60, 'Novice', 'Intermediate'],
    ['Automation', 'Technical', 38, 85, 'Beginner', 'Advanced'],
    ['Azure', 'Microsoft / Cloud', 20, 70, 'Beginner', 'Intermediate'],
    ['PowerShell', 'Microsoft / Cloud', 50, 75, 'Intermediate', 'Advanced'],
    ['ServiceNow', 'ServiceNow', 35, 70, 'Beginner', 'Intermediate'],
    ['Business Analysis', 'Business / Architecture', 40, 70, 'Beginner', 'Intermediate'],
    ['Solution Architecture', 'Business / Architecture', 22, 75, 'Beginner', 'Advanced'],
    ['Project Management', 'Business / Architecture', 48, 70, 'Intermediate', 'Advanced'],
  ]
  const skillInsert = db.prepare(
    'INSERT INTO skills (user_id, name, category, current_mastery, target_mastery, current_level, target_level) VALUES (?,?,?,?,?,?,?)'
  )
  for (const s of skillRows) skillInsert.run(userId, ...s)

  // ---- goals ----
  const g1 = db
    .prepare(
      `INSERT INTO goals (user_id, name, description, why, target_outcome, current_level, target_level, priority, deadline, hours_per_week, preferred_method, resources_json, related_goal)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      userId,
      'Become proficient in Python automation',
      'Move from intermediate Python to confidently building automation scripts and tools.',
      'Automation is the highest-leverage skill for moving from support work into engineering roles.',
      'Build and ship 2-3 real automation tools independently',
      'Intermediate',
      'Advanced',
      'High',
      addDays(now(), 90),
      5,
      'Hands-on / project-based',
      JSON.stringify([
        { title: 'Automate the Boring Stuff', url: 'https://automatetheboringstuff.com', type: 'Book' },
        { title: 'Real Python — API Integration', url: 'https://realpython.com/api-integration-in-python/', type: 'Documentation' },
      ]),
      'Solutions Architect'
    )
  const g1id = Number(g1.lastInsertRowid)

  const g2 = db
    .prepare(
      `INSERT INTO goals (user_id, name, description, why, target_outcome, current_level, target_level, priority, deadline, hours_per_week, preferred_method, related_goal)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      userId,
      'Master SQL for data analytics',
      'Build strong querying and analytical SQL skills.',
      'Data literacy underpins every technical and architecture role.',
      'Write complex analytical queries confidently',
      'Beginner',
      'Intermediate',
      'Medium',
      addDays(now(), 60),
      4,
      'Practice-driven',
      'Solutions Architect'
    )
  const g2id = Number(g2.lastInsertRowid)

  // ---- generate roadmaps ----
  generateRoadmap(g1id)
  generateRoadmap(g2id)

  const pythonTopics = db
    .prepare(
      `SELECT t.*, p.phase_number FROM topics t JOIN roadmap_phases p ON p.id=t.phase_id
       WHERE t.goal_id = ? ORDER BY p.phase_number, t.sort`
    )
    .all(g1id)
  const sqlTopics = db
    .prepare(
      `SELECT t.*, p.phase_number FROM topics t JOIN roadmap_phases p ON p.id=t.phase_id
       WHERE t.goal_id = ? ORDER BY p.phase_number, t.sort`
    )
    .all(g2id)

  // ---- simulate a coherent, realistic week of learning ----
  // day → { goal, topicIndex, confidence, difficulty, minutes, status }
  // statuses: 'done' (completed), 'struggle' (needs_review), 'missed' (skipped day)
  const week = [
    { day: -6, goal: g1id, idx: 0, conf: 4, diff: 'easy', min: 40 },
    { day: -5, goal: g1id, idx: 1, conf: 4, diff: 'medium', min: 45 },
    { day: -4, goal: g1id, idx: 2, conf: 3, diff: 'medium', min: 50 },
    { day: -3, goal: g2id, idx: 0, conf: 4, diff: 'easy', min: 40 },
    { day: -2, goal: g1id, idx: 3, conf: 2, diff: 'hard', min: 40 }, // struggled
    { day: -1, goal: g2id, idx: 1, conf: 4, diff: 'medium', min: 40 },
  ]

  for (const w of week) {
    const topics = w.goal === g1id ? pythonTopics : sqlTopics
    const t = topics[w.idx]
    if (!t) continue
    const d = addDays(now(), w.day)

    // daily plan + tasks for that day
    const planIns = db
      .prepare('INSERT INTO daily_plans (user_id, date, primary_goal_id, topic, objective, estimated_minutes) VALUES (?,?,?,?,?,?)')
      .run(userId, d, w.goal, t.name, `Work through ${t.name}.`, 45)
    const planId = Number(planIns.lastInsertRowid)

    const struggle = w.conf < 3
    const taskDefs = [
      { type: 'learn', title: `${struggle ? 'Reinforce' : 'Learn'}: ${t.name}`, dur: 15, done: true },
      { type: 'practice', title: 'Practice: hands-on exercise', dur: 15, done: true },
      { type: 'build', title: 'Build: apply it', dur: 10, done: !struggle },
      { type: 'test', title: 'Test yourself', dur: 5, done: !struggle },
    ]
    taskDefs.forEach((td, i) => {
      const status = td.done ? 'completed' : 'not_started'
      db.prepare(
        'INSERT INTO tasks (user_id, daily_plan_id, goal_id, topic_id, type, title, description, duration, status, sort) VALUES (?,?,?,?,?,?,?,?,?,?)'
      ).run(userId, planId, w.goal, t.id, td.type, td.title, '', td.dur, status, i)
    })

    // session record (studied even on struggle days)
    db.prepare(
      `INSERT INTO sessions (user_id, date, duration, goal_id, topic_id, topic_name, confidence, difficulty, learned, status, kind)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(userId, d, w.min, w.goal, t.id, t.name, w.conf, w.diff, struggle ? 'Attempted, needs another pass' : `Completed ${t.name}`, 'completed', 'learn')

    if (struggle) {
      db.prepare('UPDATE topics SET status = ? WHERE id = ?').run('needs_review', t.id)
      db.prepare(
        `INSERT INTO revision_schedule (user_id, topic_id, goal_id, topic_name, due_date, interval_days, status, source)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(userId, t.id, w.goal, t.name, addDays(now(), 1), 1, 'pending', 'weak')
    } else {
      db.prepare('UPDATE topics SET status = ? WHERE id = ?').run('completed', t.id)
    }
  }

  // one spaced-revision reminder due today for an earlier-completed topic
  const firstTopic = pythonTopics[0]
  if (firstTopic) {
    db.prepare(
      `INSERT INTO revision_schedule (user_id, topic_id, goal_id, topic_name, due_date, interval_days, status, source)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(userId, firstTopic.id, g1id, firstTopic.name, now(), 7, 'pending', 'spaced')
  }

  // a completed assessment on the REST APIs topic
  const apiTopic = pythonTopics.find((t) => /rest api/i.test(t.name))
  if (apiTopic) {
    db.prepare(
      `INSERT INTO assessments (user_id, goal_id, topic_id, title, kind, questions_json, score, max_score, date, difficulty, completed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(userId, g1id, apiTopic.id, 'Quick Quiz: Working with REST APIs in Python', 'quick', '[]', 4, 5, addDays(now(), -4), 'intermediate', 1)
  }

  // notes
  const apiTopicId = apiTopic?.id || null
  if (apiTopicId) {
    db.prepare(
      `INSERT INTO notes (user_id, goal_id, topic_id, content) VALUES (?,?,?,?)`
    ).run(
      userId,
      g1id,
      apiTopicId,
      `# REST APIs in Python — notes\n\n- ` + '`requests.get()`' + ` for GET, ` + '`requests.post()`' + ` for POST\n- Always check ` + '`response.status_code`' + ` before parsing\n- Use ` + '`raise_for_status()`' + ` to surface HTTP errors\n\n**Key takeaway:** parse JSON with ` + '`response.json()`' + `, wrap calls in try/except.\n\n**Question:** how do I handle pagination?`
    )
  }

  // resources
  db.prepare(
    'INSERT INTO resources (user_id, goal_id, topic_id, title, url, type) VALUES (?,?,?,?,?,?)'
  ).run(userId, g1id, null, 'Automate the Boring Stuff with Python', 'https://automatetheboringstuff.com', 'Book')
  db.prepare(
    'INSERT INTO resources (user_id, goal_id, topic_id, title, url, type) VALUES (?,?,?,?,?,?)'
  ).run(userId, g1id, apiTopicId, 'Real Python — Python & REST APIs', 'https://realpython.com/api-integration-in-python/', 'Documentation')

  recomputeAllProgress()

  // ---- generate today's plan + briefing ----
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  generateDailyPlan(user, now())

  return userId
}
