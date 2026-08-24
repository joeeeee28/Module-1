# LearnMate — Personal AI Learning Agent

A self-hosted, persistent AI learning manager that runs **entirely on your Mac** —
no cloud required. It turns your goals into roadmaps, generates an adaptive daily plan
each morning, tracks sessions, runs assessments, computes real mastery, schedules
spaced revision, and sends your morning briefing.

---

## Prerequisites

| Tool | Required | Version | How to check |
|---|---|---|---|
| Git | Yes | any recent | `git --version` |
| Node.js | Yes | **22 or newer** (built-in SQLite) | `node -v` |
| npm | Yes | ships with Node | `npm -v` |
| Python | No | — | not used |
| PostgreSQL | No | — | SQLite is embedded |
| Docker | Optional | — | only for the container option |

No native compilation is required — the database (SQLite) and all dependencies are
pure JavaScript or built into Node, so it works identically on **Apple Silicon** and
**Intel** Macs.

> If Node is missing or older than 22: `brew install node@22` (or download from nodejs.org).

---

## Installation

### Option A — one-command auto-start service (recommended)

```bash
git clone -b arena/01a0352f-module-1 https://github.com/joeeeee28/Module-1.git learnmate
cd learnmate
./scripts/install-mac.sh
```

This installs dependencies, builds the frontend, and registers LearnMate as a macOS
`launchd` service that **auto-starts on login** and **restarts if it crashes**.

### Option B — run manually

```bash
git clone -b arena/01a0352f-module-1 https://github.com/joeeeee28/Module-1.git learnmate
cd learnmate
npm install
npm run build
npm run start:local
```

### Option C — Docker

```bash
docker build -t learnmate .
docker run -d --name learnmate --restart unless-stopped -p 4000:4000 -v learnmate_data:/app/data learnmate
```

---

## Environment Variables

Copy the template and edit as needed:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | No | HTTP port (default `4000`) |
| `DATABASE_PATH` | No | SQLite file path (default `./data/app.db`) |
| `LOG_LEVEL` / `LOG_DIR` | No | Logging verbosity + output dir |
| `AUTH_SECRET` | No | Optional stable token secret (sessions already persist without it) |
| `SEED_DEMO` | No | `true` creates the demo account (off by default) |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | **Only for real AI model** | Server-side LLM (see below) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | **Only for real AI model** | Alternative provider |
| `SEARCH_API_KEY` / `SEARCH_API_PROVIDER` | **Only for live search** | `tavily` / `brave` / `serp` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | **Only for Telegram** | External notification transport |
| `WEBHOOK_URL` | **Only for webhook** | External notification transport |
| `SMTP_HOST` … `SMTP_FROM` | **Only for email** | External notification transport |
| `ADMIN_TOKEN` | **Only for cron** | Protects the cron endpoint |

**Important:** `.env` is git-ignored. Keys are read server-side only and never reach
the browser.

### Do I need an AI key?

