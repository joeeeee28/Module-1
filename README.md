# LearnMate — Personal AI Learning Management Agent

A personal AI learning coach, mentor, planner, progress tracker, and accountability
assistant. It turns your learning goals into structured roadmaps, generates an adaptive
daily plan every morning, tracks completion, identifies gaps, and continuously adjusts
your path based on **actual** performance.

Built as a real working application (not a prototype) with persistent storage and a
deterministic learning-agent engine that reasons over your real data.

---

## Quick start

```bash
npm install
npm run build     # build the React frontend into dist/
npm start         # serves the app + API on http://localhost:4000
```

For development with hot reload:

```bash
npm run dev       # Vite dev server (:5173) proxying the API (:4000)
```

**Demo login:** `alex@example.com` / `demo` (seeded with a realistic week of data).

---

## What it does

- **Learning goals** → auto-generated **6-phase roadmap** (Foundation → Intermediate →
  Advanced → Project → Assessment → Mastery). Editable at every level.
- **Daily planner** that analyzes your goals, priorities, deadlines, previous completion,
  missed tasks, weak areas, and available time — and never blindly advances a topic you
  haven't understood.
- **Morning briefing** — a concise, dynamic summary of what to learn today, why, how long,
  what to practice/build, success criteria, yesterday, progress, and your streak.
- **Adaptive learning engine** — scales difficulty up/down, inserts reinforcement for weak
  areas, carries over unfinished work, and reschedules intelligently.
- **Task completion + reflection** — record confidence (1–5), difficulty, actual time,
  notes, and what you learned.
- **Assessments** — quick quizzes, concept tests, practical / debugging / scenario
  challenges. Scores feed directly into mastery.
- **Skill mastery engine** — weighted across lessons, exercises, assessment scores,
  projects, confidence, and recency.
- **Spaced revision** — automatic 1 / 3 / 7 / 14 / 30-day reviews; weak topics come back
  earlier.
- **AI Coach** — context-aware chat that uses your real goals, roadmap, and history
  (explain concepts, quiz you, suggest projects, review your week, etc.).
- **Weekly & monthly reviews**, a learning **calendar**, **resources**, **markdown notes**
  with AI actions (summarize, flashcards, quiz questions, gap detection, simplify).
- **Premium dashboard** with KPIs, skill matrix, weekly progress, and upcoming items.

---

## Architecture

```
React (Vite) + Express + SQLite (node:sqlite)
```

The "AI" is a deterministic **learning-agent engine** (`server/ai/engine.js`) — a set of
logical agents (Planner, Coach, Assessor, Progress, Accountability, Resource, Review) that
genuinely compute decisions from stored data. No external LLM or API key required, so every
action is real and reproducible.

```
server/
  db.js          schema + persistence (SQLite, no native deps)
  seed.js        demo profile + a realistic week of learning history
  index.js       Express API (auth, goals, plans, assessments, coach, …)
  ai/
    catalog.js   curated skill catalog + generic roadmap generator
    engine.js    roadmap / planner / adaptive / mastery / revision / reviews / coach
src/
  App.jsx        auth + layout + navigation
  pages/         13 screens (Dashboard, Today, Goals, Roadmap, Skills, …)
  api.js         client
  styles.css     design system
```

### The daily loop it supports

Create user → create goal → generate roadmap → generate today's plan → complete task →
record confidence → take assessment → update mastery → adapt roadmap → generate next day's
plan → weekly review → morning briefing.

All learning history is persisted, so the agent becomes more useful over time.

---

## Deploy

Deployment configs are included for one-click/self-host:

- **Render.com** — push the repo and connect via *New → Blueprint* (`render.yaml` is
  configured with a persistent disk for the SQLite data).
- **Fly.io** — `fly launch --name learnmate --no-deploy && fly volumes create learnmate_data --size 1 && fly deploy`
- **Docker** — `docker build -t learnmate . && docker run -p 4000:4000 -v learnmate_data:/app/data learnmate`
- **Generic Node host** — `npm ci && npm run build && node server/index.js`

Set `PORT` to change the listen port (default `4000`). Keep the `data/` directory on a
persistent volume so learning history survives redeploys.

