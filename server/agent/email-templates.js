// Professional HTML email templates for the LearnMate notification system.
//
// Every template is rendered from real data captured in the notification's
// metadata (populated by the generators in generators.js). The shared layout
// keeps the emails on-brand and includes a deep link back into the app.

const ACCENT = '#6366f1'
const TEAL = '#22d3ee'

function layout({ title, greeting, body, cta, footerNote }) {
  const btn = cta
    ? `<table role="presentation" style="margin:22px auto 8px;"><tr><td style="border-radius:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6 50%,#22d3ee);padding:12px 26px;">
         <a href="${cta.url}" style="color:#fff;font-weight:700;text-decoration:none;font-size:14px;">${cta.label} →</a>
       </td></tr></table>`
    : ''
  const note = footerNote
    ? `<p style="color:#8b93a7;font-size:12px;margin:18px 0 0;text-align:center;">${footerNote}</p>`
    : ''
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0b0f19;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" bgcolor="#0b0f19" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" style="max-width:600px;width:100%;background:#111827;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
  <tr><td style="background:linear-gradient(135deg,#6366f1,#8b5cf6 50%,#22d3ee);padding:22px 28px;">
    <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:0.3px;">✦ LearnMate</span>
    <span style="color:rgba(255,255,255,0.85);font-size:12px;display:block;margin-top:2px;">Your personal AI learning agent</span>
  </td></tr>
  <tr><td style="padding:26px 30px;color:#e7ecf5;font-size:15px;line-height:1.6;">
    ${greeting ? `<h1 style="font-size:20px;color:#fff;margin:0 0 6px;">${greeting}</h1>` : ''}
    ${title ? `<h2 style="font-size:16px;color:#22d3ee;margin:0 0 16px;">${title}</h2>` : ''}
    ${body}
    ${btn}
    ${note}
  </td></tr>
  <tr><td style="padding:14px 28px;border-top:1px solid rgba(255,255,255,0.08);color:#6b7488;font-size:11px;">
    LearnMate · your data stays in your app · no reply needed
  </td></tr>
</table>
</td></tr></table>
</body></html>`
}

function block(label, value) {
  return `<tr><td style="padding:10px 16px;border-top:1px solid rgba(255,255,255,0.07);color:#8b93a7;font-size:12px;width:140px;">${label}</td>
          <td style="padding:10px 16px;border-top:1px solid rgba(255,255,255,0.07);color:#e7ecf5;font-size:13px;font-weight:600;">${value || '—'}</td></tr>`
}

function checkList(items) {
  return (items || []).map((i) => `<li style="color:#c7d2fe;font-size:13px;margin:4px 0;">✓ ${i}</li>`).join('')
}

const renderers = {
  morning_briefing: (n, user, meta) =>
    layout({
      title: 'Your Learning Plan for Today',
      greeting: `Good morning, ${meta.firstName || user.name.split(' ')[0] || 'there'} 👋`,
      body: `
        <p style="color:#98a2b6;margin:0 0 16px;">Here is your personalized learning plan for today.</p>
        <table role="presentation" width="100%" style="background:#151d30;border-radius:12px;border-collapse:collapse;margin-bottom:18px;">
          ${block('Today\'s Priority', meta.priority)}
          ${block('Today\'s Topic', meta.topic)}
          ${block('Estimated Time', meta.estimatedMinutes ? `${meta.estimatedMinutes} minutes` : null)}
        </table>
        ${meta.tasks && meta.tasks.length ? `<p style="color:#fff;font-weight:700;margin:8px 0;">Today's Tasks</p>
        <ol style="color:#e7ecf5;font-size:13px;margin:0 0 14px 18px;">${meta.tasks.map((t) => `<li>${t.title} — ${t.duration} min</li>`).join('')}</ol>` : ''}
        ${meta.successCriteria && meta.successCriteria.length ? `<p style="color:#fff;font-weight:700;margin:8px 0;">Today's Success Criteria</p>
        <ul style="margin:0 0 14px 0;padding-left:4px;">${checkList(meta.successCriteria)}</ul>` : ''}
        ${meta.progress && meta.progress.length ? `<p style="color:#fff;font-weight:700;margin:8px 0;">Current Progress</p>
        <table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:6px;">${meta.progress.map((p) => `<tr><td style="color:#98a2b6;font-size:13px;padding:3px 0;">${p.name}</td><td align="right" style="color:#22d3ee;font-size:13px;font-weight:700;">${p.pct}%</td></tr>`).join('')}</table>` : ''}
        <p style="color:#e7ecf5;font-size:13px;margin-top:14px;">Current Streak: <b style="color:#fbbf24;">${meta.streak ?? 0} days 🔥</b></p>`,
      cta: meta.url ? { url: meta.url, label: 'Open Learning Dashboard' } : null,
      footerNote: 'This plan was generated from your real goals, roadmap and progress.',
    }),

  weekly_review: (n, user, meta) =>
    layout({
      title: 'Your Weekly Learning Review',
      greeting: `Hi ${meta.firstName || user.name.split(' ')[0] || 'there'},`,
      body: `
        <p style="color:#98a2b6;margin:0 0 16px;">Here's how your learning went this week.</p>
        <table role="presentation" width="100%" style="background:#151d30;border-radius:12px;border-collapse:collapse;margin-bottom:18px;">
          ${block('Learning time', meta.hours ? `${meta.hours}` : null)}
          ${block('Sessions', meta.sessions)}
          ${block('Completion rate', meta.completionRate != null ? `${meta.completionRate}%` : null)}
        </table>
        ${meta.skills && meta.skills.length ? `<p style="color:#fff;font-weight:700;margin:8px 0;">Skills</p>
        <table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:12px;">${meta.skills.map((s) => `<tr><td style="color:#98a2b6;font-size:13px;padding:3px 0;">${s.name}</td><td align="right" style="color:#34d399;font-size:13px;font-weight:700;">+${s.delta}%</td></tr>`).join('')}</table>` : ''}
        ${meta.strongest ? block('Strongest Area', meta.strongest) : ''}
        ${meta.weakest ? block('Needs Attention', meta.weakest) : ''}
        ${meta.completed && meta.completed.length ? `<p style="color:#fff;font-weight:700;margin:8px 0;">Completed</p>
        <ul style="margin:0 0 14px 0;padding-left:4px;">${checkList(meta.completed)}</ul>` : ''}
        ${meta.next && meta.next.length ? `<p style="color:#fff;font-weight:700;margin:8px 0;">Next Week</p>
        <ol style="color:#e7ecf5;font-size:13px;margin:0 0 8px 18px;">${meta.next.map((x) => `<li>${x}</li>`).join('')}</ol>` : ''}
        ${meta.recommendation ? `<p style="color:#98a2b6;font-size:13px;margin-top:10px;">💡 ${meta.recommendation}</p>` : ''}`,
      cta: meta.url ? { url: meta.url, label: 'View Weekly Review' } : null,
    }),

  monthly_review: (n, user, meta) =>
    layout({
      title: 'Your Monthly Learning Report',
      greeting: `Hi ${meta.firstName || user.name.split(' ')[0] || 'there'},`,
      body: `
        <table role="presentation" width="100%" style="background:#151d30;border-radius:12px;border-collapse:collapse;margin-bottom:16px;">
          ${block('Total learning time', meta.totalHours ? `${meta.totalHours}` : null)}
          ${block('Sessions', meta.sessions)}
          ${block('Goals', meta.goalCount)}
          ${block('Projects completed', meta.projectsCompleted?.length || meta.projectsCompleted || 0)}
        </table>
        ${meta.skillsImproved && meta.skillsImproved.length ? `<p style="color:#fff;font-weight:700;margin:8px 0;">Skills Improved</p>
        <table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:12px;">${meta.skillsImproved.map((s) => `<tr><td style="color:#98a2b6;font-size:13px;padding:3px 0;">${s.name}</td><td align="right" style="color:#34d399;font-size:13px;font-weight:700;">+${s.delta}%</td></tr>`).join('')}</table>` : ''}
        ${meta.assessmentScores && meta.assessmentScores.length ? `<p style="color:#fff;font-weight:700;margin:8px 0;">Assessment Scores</p>
        <ul style="color:#e7ecf5;font-size:13px;margin:0 0 12px 18px;">${meta.assessmentScores.map((a) => `<li>${a.title}: ${a.pct}%</li>`).join('')}</ul>` : ''}
        ${meta.strongAreas && meta.strongAreas.length ? `<p style="color:#fff;font-weight:700;margin:8px 0;">Strong Areas</p><p style="color:#34d399;font-size:13px;margin:0 0 10px;">${meta.strongAreas.join(' · ')}</p>` : ''}
        ${meta.weakAreas && meta.weakAreas.length ? `<p style="color:#fff;font-weight:700;margin:8px 0;">Weak Areas</p><p style="color:#f87171;font-size:13px;margin:0 0 10px;">${meta.weakAreas.join(' · ')}</p>` : ''}
        ${meta.consistency != null ? block('Learning consistency', meta.consistency) : ''}
        ${meta.recommendation ? `<p style="color:#22d3ee;font-size:14px;font-weight:700;margin-top:12px;">🎯 ${meta.recommendation}</p>` : ''}`,
      cta: meta.url ? { url: meta.url, label: 'Open Progress' } : null,
    }),

  task_reminder: (n, user, meta) =>
    layout({
      title: 'Your learning task is waiting',
      greeting: `Hi ${meta.firstName || user.name.split(' ')[0] || 'there'} 👋`,
      body: `
        <p style="color:#98a2b6;margin:0 0 14px;">You have a task that hasn't started yet.</p>
        <table role="presentation" width="100%" style="background:#151d30;border-radius:12px;border-collapse:collapse;margin-bottom:14px;">
          ${block('Task', meta.task?.title)}
          ${block('Estimated time', meta.task?.duration ? `${meta.task.duration} minutes` : null)}
          ${block('Status', 'Not started')}
        </table>`,
      cta: meta.url ? { url: meta.url, label: 'Start Learning' } : null,
    }),

  missed_task: (n, user, meta) =>
    layout({
      title: 'A task is still pending',
      greeting: `Hi ${meta.firstName || user.name.split(' ')[0] || 'there'},`,
      body: `
        <p style="color:#98a2b6;margin:0 0 14px;">You haven't completed <b style="color:#e7ecf5;">${meta.task?.title || 'today\'s task'}</b> yet. You can still finish it — no pressure to catch up on everything.</p>
        <table role="presentation" width="100%" style="background:#151d30;border-radius:12px;border-collapse:collapse;margin-bottom:14px;">
          ${block('Recommended', meta.recommendation || 'Complete today')}
        </table>`,
      cta: meta.url ? { url: meta.url, label: 'Reschedule or Start Task' } : null,
    }),

  revision_due: (n, user, meta) =>
    layout({
      title: '🔄 Revision Due',
      greeting: `Hi ${meta.firstName || user.name.split(' ')[0] || 'there'},`,
      body: `
        <p style="color:#98a2b6;margin:0 0 14px;">You learned <b style="color:#e7ecf5;">${meta.topicName || 'a topic'}</b> ${meta.learnedDaysAgo != null ? `${meta.learnedDaysAgo} days ago` : 'recently'}.</p>
        <p style="color:#e7ecf5;font-size:13px;">Take a 5-minute refresher quiz to maintain mastery.</p>`,
      cta: meta.url ? { url: meta.url, label: 'Start Revision' } : null,
    }),

  assessment_ready: (n, user, meta) =>
    layout({
      title: '🧠 Assessment Ready',
      greeting: `Hi ${meta.firstName || user.name.split(' ')[0] || 'there'},`,
      body: `
        <p style="color:#98a2b6;margin:0 0 14px;">You've completed the current module. Your assessment is ready.</p>
        <table role="presentation" width="100%" style="background:#151d30;border-radius:12px;border-collapse:collapse;margin-bottom:14px;">
          ${block('Assessment', meta.assessmentTitle)}
          ${block('Estimated time', meta.estimatedMinutes ? `${meta.estimatedMinutes} minutes` : null)}
        </table>`,
      cta: meta.url ? { url: meta.url, label: 'Start Assessment' } : null,
    }),

  goal_deadline: (n, user, meta) =>
    layout({
      title: '⏰ Goal Deadline',
      greeting: `Hi ${meta.firstName || user.name.split(' ')[0] || 'there'},`,
      body: `
        <p style="color:#98a2b6;margin:0 0 8px;">${meta.daysRemaining == null ? '' : meta.daysRemaining === 0 ? `<b style="color:#f87171;">Your "${meta.goalName}" goal is due today.</b>` : meta.daysRemaining === 1 ? `<b style="color:#fbbf24;">Your "${meta.goalName}" goal is due tomorrow.</b>` : `<b style="color:#fbbf24;">Your "${meta.goalName}" goal has ${meta.daysRemaining} days remaining.</b>`}</p>
        <p style="color:#98a2b6;font-size:13px;margin:0;">Stay on track and make steady progress.</p>`,
      cta: meta.url ? { url: meta.url, label: 'View Goal' } : null,
    }),

  test: (n, user, meta) =>
    layout({
      title: 'Test Notification',
      greeting: `Hi ${meta.firstName || user.name.split(' ')[0] || 'there'} 👋`,
      body: `<p style="color:#98a2b6;">This is a test notification from your AI Learning Agent. If you're reading this, email delivery is working correctly.</p>`,
    }),

  default: (n, user, meta) =>
    layout({
      title: n.title || 'LearnMate notification',
      greeting: `Hi ${meta.firstName || user.name.split(' ')[0] || 'there'},`,
      body: `<p style="color:#e7ecf5;">${n.body || ''}</p>`,
      cta: meta.url ? { url: meta.url, label: 'Open LearnMate' } : null,
    }),
}

export { renderers }
