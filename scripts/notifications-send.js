// CLI: npm run notifications:test
//
// Sends a real test email + in-app notification to a user through the
// configured email provider, then drains the email queue so the delivery
// result is known immediately. In development (NOTIFICATION_ENV=development,
// EMAIL_PROVIDER=log) the email is written to data/logs/email/ instead of
// being sent — safe for local testing.

import { db, migrate } from '../server/db.js'
import { config, logger, isDevMode, emailConfigured } from '../server/config.js'
import { seedIfEmpty } from '../server/seed.js'
import { processEmailQueue } from '../server/agent/notify.js'
import { notifyTestEmail } from '../server/agent/generators.js'
import { setPreferences } from '../server/agent/preferences.js'

async function main() {
  migrate()
  seedIfEmpty()
  const email = process.argv[2]
  let user
  if (email) {
    user = db.prepare('SELECT * FROM users WHERE email = ? OR notification_email = ?').get(email, email)
  } else {
    user = db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get()
  }
  if (!user) {
    console.error('No user found. Pass an email: npm run notifications:test -- you@example.com')
    process.exit(1)
  }

  const to = user.notification_email || user.email
  if (!isDevMode() && !emailConfigured()) {
    console.error('Email delivery is not configured. Set EMAIL_PROVIDER and credentials, or NOTIFICATION_ENV=development for the log provider.')
    process.exit(1)
  }

  // Ensure email notifications are enabled for this test user.
  setPreferences(user.id, { email: { enabled: true, address: to, verified: isDevMode() ? true : user.email_verified } })

  console.log(`Sending test notification to ${to} (provider=${config.emailProvider}${isDevMode() ? ' dev-log' : ''})`)
  const results = await notifyTestEmail(user)
  const drained = await processEmailQueue()
  // Re-fetch email rows after the drain so status reflects actual delivery.
  const fresh = db
    .prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'test' AND channel = 'email' ORDER BY id DESC LIMIT 1")
    .get(user.id)
  if (fresh?.status === 'failed' || (!isDevMode() && drained === 0)) {
    console.error('✗ Test email delivery FAILED:', fresh?.error || 'queue not drained')
    process.exit(1)
  }
  console.log('✓ In-app notification created')
  console.log(`✓ Test email ${isDevMode() ? 'written to data/logs/email/' : 'accepted by provider'} (${config.emailProvider})`)
  const statuses = results.map((r) => (r.channel === 'email' ? `email:${fresh?.status || r.status}` : `${r.channel}:${r.status}`))
  console.log('Notification status:', statuses.join(', '))
}

main().catch((e) => {
  console.error('notifications:test failed:', e.message)
  process.exit(1)
})
