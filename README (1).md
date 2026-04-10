# Agentic MCP Gateway

An AI-powered orchestration layer that connects to multiple third-party services via MCP servers, understands natural language workflow descriptions, decomposes them into DAGs of MCP tool calls, and executes them reliably with full observability, approvals, error recovery, and a learning agent.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (JSX) + Vite |
| Backend API | Node.js (Express) |
| AI / MCP Orchestration | Python (FastAPI) |
| Database | Supabase (Postgres + Auth + Realtime) |
| Real-time | WebSockets (FastAPI → React) |
| Integrations | MCP Servers: Jira/Trello, Slack, Sheets/SQL, GitHub |

---

## Repository Structure

```
agentic-mcp-gateway/
├── README.md
├── .gitignore
│
├── backend/                    # Node.js Express API
│   ├── .env                    # ← copy from .env.example, never commit
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── server.js
│       ├── supabaseClient.js
│       └── routes/
│           ├── workflows.js
│           ├── approvals.js
│           └── logs.js
│
├── orchestrator/               # Python FastAPI (MCP + AI agents)
│   ├── .env                    # ← copy from .env.example, never commit
│   ├── .env.example
│   ├── requirements.txt
│   └── app.py
│
├── frontend/                   # React (JSX) + Vite
│   ├── .env.local              # ← copy from .env.local.example, never commit
│   ├── .env.local.example
│   ├── package.json
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       └── components/
│           ├── WorkflowBuilder.jsx
│           ├── RunDashboard.jsx
│           └── ApprovalsPanel.jsx
│
└── docs/
    ├── ARCHITECTURE.md
    ├── DATABASE_SCHEMA.md
    └── SECURITY_MODEL.md
```

---

## Quick Start

### 1. Clone & set up env files

```bash
cp backend/.env.example       backend/.env
cp orchestrator/.env.example  orchestrator/.env
cp frontend/.env.local.example frontend/.env.local
```

Fill in your actual Supabase URL, keys, and MCP tokens in each `.env` file.

### 2. Backend (Node.js)

```bash
cd backend
npm install
npm run dev       # starts on http://localhost:4000
```

### 3. Orchestrator (Python)

```bash
cd orchestrator
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

### 4. Frontend (React)

```bash
cd frontend
npm install
npm run dev       # starts on http://localhost:5173
```

---

## Unique Features

1. **Visual Workflow Builder** — drag-and-drop DAG editor in React.
2. **Smart Error Recovery** — auto-retry with exponential backoff + LLM fix suggestions.
3. **Learning Agent** — mines Supabase logs to improve future workflow plans over time.
4. **Multi-Agent Architecture** — Planner, Executor, Monitor, and Learning agents.
5. **Real-Time Dashboard** — WebSocket live stream of step status and logs.
6. **Dry-Run / Simulation Mode** — test workflows safely without calling real APIs.
7. **Versioned Workflows** — every DAG change is versioned; rollback anytime.
8. **RBAC via Supabase Auth** — Admin, DevOps, On-call, Viewer roles with RLS policies.
9. **Policy Engine** — JSON policies for time-window restrictions, PII safety, and env guards.
10. **Full Audit Log** — every MCP call, approval, and retry stored in Supabase for compliance.

