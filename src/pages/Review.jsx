import React, { useEffect, useState } from 'react'
import { RefreshCw, CalendarCheck, Award, TrendingUp, TrendingDown, Lightbulb } from 'lucide-react'
import { api } from '../api.js'
import { Card, Badge, Spinner, Empty } from '../components.jsx'

export default function Review() {
  const [reviews, setReviews] = useState(null)
  const [busy, setBusy] = useState(false)
  const [lastResult, setLastResult] = useState(null)

  const load = () => api.reviews().then(setReviews)
  useEffect(() => { load() }, [])

  const generate = async (period) => {
    setBusy(true)
    try {
      const r = await api.generateReview(period)
      setLastResult(r)
      load()
    } finally {
      setBusy(false)
    }
  }

  if (!reviews) return <Spinner />

  const latest = lastResult?.summary || reviews[0]?.summary

  return (
    <div>
      <div className="flex-between mb">
        <div>
          <h2 className="section-title">Learning Reviews</h2>
          <p className="muted small" style={{ margin: '-8px 0 0' }}>AI-generated analysis of your actual learning data.</p>
        </div>
        <div className="flex">
          <button className="btn" onClick={() => generate('weekly')} disabled={busy}>
            <RefreshCw size={15} className={busy ? 'spin' : ''} /> Weekly review
          </button>
          <button className="btn primary" onClick={() => generate('monthly')} disabled={busy}>
            <CalendarCheck size={15} /> Monthly review
          </button>
        </div>
      </div>

      {!latest && <Empty icon="📊" text="No reviews yet — generate one above." />}

      {latest && (
        <>
          <div className="grid cols-4 mb">
            <KPI icon={<CalendarCheck size={18} />} value={latest.completedSessions} label="Sessions completed" />
            <KPI icon={<TrendingUp size={18} />} value={latest.learningHours} unit="h" label="Learning time" />
            <KPI icon={<Award size={18} />} value={latest.completionRate} unit="%" label="Completion rate" />
            <KPI icon={<TrendingDown size={18} />} value={latest.missed || 0} label="Missed sessions" />
          </div>

          <div className="grid cols-2 mb">
            <Card title="Strongest area" sub="Highest confidence">
              <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
                <TrendingUp size={22} style={{ color: 'var(--green)' }} />
                <span style={{ fontSize: 17, fontWeight: 700 }}>{latest.strongest}</span>
              </div>
            </Card>
            <Card title="Weakest area" sub="Needs attention">
              <div className="flex" style={{ gap: 10, alignItems: 'center' }}>
                <TrendingDown size={22} style={{ color: 'var(--red)' }} />
                <span style={{ fontSize: 17, fontWeight: 700 }}>{latest.weakest}</span>
              </div>
            </Card>
          </div>

          <Card title="Achievement" sub="Your biggest win this period">
            <div className="flex" style={{ gap: 10 }}>
              <Award size={22} style={{ color: 'var(--amber)' }} />
              <span>{latest.biggestAchievement}</span>
            </div>
          </Card>

          <Card className="mt" title="Recommendation" sub="What to do next">
            <div className="flex" style={{ gap: 10, alignItems: 'flex-start' }}>
              <Lightbulb size={20} style={{ color: 'var(--accent-3)' }} />
              <span>{latest.recommendation}</span>
            </div>
          </Card>

          {lastResult?.next?.length > 0 && (
            <Card className="mt" title="Next week plan">
              {lastResult.next.map((n, i) => (
                <div key={i} className="small flex" style={{ padding: '5px 0' }}>
                  <Badge tone="blue">{i + 1}</Badge> {n}
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {reviews.length > 1 && (
        <Card className="mt" title="History">
          {reviews.slice(1).map((r) => (
            <div key={r.id} className="flex-between small" style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ textTransform: 'capitalize' }}>{r.period} review · {r.period_start}</span>
              <span className="faint">{r.summary.completedSessions} sessions · {r.summary.completionRate}%</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function KPI({ icon, value, unit, label }) {
  return (
    <div className="card kpi">
      <div className="icon">{icon}</div>
      <div className="val">{value}{unit && <span className="unit"> {unit}</span>}</div>
      <div className="lbl">{label}</div>
    </div>
  )
}