No. LearnMate ships with a **deterministic learning engine** that works with zero keys —
it genuinely computes plans, priorities, mastery, revision, reviews, and coach answers
from your stored data. Setting `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) upgrades the
AI Coach and open-ended answers to a real LLM with your full learning context. Without
a key, nothing is faked — the UI labels every response with its source (`engine` vs `model`).

### AI Coach (chat agent)

The **AI Coach** (`/coach`) is a multi-turn chat agent:

- **Tool-calling layer** (`server/ai/tools.js`) — 20+ server-side tools that read and
  mutate your real data: profile, goals, roadmap, skill mastery, sessions, pending &
  revision tasks, plan generation, task completion/rescheduling, goal creation, quizzes,
  weekly review, weak areas, resource discovery, notes, learning memory, and more.
- **Intent router** (`server/ai/agent.js`) — maps each message to an intent and composes
  an answer from real tool results. It tracks **focus** so pronouns resolve: say
  *"explain my next topic"*, then *"make it harder"* and *"give me another one"* without
  repeating yourself.
- **Conversation persistence** — chats are stored per-user (`conversations` +
  `messages` tables) with a sidebar, history, and per-conversation isolation.
- **Streaming** — `GET /api/chat/stream` streams replies as SSE tokens so the UI renders
  progressively, with stop/retry and message states.
- When a model key is set, open-ended intents (explain, resources, motivation) are
  enriched by the LLM with the same real tool context; otherwise the engine answers.

### Notification System (email + in-app)

LearnMate generates **real notifications from real learning data** and delivers them
through the channels you enable:

- **In-app notifications** — always work. A notification bell in the header polls for
  updates, groups by Today/Earlier, orders by priority, deep-links to the relevant
  screen, and shows read/unread. A **Notification History** page (`/notifications`)
  lets you filter by channel, status, read state and date.
- **Email notifications** — delivered by a real transactional provider:
  `EMAIL_PROVIDER=resend|sendgrid|smtp`. Credentials stay server-side; keys never reach
  the browser. A built-in, dependency-free SMTP client supports `smtp`.
- **Notification Settings** (`/notification-settings`) — per-type toggles for email and
  in-app, notification email address + verification, quiet hours, and a **Send Test
  Email** button that reports real delivery status.
- **Generators** (`server/agent/generators.js`) — morning plan, weekly & monthly
  reviews, task reminders, missed-task AI adaptation (complete / move / split / skip),
  revision-due, assessment-ready, and goal-deadline (14/7/1-day) notifications — all
  computed from the database, never fabricated.
- **Reliability** (`server/agent/notify.js`) — a notification **queue + worker**
  (`email_queue` drained by the scheduler), **idempotency keys** to prevent duplicates
  across restarts, honest status tracking (`queued → sent/failed`; nothing is marked
  delivered unless the provider accepted it), bounded retries (max 3, no spam), and
  **quiet hours** (non-critical email is deferred to the next morning in the user's
  timezone).
- **Chat integration** — the AI Coach can set notifications: *"remind me to study Python
  tomorrow morning"*, *"send me my learning plan by email every morning"*,
  *"stop sending me task reminder emails"* — all write real preference changes.

### Local development (safe email testing)

```bash
# Writes rendered emails to data/logs/email/ instead of sending anything real.
NOTIFICATION_ENV=development EMAIL_PROVIDER=log npm run notifications:test

# Trigger the morning agent manually (generates the plan + notifications).
npm run agent:morning
```

`NOTIFICATION_ENV=production` (the default) requires a real provider. The **Send Test
Email** button and `npm run notifications:test` both verify delivery end-to-end.

---

## Database Setup

There is **no separate database to install**. SQLite runs inside the Node process.

- The schema is created automatically on first start (`server/db.js` → `migrate()`).
- Data lives in **one file**: `data/app.db` (path configurable via `DATABASE_PATH`).
- It persists across restarts, logins, and reboots. **Back it up** by copying that file.

Tables: users, skills, goals, roadmap_phases, topics, daily_plans, tasks, task_logs,
sessions, assessments, resources, notes, reviews, revision_schedule, agent_runs,
learning_memory, projects, notifications, settings.

Seed data is **off by default**. To preview with a sample account, run with
`SEED_DEMO=true` (clearly labelled demo data). The real app operates entirely from
user-created data.

---

## Running the Application

One command starts the frontend, backend, database, and scheduler (all in one process):

```bash
npm run start:local     # build + serve (production-style)
```

- Open **http://localhost:4000** and create your account.
- Development mode (hot reload): `npm run dev` → http://localhost:5173

### Running the AI Agent (scheduler)

The scheduler runs **inside the server process**, so it starts automatically with the
commands above. It wakes every 30 seconds and fires the morning agent at each user's
configured briefing time in their own timezone.

To run a dedicated agent process (same thing, explicit):

```bash
npm run agent
```

> The scheduler requires the server process to stay running. If you installed via
> Option A (`launchd`), it runs continuously in the background.

---

## Testing the Morning Agent

Trigger the full morning pipeline immediately (no waiting until morning):

```bash
npm run agent:morning                 # for the first user
npm run agent:morning -- you@x.com    # for a specific user
```

This loads your profile, goals, roadmap, and history → calculates priorities →
generates and persists today's plan → enriches it with a real resource → sends the
notification. It prints the result and logs every step.

There is also a **"Run morning agent now"** button on the *Agent Activity* screen.

---

## Running Tests

```bash
npm test
```

Uses Node's built-in test runner (no extra install). Three suites:

- `test/app.test.js` — core: authentication, database, goal + roadmap creation, daily
  plan generation, session tracking, adaptive task completion, assessment grading,
  mastery computation, empty-state (no mock data), and agent run history.
- `test/chat.test.js` — AI Coach: greeting, plan generation, topic explanation,
  easier/harder challenges, real task completion (DB write), conversation persistence,
  weak-area detection, roadmap, quiz, weekly review, goal creation, profile, deletion,
  cross-user isolation, and SSE streaming.
- `test/notifications.test.js` — notification system: task creation, plan generation →
  in-app notification, morning email generation + provider acceptance, read/unread,
  deep links, task reminders, task-completion suppression, revision notifications, and
  email-failure handling with the in-app copy intact.

Total: **34 tests**.

---

## Health Check

```
GET http://localhost:4000/health
```

Returns app/database/AI/search/scheduler status plus version and timestamp:

```json
{
  "status": "ok",
  "database": "ok",
  "ai": "deterministic-engine",
  "search": "unavailable",
  "scheduler": "running",
  "version": "2.1.0"
}
```

---

## Notifications

- **In-app inbox** — always works; a bell in the top bar shows unread messages.
- **External transports** (Telegram / webhook / email) activate when their env vars are
  set, and each message records its real delivery status — nothing is marked "delivered"
  unless the transport accepted it.
- For local use without external channels, the in-app inbox is the **notification
  preview** and is always real.

---

## Timezone

Stored per-user (`user.timezone`, auto-detected at signup, editable in **Settings**).
Used for daily plans, morning briefings, reminders, the calendar, deadlines, weekly
reviews, and the scheduler trigger.

---

## Architecture

```
React (Vite) frontend  ──HTTP──►  Express API  ──►  SQLite (node:sqlite)
                                        │
                        ┌───────────────┼──────────────────┐
                   Learning Agent    AI Provider       Scheduler (in-process)
                   (deterministic    (optional LLM)    fires morning agent
                    engine)                            per-user timezone
