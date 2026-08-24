// Manual morning-agent trigger — run the full daily pipeline right now.
//   node scripts/morning.js            # for the first user in the DB
//   node scripts/morning.js you@x.com  # for a specific user
//
// Runs: load profile → goals → roadmap → history → priorities → generate plan
// → persist → enrich (resources/live info) → send notification. Logs the result.

import { config } from '../server/config.js'
import { db, migrate } from '../server/db.js'
import { seedIfEmpty } from '../server/seed.js'
import { runMorningAgent } from '../server/agent/morning.js'

migrate()
if (config.seedDemo) seedIfEmpty()

const email = process.argv[2]
const user = email
  ? db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  : db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get()

if (!user) {
  console.error('✗ No user found. Create an account first (sign up in the app), then re-run.')
  process.exit(1)
}

console.log(`Running morning agent for ${user.name} <${user.email}> (tz: ${user.timezone || 'UTC'})…\n`)

runMorningAgent(user.id, { notify: true })
  .then((result) => {
    const b = result.briefing
    console.log('✅ Morning agent complete')
    console.log(`   Reused today's plan: ${result.skipped ? 'yes' : 'no (generated fresh)'}`)
    console.log(`   Priority goal : ${b.primaryGoal || '—'}`)
    console.log(`   Today's topic  : ${b.topic}`)
    console.log(`   Time           : ${b.estimatedMinutes} min`)
    console.log(`   Plan blocks    : ${(b.plan || []).map((p) => `${p.label} (${p.minutes}m)`).join(' · ')}`)
    console.log(`   Why            : ${b.why || '—'}`)
    console.log(`   Weak area      : ${b.weakArea || 'none'}`)
    console.log(`   Resource       : ${b.recommendedResource ? `${b.recommendedResource.title} [${b.recommendedResource.source}${b.recommendedResource.verified ? ', verified' : ''}]` : 'none'}`)
    console.log(`   Live data      : ${b.liveDataStatus}`)
    console.log(`   Persisted      : plan #${result.plan.id}`)
    process.exit(0)
  })
  .catch((e) => {
    console.error(`✗ Morning agent failed: ${e.message}`)
    process.exit(1)
  })
