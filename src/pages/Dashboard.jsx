import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Flame, Clock, Layers, CheckCircle2, Gauge, Target, ArrowRight, BookOpen, Wrench, Hammer, HelpCircle, RotateCcw, CalendarClock, Flag, GraduationCap } from 'lucide-react'
import { api } from '../api.js'
import { Card, Kpi, Bar, ProgressRow, Badge, Spinner, levelColor } from '../components.jsx'

const blockIcon = { learn: <BookOpen size={15} />, practice: <Wrench size={15} />, build: <Hammer size={15} />, test: <HelpCircle size={15} />, revise: <RotateCcw size={15} /> }

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.dashboard().then(setData).catch((e) => setErr(e.message))
  }, [])

  if (err) return <div className="muted">{err}</div>
  if (!data) return <Spinner />

  const { user, today, kpis, goals, skills, weekly, upcoming } = data
  const b = today.briefing
  const todayPct = today.total ? Math.round((today.done / today.total) * 100) : 0

  if (goals.length === 0 && skills.length === 0) {
    return (
      <div className="empty" style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="icon">👋</div>
        <div style={{ fontWeight: 700, fontSize: 17 }}>Welcome, {user.name.split(' ')[0]}!</div>
        <div className="muted small mt" style={{ marginTop: 8 }}>
          No learning data yet — the agent will build everything from scratch as you add goals.
        </div>
        <div className="mt">
          <Link to="/goals" className="btn primary"><Target size={15} /> Create your first learning goal</Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb">
        <h2 style={{ margin: 0, fontSize: 26, letterSpacing: '-0.03em' }}>{b?.greeting || `Good morning, ${user.name.split(' ')[0]} 👋`}</h2>
        <div className="muted small" style={{ marginTop: 6 }}>
          Today's learning progress — <b style={{ color: 'var(--text)' }}>{today.done} / {today.total} tasks</b> completed
        </div>
      </div>

      <div className="mb">
        <Bar value={todayPct} />
      </div>

      {/* KPIs */}
      <div className="grid cols-3 mb" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <Kpi icon={<Flame size={19} />} value={kpis.streak} unit="days" label="Current Streak" />
        <Kpi icon={<Clock size={19} />} value={kpis.learningHours} unit="hrs" label="Learning Hours" />
        <Kpi icon={<Layers size={19} />} value={kpis.skillsInProgress} label="Skills in Progress" />
        <Kpi icon={<CheckCircle2 size={19} />} value={kpis.completionRate} unit="%" label="Completion Rate" />
        <Kpi icon={<Gauge size={19} />} value={kpis.masteryScore} unit="%" label="Mastery Score" />
        <Kpi icon={<Target size={19} />} value={kpis.activeGoals} label="Active Goals" />
      </div>

      <div className="grid cols-2 mb" style={{ gridTemplateColumns: '1.35fr 1fr' }}>
        {/* Today's mission */}
        <Card
          title="Today's Mission"
          sub={`${b?.topic || 'Learning'} · ${b?.estimatedMinutes || 45} min estimated`}
          actions={<Link to="/today" className="btn sm">Open plan <ArrowRight size={14} /></Link>}
        >
          {b?.plan?.length ? (
            <div>
              {b.plan.map((block) => (
                <div key={block.type} className="flex" style={{ alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="badge gray" style={{ gap: 6 }}>{blockIcon[block.type]}{block.label}</span>
                  <div style={{ flex: 1 }}>
                    {block.items.map((it, i) => (
                      <div key={i} className="small" style={{ color: 'var(--text)' }}>• {it}</div>
                    ))}
                  </div>
                  <span className="mono small faint">{block.minutes}m</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted small">No plan yet — generate one from Today's Learning.</div>
          )}

          {b?.successCriteria?.length > 0 && (
            <div className="mt">
              <div className="small faint" style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Success criteria</div>
              {b.successCriteria.map((s, i) => (
                <div key={i} className="small flex" style={{ gap: 8, marginBottom: 4 }}>
                  <CheckCircle2 size={14} style={{ color: 'var(--green)' }} /> {s}
                </div>
              ))}
            </div>
          )}

          {b?.why && (
            <div className="mt small muted"><b style={{ color: 'var(--text)' }}>Why this matters:</b> {b.why}</div>
          )}
          {b?.weakArea && (
            <div className="mt small muted"><b style={{ color: 'var(--amber)' }}>Weak area to watch:</b> {b.weakArea}</div>
          )}
          {b?.recommendedResource && (
            <div className="mt small" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)' }}>
              <div className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Recommended resource</div>
              <a href={b.recommendedResource.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: 'var(--accent-3)' }}>
                {b.recommendedResource.title} ↗
              </a>
              <span className="faint" style={{ marginLeft: 8, fontSize: 11 }}>
                ({b.recommendedResource.source}{b.recommendedResource.verified ? ' · verified' : ' · not verified'})
              </span>
            </div>
          )}
        </Card>

        {/* Weekly progress */}
        <Card title="Weekly Progress" sub="Last 7 days">
          <div className="grid cols-2" style={{ marginBottom: 14 }}>
            <div>
              <div className="faint small">Planned</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{weekly.plannedHours}h</div>
            </div>
            <div>
              <div className="faint small">Actual</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{weekly.actualHours}h</div>
            </div>
            <div>
              <div className="faint small">Completion</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{weekly.completion}%</div>
            </div>
            <div>
              <div className="faint small">Assessment</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{weekly.assessmentScore != null ? weekly.assessmentScore + '%' : '—'}</div>
            </div>
          </div>
          <div className="divider" />
          <div className="small faint" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Upcoming</div>
          {upcoming.slice(0, 4).map((u, i) => (
            <div key={i} className="flex" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              {u.type === 'deadline' ? <Flag size={14} style={{ color: 'var(--red)' }} /> : u.type === 'revision' ? <RotateCcw size={14} style={{ color: 'var(--amber)' }} /> : <CalendarClock size={14} style={{ color: 'var(--accent-3)' }} />}
              <span className="small" style={{ flex: 1 }}>{u.title}</span>
              <span className="mono small faint">{u.date}</span>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid cols-2 mb" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Goals */}
        <Card title="Current Learning Goals" actions={<Link to="/goals" className="btn ghost sm">View all</Link>}>
          {goals.length ? (
            goals.map((g) => (
              <div key={g.id} style={{ marginBottom: 14 }}>
                <div className="flex-between" style={{ marginBottom: 6 }}>
                  <Link to={`/goals/${g.id}`} className="small" style={{ fontWeight: 600 }}>{g.name}</Link>
                  <Badge tone={g.priority === 'High' ? 'red' : g.priority === 'Medium' ? 'amber' : 'gray'}>{g.priority}</Badge>
                </div>
                <ProgressRow name="" value={g.progress} />
              </div>
            ))
          ) : (
            <div className="muted small">No active goals. <Link to="/goals" style={{ color: 'var(--accent-3)' }}>Create one →</Link></div>
          )}
        </Card>

        {/* Skill matrix */}
        <Card title="Skill Matrix" actions={<Link to="/skills" className="btn ghost sm">Manage</Link>}>
          <table className="table">
            <thead>
              <tr><th>Skill</th><th>Level</th><th>Target</th><th>Progress</th></tr>
            </thead>
            <tbody>
              {skills.slice(0, 6).map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td><span className="badge" style={{ color: levelColor(s.current_level), borderColor: 'transparent', background: 'transparent', padding: 0 }}>{s.current_level}</span></td>
                  <td className="faint">{s.target_level}</td>
                  <td>
                    <div className="flex" style={{ gap: 8 }}>
                      <div style={{ width: 80 }}><Bar value={s.current_mastery} thin /></div>
                      <span className="mono small faint">{Math.round(s.current_mastery)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Yesterday */}
      {b?.yesterday && (
        <Card title="Yesterday" sub="Your last session">
          <div className="flex" style={{ gap: 10 }}>
            {b.yesterday.completed ? (
              <CheckCircle2 size={18} style={{ color: 'var(--green)' }} />
            ) : (
              <Clock size={18} style={{ color: 'var(--amber)' }} />
            )}
            <span>{b.yesterday.topic}</span>
            <Badge tone={b.yesterday.completed ? 'green' : 'amber'}>{b.yesterday.completed ? 'Completed' : `${b.yesterday.done}/${b.yesterday.total} done`}</Badge>
          </div>
        </Card>
      )}
    </div>
  )
}
