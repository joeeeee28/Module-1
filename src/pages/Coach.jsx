import React, { useEffect, useRef, useState, useCallback } from 'react'
import { marked } from 'marked'
import { Send, Sparkles, Plus, Trash2, MessageSquare, Square, RotateCw } from 'lucide-react'
import { api, getToken } from '../api.js'

const SUGGESTIONS = [
  'What should I learn today?',
  'What am I weak at?',
  'Quiz me',
  'Explain my next topic',
  'Review my week',
  'Create a goal: become proficient in SQL',
  'Give me a harder exercise',
  'Show me my roadmap',
]

function md(text) {
  try {
    return marked.parse(text || '')
  } catch {
    return text || ''
  }
}

export default function Coach() {
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([
    { role: 'ai', content: "Hi! I'm your learning coach. I work from your **real** goals, roadmap and history — not generic knowledge. What do you need?", state: 'done' },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const logRef = useRef(null)
  const abortRef = useRef(null)

  const loadConversations = useCallback(async () => {
    try {
      const rows = await api.chatConversations()
      setConversations(rows || [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const openConversation = async (id) => {
    if (id === activeId) return
    setActiveId(id)
    setMessages([{ role: 'ai', content: 'Loading conversation…', state: 'sending' }])
    try {
      const data = await api.chatConversation(id)
      const msgs = (data.messages || []).map((m) => ({
        role: m.role === 'user' ? 'user' : 'ai',
        content: m.content || '',
        state: 'done',
      }))
      setMessages(msgs.length ? msgs : [{ role: 'ai', content: 'Start chatting below 👇', state: 'done' }])
    } catch {
      setMessages([{ role: 'ai', content: 'Could not load this conversation.', state: 'error' }])
    }
  }

  const newConversation = () => {
    if (busy) return
    setActiveId(null)
    setMessages([{ role: 'ai', content: "Hi! What shall we work on today?", state: 'done' }])
    setInput('')
  }

  const deleteConversation = async (id, e) => {
    e.stopPropagation()
    if (busy) return
    await api.deleteChatConversation(id)
    if (id === activeId) newConversation()
    loadConversations()
  }

  const stop = () => {
    abortRef.current?.abort()
    setMessages((m) => {
      const copy = [...m]
      if (copy.length && copy[copy.length - 1].state === 'streaming') {
        copy[copy.length - 1] = { ...copy[copy.length - 1], state: 'done' }
      }
      return copy
    })
    setBusy(false)
  }

  const send = async (text) => {
    const msg = (text || input).trim()
    if (!msg || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: msg, state: 'done' }])
    setMessages((m) => [...m, { role: 'ai', content: '', state: 'streaming' }])
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch(api.chatStreamUrl(activeId, msg), {
        headers: { Authorization: `Bearer ${getToken()}` },
        signal: controller.signal,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const patchLast = (fn) =>
        setMessages((m) => {
          const copy = [...m]
          const idx = copy.length - 1
          copy[idx] = fn(copy[idx])
          return copy
        })
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop()
        for (const evt of events) {
          if (!evt.startsWith('data: ')) continue
          let data
          try {
            data = JSON.parse(evt.slice(6))
          } catch {
            continue
          }
          if (data.delta) {
            patchLast((cur) => ({ ...cur, content: (cur.content || '') + data.delta, state: 'streaming' }))
          } else if (data.error) {
            throw new Error(data.error)
          } else if (data.meta) {
            setActiveId(data.meta.conversation.id)
            setMessages((data.meta.messages || []).map((mm) => ({ role: mm.role === 'user' ? 'user' : 'ai', content: mm.content || '', state: 'done' })))
            loadConversations()
          }
        }
      }
      patchLast((cur) => ({ ...cur, state: 'done' }))
    } catch (e) {
      if (e.name !== 'AbortError') {
        setMessages((m) => {
          const copy = [...m]
          copy[copy.length - 1] = { role: 'ai', content: 'Sorry, something went wrong: ' + e.message, state: 'error' }
          return copy
        })
      }
    } finally {
      setBusy(false)
    }
  }

  const retry = () => {
    if (busy) return
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const last = messages[messages.length - 1]
    if (last?.role === 'ai' && (last.state === 'error' || last.state === 'done')) {
      setMessages((m) => m.slice(0, -1))
    }
    if (lastUser) send(lastUser.content)
  }

  const hasFailed = messages[messages.length - 1]?.role === 'ai' && messages[messages.length - 1]?.state === 'error'

  return (
    <div className="coach-wrap">
      <div className="chat-sidebar">
        <div className="chat-sidebar-head">
          <button className="btn primary w100" onClick={newConversation} disabled={busy}>
            <Plus size={15} /> New chat
          </button>
        </div>
        <div className="chat-conv-list">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`conv-item ${c.id === activeId ? 'active' : ''}`}
              onClick={() => !busy && openConversation(c.id)}
            >
              <MessageSquare size={14} />
              <span className="conv-title">{c.title || 'New chat'}</span>
              <button className="conv-del" onClick={(e) => deleteConversation(c.id, e)} title="Delete conversation">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {!conversations.length && <div className="small faint" style={{ padding: '12px' }}>No conversations yet</div>}
        </div>
      </div>

      <div className="chat">
        <div className="chat-log" ref={logRef}>
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.role === 'ai' && (
                <div className="who">
                  <Sparkles size={13} /> LearnMate Coach
                </div>
              )}
              <div className="md" dangerouslySetInnerHTML={{ __html: md(m.content) }} />
              {m.role === 'ai' && m.state === 'streaming' && <div className="small faint typing">▍</div>}
            </div>
          ))}
        </div>

        <div>
          {hasFailed && (
            <div className="chat-retry">
              <button className="btn" onClick={retry}>
                <RotateCw size={14} /> Retry
              </button>
            </div>
          )}
          <div className="mt">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" onClick={() => send(s)} disabled={busy}>
                {s}
              </button>
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
            {busy ? (
              <button className="btn" onClick={stop}>
                <Square size={15} /> Stop
              </button>
            ) : (
              <button className="btn primary" onClick={() => send()} disabled={!input.trim()}>
                <Send size={15} /> Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
