// Agent run history — records every automated action so the system's behavior
// is observable and auditable ("did the agent actually run?").

import { db } from '../db.js'
import { logger } from '../config.js'

export function logAgentRun(userId, agent, action, detail, status = 'SUCCESS') {
  try {
    db.prepare(
      'INSERT INTO agent_runs (user_id, agent, action, detail, status) VALUES (?,?,?,?,?)'
    ).run(userId ?? null, agent, action, detail ?? null, status)
  } catch (e) {
    logger.error('agent', 'Failed to log agent run', { error: e.message })
  }
}

export function listAgentRuns(userId = null, limit = 100) {
  if (userId) {
    return db
      .prepare('SELECT * FROM agent_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?')
      .all(userId, limit)
  }
  return db.prepare('SELECT * FROM agent_runs ORDER BY id DESC LIMIT ?').all(limit)
}