```

- **Frontend** — React 18 + Vite; 14 screens (Dashboard, Today, Goals, Roadmap, Skills,
  Calendar, Resources, Notes, Assessments, Progress, Coach, Review, Agent Activity,
  Settings).
- **Backend** — Express REST API in `server/`.
- **Database** — SQLite via Node's built-in `node:sqlite` (no native deps, no ORM —
  plain prepared statements).
- **AI** — two layers: the deterministic learning-agent engine (`server/ai/engine.js`,
  always on) + an optional real LLM (`server/ai/provider.js`, OpenAI/Anthropic) with the
  user's live context. Structured as Planner / Coach / Assessor / Progress /
  Accountability / Resource / Review agents.
- **Agent memory** — `server/ai/memory.js` derives persistent memory (strengths,
  weaknesses, struggles, interests, projects) from real sessions and assessments.
- **AI Coach (chat agent)** — `server/ai/tools.js` (20+ tool registry) +
  `server/ai/agent.js` (multi-turn intent router with focus tracking), persistent
  `conversations`/`messages`, and an SSE streaming endpoint.
- **AI Provider** — `server/ai/provider.js` (OpenAI/Anthropic) enriches open-ended
  coach answers with real model output when a key is configured.
- **Scheduler** — `server/agent/scheduler.js` (in-process, catch-up safe) runs the
  morning agent plus the notification checks (revision, deadlines, task reminders,
  missed tasks, weekly/monthly reviews) and drains the email queue; a cron endpoint
  `POST /api/agent/cron/morning` (ADMIN_TOKEN) supports external schedulers.
- **Notification Engine** — `server/agent/notify.js` (queue + idempotency + quiet hours)
  → `server/agent/email.js` (Resend / SendGrid / built-in SMTP / dev log) →
  `server/agent/email-templates.js` (HTML templates) → `server/agent/generators.js`
  (morning, weekly, monthly, task, revision, assessment, deadline, missed-task).

### Honesty guarantees

- No mock data by default — a fresh account shows "No learning activity yet."
  (`SEED_DEMO=true` is the only way to create demo data.)
- Resources are labeled with their source (`pypi` / `npm` / `curated` / `search` /
  `manual`) and verification status — never invented URLs.
- Agent actions are recorded in a real audit log (Agent Activity screen).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `node -v` < 22 | `brew install node@22` |
| Port already in use | `PORT=4001 npm run start:local`, or stop the other process |
| "No user found" from `agent:morning` | Create an account first, then re-run |
| AI Coach looks basic | It's the built-in engine — set an `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` for a real LLM |
| External notifications not sending | Set the matching env var (Telegram/webhook/SMTP); check Agent Activity for the recorded status |
| Live resource discovery says "unavailable" | Normal if the network blocks it — it falls back to saved resources; set `SEARCH_API_KEY` for search |
| Service stopped after reboot | Re-run `./scripts/install-mac.sh` (launchd) or use Docker `--restart unless-stopped` |

---

## Manage the macOS service

```bash
launchctl list | grep learnmate      # check status
launchctl stop com.learnmate         # stop
launchctl start com.learnmate        # start
tail -f data/learnmate.log           # view logs
./scripts/uninstall-mac.sh           # remove the service (keeps data)
```
