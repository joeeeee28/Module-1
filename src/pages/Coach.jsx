import React, { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import { Send, Sparkles } from 'lucide-react'
import { api } from '../api.js'
import { Spinner } from '../components.jsx'

const SUGGESTIONS = [
  'What should I learn next?',
  'Quiz me on Python',
  "I don't understand REST APIs",
  'Give me a real-world example',
  'Why am I learning this?',
  'Review what I learned this week',
  'Give me a harder exercise',
  'Create a project using everything I learned',
]

export default function Coach() {
  const [messages, setMessages] = useState([
    { role: 'ai', text: "Hi! I'm your learning coach. I use your real goals, roadmap and progress to help you. What would you like help with?" },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async (text) => {
    const msg = text || input
    if (!msg.trim() || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', text: msg }])
    setBusy(true)
    try {
      const r = await api.coach(msg)
      setMessages((m) => [...m, { role: 'ai', text: r.text, type: r.type }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'ai', text: 'Sorry, something went wrong: ' + e.message }])
    }
    setBusy(false)
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === 'ai' && (
              <div className="who"><Sparkles size={13} /> LearnMate Coach</div>
            )}
            <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(m.text) }} />
          </div>
        ))}
        {busy && <div className="msg ai"><div className="who"><Sparkles size={13} /> LearnMate Coach</div>Thinking…</div>}
      </div>

      <div>
        <div className="mt">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>
          ))}
        </div>
        <div className="chat-input">
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Ask about a concept, get quizzed, plan your next step…"
          />
          <button className="btn primary" onClick={() => send()} disabled={busy}>
            <Send size={15} /> Send
          </button>
        </div>
      </div>
    </div>
  )
}
