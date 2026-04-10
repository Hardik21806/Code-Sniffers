# Security Model — Agentic MCP Gateway

## Principles

1. **Least privilege** — each MCP connector has scoped credentials and a `tool_whitelist`.
2. **No self-escalation** — the AI agents cannot modify connector scopes or create new secrets.
3. **Human-in-the-loop** — DAG nodes flagged `approval_required: true` pause execution until a human decides.
4. **Full audit trail** — every MCP call, retry, approval, and rejection is logged permanently.
5. **Immutable logs** — `run_logs` has no `UPDATE`/`DELETE` RLS policy; records are append-only.

---

## Supabase Auth & RBAC

- **Auth**: Supabase Auth handles identity (email/password, OAuth).
- **Roles** (stored in `profiles` table): `admin`, `devops`, `oncall`, `viewer`.
- **Row-Level Security (RLS)** enforces access per role:
  - `admin` — full CRUD on all tables.
  - `devops` — manage workflows, runs; read connectors.
  - `oncall` — approve/reject approval gates; read runs and logs.
  - `viewer` — read-only on workflows and runs.

---

## Credential Storage

- MCP API tokens are stored in environment variables on the orchestrator server (never in the DB or frontend).
- The `connectors` table stores `mcp_server_url` and `type`, but **no raw secrets**.
- The Python orchestrator reads `credentials_env` from `mcp_servers.json` to find the correct `os.environ` key at runtime.
- Backend Node.js uses `SUPABASE_SERVICE_ROLE_KEY` (server-only) — this key is **never sent to the frontend**.
- Frontend only calls Node.js REST API endpoints, never Supabase directly with the service key.

---

## Sensitive Operations Requiring Approval

These node types automatically have `approval_required: true` in the DAG:

| Operation | Why |
|---|---|
| `github.createRelease` | Production deployment risk |
| `github.forcePush` | Destructive operation |
| `slack.sendExternalMessage` | External communication |
| `sheets.deleteRows` | Irreversible data mutation |
| Any `mode: production` node | Environment guard |

Executor Agent pauses at these nodes, writes a `pending` row to `approvals`, and waits for Node backend to call `/approval-callback` after a human decision.

---

## Policy Engine

Before every MCP tool call, the Executor checks JSON policies loaded from `orchestrator/policies.json`:

```jsonc
// orchestrator/policies.json
{
  "rules": [
    {
      "name": "no_prod_deploys_after_hours",
      "condition": "tool == 'createRelease' and hour(now()) >= 19",
      "action": "block",
      "message": "Production deployments blocked after 19:00 IST."
    },
    {
      "name": "no_pii_to_slack",
      "condition": "server == 'slack-server' and contains(params, 'email')",
      "action": "block",
      "message": "PII fields must not be sent to Slack."
    }
  ]
}
```

If a rule blocks a call, the step is marked `failed` with a `policy_violation` error and logged.

---

## Transport Security

- All MCP server calls go over HTTPS + TLS when using remote servers.
- Node.js ↔ Python communication is over the internal network (localhost in dev; private VPC in prod).
- React ↔ Node.js communication is over HTTPS in production.
- WebSocket connections (`wss://`) must be used in production.

---

## Audit Log Entries

Every MCP tool call creates a `run_logs` row with:

```json
{
  "run_id": "...",
  "step_id": "...",
  "level": "info",
  "message": "MCP call: github-server.createBranch",
  "payload": {
    "server": "github-server",
    "tool": "createBranch",
    "input_schema_hash": "sha256:...",
    "status": "success",
    "attempt": 1
  }
}
```

Raw input parameters are **not** stored if they contain secrets or PII fields (redacted by the orchestrator before logging).

