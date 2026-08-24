// Persistent learning memory.
// The agent derives structured memories from real activity (sessions,
// assessments, topics) and can also store explicit user input. These feed
// future planning and coaching decisions.

import { db } from '../db.js'
import { logger } from '../config.js'

export function recordMemory(userId, category, content, source = 'derived') {
  const existing = db
    .prepare('SELECT id FROM learning_memory WHERE user_id = ? AND category = ? AND content = ?')
    .get(userId, category, content)
  if (existing) {
    db.prepare("UPDATE learning_memory SET updated_at = datetime('now') WHERE id = ?").run(existing.id)
    return existing.id
  }
  const ins = db
    .prepare('INSERT INTO learning_memory (user_id, category, content, source) VALUES (?,?,?,?)')
    .run(userId, category, content, source)
  return Number(ins.lastInsertRowid)
}

export function getMemory(userId, category = null) {
  if (category) {
    return db
      .prepare('SELECT * FROM learning_memory WHERE user_id = ? AND category = ? ORDER BY updated_at DESC')
      .all(userId, category)
  }
  return db.prepare('SELECT * FROM learning_memory WHERE user_id = ? ORDER BY updated_at DESC').all(userId)
}

// Analyze real activity and upsert derived memories. Called after completions
// and assessments so the agent genuinely "remembers" what happened.
export function deriveMemory(userId) {
  // strengths: topics completed recently with confidence >= 4
  const strong = db
    .prepare(
      `SELECT topic_name, COUNT(*) n, AVG(confidence) conf FROM sessions
       WHERE user_id = ? AND status='completed' AND confidence >= 4
       GROUP BY topic_name ORDER BY n DESC LIMIT 5`
    )
    .all(userId)
  for (const s of strong) {
    if (s.topic_name) recordMemory(userId, 'strength', s.topic_name, 'derived')
  }

  // weaknesses: low-confidence sessions or needs_review topics
  const weak = db
    .prepare(
      `SELECT topic_name, AVG(confidence) conf FROM sessions
       WHERE user_id = ? AND status='completed' AND confidence <= 2
       GROUP BY topic_name ORDER BY conf ASC LIMIT 5`
    )
    .all(userId)
  for (const w of weak) {
    if (w.topic_name) recordMemory(userId, 'weakness', w.topic_name, 'derived')
  }
  const needsReview = db
    .prepare(`SELECT name FROM topics WHERE status='needs_review' AND goal_id IN (SELECT id FROM goals WHERE user_id=?)`)
    .all(userId)
  for (const t of needsReview) recordMemory(userId, 'struggle', t.name, 'derived')

  // low assessment scores → struggles
  const lowAssess = db
    .prepare(
      `SELECT a.title, a.score, a.max_score FROM assessments a
       WHERE a.user_id = ? AND a.completed=1 AND (a.score*1.0/a.max_score) < 0.6`
    )
    .all(userId)
  for (const a of lowAssess) {
    recordMemory(userId, 'struggle', a.title, 'derived')
  }

  // projects completed
  const projects = db
    .prepare(
      `SELECT name FROM topics WHERE status='completed' AND (name LIKE '%Capstone%' OR name LIKE '%Project%')
       AND goal_id IN (SELECT id FROM goals WHERE user_id=?)`
    )
    .all(userId)
  for (const p of projects) recordMemory(userId, 'project', p.name, 'derived')

  logger.debug('memory', 'Derived memory for user', { userId, count: getMemory(userId).length })
}

// Compose a compact memory summary for AI context / coaching.
export function memorySummary(userId) {
  const mem = getMemory(userId)
  const by = {}
  for (const m of mem) (by[m.category] = by[m.category] || []).push(m.content)
  const pick = (c) => (by[c] ? [...new Set(by[c])].slice(0, 5).join(', ') : null)
  return {
    strengths: pick('strength'),
    weaknesses: pick('weakness'),
    struggles: pick('struggle'),
    interests: pick('interest'),
    projects: pick('project'),
    methods: pick('method'),
    count: mem.length,
  }
}
