# Architecture — Agentic MCP Gateway

## Component Overview

```
React Frontend
     │  REST + WebSocket
     ▼
Node.js Backend (Express)
     │  REST (proxy to Python)    ↕  Supabase JS Client
     ▼                                     │
Python Orchestrator (FastAPI)              │
     │  MCP JSON-RPC              ↕  Supabase Python Client
     ▼
MCP Servers (Jira | Slack | Sheets | GitHub)
```

---

## Data Flow — Workflow Execution

1. **User describes a workflow** in natural language via the React Visual Builder.
2. React calls `POST /api/workflows/plan` (Node.js backend).
3. Node.js proxies to Python `/plan` with the NL description + available connector metadata.
4. **Planner Agent** (Python, LLM-backed) returns a DAG: nodes = MCP tool calls, edges = data dependencies.
5. React renders the DAG visually; user can edit nodes, add approval gates, and configure retry policies.
6. User clicks **Run** → React calls `POST /api/workflows/:id/execute`.
7. Node.js creates a `workflow_runs` row in Supabase, then calls Python `/execute`.
8. **Executor Agent** resolves topological order, runs parallel steps where safe, and calls MCP servers via the unified MCP client.
9. **Monitor Agent** streams real-time updates to React via WebSocket `/ws/runs/{run_id}`.
10. On **approval gates** — Executor pauses, writes `pending` to `approvals` table; user approves or rejects via React `ApprovalsPanel`; Node notifies Python to resume/abort.
11. **Learning Agent** runs periodically, scans `run_logs` for high-failure nodes, and surfaces suggestions stored in `workflow_suggestions`.

---

## Multi-Agent Architecture

| Agent | Responsibility |
|---|---|
| **Planner Agent** | Converts NL description → validated DAG of MCP tool calls |
| **Executor Agent** | Runs DAG in topological order, retries, handles approvals |
| **Monitor Agent** | Streams live step status + logs via WebSocket |
| **Learning Agent** | Mines past runs, suggests workflow improvements |

---

## MCP Server Integrations

All integrations speak MCP (JSON-RPC 2.0 over HTTP+SSE or stdio) as per the spec.

| Category | Service | MCP Server Env Var |
|---|---|---|
| Project Management | Jira / Trello | `JIRA_MCP_TOKEN` |
| Communication | Slack | `SLACK_MCP_TOKEN` |
| Data / Analytics | Google Sheets or SQL DB | `SHEETS_MCP_TOKEN` |
| Cloud / DevOps | GitHub | `GITHUB_MCP_TOKEN` |

The `call_mcp_tool()` function in `orchestrator/app.py` reads MCP server config from `mcp_servers.json` (or `os.environ`) and routes tool calls accordingly.

---

## Example MCP Servers Config

```jsonc
// orchestrator/mcp_servers.json
{
  "jira-server": {
    "transport": "http+sse",
    "baseUrl": "https://mcp-jira.your-domain.com",
    "credentials_env": "JIRA_MCP_TOKEN"
  },
  "slack-server": {
    "transport": "http+sse",
    "baseUrl": "https://mcp-slack.your-domain.com",
    "credentials_env": "SLACK_MCP_TOKEN"
  },
  "sheets-server": {
    "transport": "http+sse",
    "baseUrl": "https://mcp-sheets.your-domain.com",
    "credentials_env": "SHEETS_MCP_TOKEN"
  },
  "github-server": {
    "transport": "http+sse",
    "baseUrl": "https://mcp-github.your-domain.com",
    "credentials_env": "GITHUB_MCP_TOKEN"
  }
}
```

---

## Unique Hackathon Features

- **Dry-Run Mode** — Executor simulates calls without touching real APIs.
- **Versioned Workflows** — DAG changes are versioned; rollback is possible.
- **Policy Engine** — Time-window and PII guardrails evaluated before every MCP call.
- **RBAC via Supabase RLS** — Row-Level Security with Admin / DevOps / On-call / Viewer roles.
- **Full Audit Log** — Every MCP invocation, approval, and retry stored permanently.

