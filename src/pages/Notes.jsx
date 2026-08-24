import React, { useEffect, useState } from 'react'
import { marked } from 'marked'
import { Save, Sparkles, Layers, FileQuestion, GripHorizontal, GraduationCap } from 'lucide-react'
import { api } from '../api.js'
import { Card, Spinner, Badge } from '../components.jsx'

marked.setOptions({ gfm: true, breaks: true })

const ACTIONS = [
  { key: 'summarize', label: 'Summarize', icon: <Sparkles size={13} /> },
  { key: 'flashcards', label: 'Flashcards', icon: <Layers size={13} /> },
  { key: 'quiz', label: 'Quiz questions', icon: <FileQuestion size={13} /> },
  { key: 'gaps', label: 'Identify gaps', icon: <GraduationCap size={13} /> },
  { key: 'simplify', label: 'Simplify', icon: <GripHorizontal size={13} /> },
]

export default function Notes() {
  const [topics, setTopics] = useState(null)
  const [selected, setSelected] = useState(null)
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState(false)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.goals().then((gs) => {
      Promise.all(gs.map((g) => api.goal(g.id))).then((details) => {
        const all = []
        details.forEach((d) => d.topics.forEach((t) => all.push({ ...t, goalName: d.name, goal_id: d.id })))
        setTopics(all)
        if (all.length) select(all[0])
      })
    })
  }, [])

  const select = async (t) => {
    setSelected(t)
    setResult(null)
    setSaved(false)
    const n = await api.note(t.id)
    setContent(n.content || '')
  }

  const save = async () => {
    if (!selected) return
    await api.saveNote(selected.id, content, selected.goal_id)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const runAction = async (key) => {
    setBusy(true)
    try {
      const r = await api.noteAction(key, content)
      setResult(r)
    } finally {
      setBusy(false)
    }
  }

  if (!topics) return <Spinner />

  return (
    <div className="grid" style={{ gridTemplateColumns: '280px 1fr' }}>
      <div>
        <Card title="Topics" sub="Notes per roadmap topic">
          <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
            {topics.map((t) => (
              <div
                key={t.id}
                onClick={() => select(t)}
                className="small"
                style={{ padding: '9px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 2, background: selected?.id === t.id ? 'var(--surface-2)' : 'transparent' }}
              >
                <div style={{ fontWeight: selected?.id === t.id ? 600 : 400 }}>{t.name}</div>
                <div className="faint" style={{ fontSize: 11 }}>{t.goalName}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div>
        <Card
          title={selected?.name || 'Notes'}
          sub={selected?.goalName}
          actions={
            <div className="flex" style={{ gap: 6 }}>
              {ACTIONS.map((a) => (
                <button key={a.key} className="btn sm ghost" onClick={() => runAction(a.key)} disabled={busy} style={{ gap: 5 }}>
                  {a.icon}{a.label}
                </button>
              ))}
              <button className="btn sm primary" onClick={save}><Save size={13} /> {saved ? 'Saved ✓' : 'Save'}</button>
            </div>
          }
        >
          {selected ? (
            <>
              <textarea
                className="textarea"
                style={{ minHeight: 220, fontFamily: 'var(--mono)', fontSize: 13 }}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={'# Topic notes\n\nWrite in markdown…\n\n- bullet points\n- `code snippets`\n- [links](https://…)'}
              />
              {result && (
                <div className="mt">
                  <div className="flex-between mb">
                    <Badge tone="violet">AI · {result.title}</Badge>
                  </div>
                  <div className="md card" style={{ background: 'var(--bg-2)' }} dangerouslySetInnerHTML={{ __html: marked.parse(result.content || '') }} />
                </div>
              )}
              {content && (
                <div className="mt">
                  <div className="small faint" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Preview</div>
                  <div className="md card" style={{ background: 'var(--bg-2)' }} dangerouslySetInnerHTML={{ __html: marked.parse(content) }} />
                </div>
              )}
            </>
          ) : (
            <div className="muted small">Select a topic to start taking notes.</div>
          )}
        </Card>
      </div>
    </div>
  )
}
