# Kaggle Notebook — Agentic MCP Gateway (AI Logic)

> This notebook lets you iterate on the Planner Agent, Executor Agent, and Learning Agent
> logic entirely inside Kaggle before wiring it into the FastAPI server.
>
> **Add secrets in Kaggle:** Settings → Add-ons → Secrets
> - `SUPABASE_URL`
> - `SUPABASE_KEY`
> - `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`)
> - `LLM_PROVIDER` → set to `openai` or `anthropic`
>
> Kaggle automatically exposes Secrets as environment variables — no hard-coding required.

---

## Cell 1 — Install dependencies

```python
# Cell 1: Install all required packages
!pip install -q supabase==2.4.0 python-dotenv httpx openai anthropic
print("All packages installed.")
```

---

## Cell 2 — Load environment variables & connect Supabase

```python
# Cell 2: Load secrets from Kaggle environment and connect to Supabase
import os
from supabase import create_client, Client

# Kaggle Secrets are automatically available as os.environ variables.
# If running locally, create a .env file and call load_dotenv() instead.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise EnvironmentError(
        "SUPABASE_URL and SUPABASE_KEY are missing.\n"
        "Add them in Kaggle: Settings → Add-ons → Secrets"
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
print("✅ Supabase connected:", SUPABASE_URL)
```

---

## Cell 3 — Define the Planner Agent system prompt

```python
# Cell 3: System prompt for the LLM-based Planner Agent
import textwrap

PLANNER_SYSTEM_PROMPT = textwrap.dedent("""
You are a workflow planner agent for an Agentic MCP Gateway.

Given a natural language description of a business workflow, output a JSON object with:
  - "dag"         : list of step nodes (the execution graph)
  - "suggestions" : list of 3-5 improvement ideas as strings

Each node in "dag" must contain these exact fields:
  id               (string — unique step identifier, e.g. "step1")
  type             (string — one of: trigger | action | notify | utility | approval_gate)
  mcp_server       (string — one of: jira-server | slack-server | sheets-server | github-server)
  tool             (string — exact MCP tool name to call on that server)
  params           (object — tool arguments; use {prev_node_id.field_name} to reference outputs)
  depends_on       (array  — list of node ids this step must wait for; [] for the first step)
  approval_required (bool  — true ONLY for sensitive/destructive operations, else false)
  max_attempts     (int    — retry limit, default 3)

Output ONLY valid JSON. No text, comments, or markdown outside the JSON.
""")

print("Planner prompt defined.")
```

---

## Cell 4 — Implement the LLM caller

```python
# Cell 4: Generic LLM caller supporting OpenAI and Anthropic
import json

def call_llm(name: str, description: str) -> dict:
    """
    Send the NL workflow description to the configured LLM.
    Returns the parsed DAG dict.
    """
    provider    = os.environ.get("LLM_PROVIDER", "openai").lower()
    user_prompt = f"Workflow name: {name}\n\nWorkflow description:\n{description}"

    raw_json = ""

    if provider == "openai":
        from openai import OpenAI
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        raw_json = response.choices[0].message.content

    elif provider == "anthropic":
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        response = client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=2048,
            system=PLANNER_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw_json = response.content[0].text

    else:
        # --- MOCK FALLBACK (no API key needed, good for testing) ---
        print(f"[WARN] Unknown LLM_PROVIDER '{provider}'. Using mock DAG.")
        raw_json = json.dumps({
            "dag": [
                {
                    "id": "step1", "type": "trigger",
                    "mcp_server": "jira-server", "tool": "watchCriticalBugs",
                    "params": {"project_key": "PROJ"},
                    "depends_on": [], "approval_required": False, "max_attempts": 3
                },
                {
                    "id": "step2", "type": "action",
                    "mcp_server": "github-server", "tool": "createBranch",
                    "params": {"branch_name": "bugfix/{step1.issue_key}"},
                    "depends_on": ["step1"], "approval_required": False, "max_attempts": 3
                },
                {
                    "id": "step3", "type": "notify",
                    "mcp_server": "slack-server", "tool": "sendMessage",
                    "params": {
                        "channel": "#oncall",
                        "text": "Bug {step1.issue_key} → branch {step2.branch_name} created."
                    },
                    "depends_on": ["step2"], "approval_required": True, "max_attempts": 2
                },
                {
                    "id": "step4", "type": "utility",
                    "mcp_server": "sheets-server", "tool": "appendRow",
                    "params": {
                        "spreadsheet_id": "YOUR_SHEET_ID",
                        "values": ["{step1.issue_key}", "{step2.branch_name}", "open"]
                    },
                    "depends_on": ["step3"], "approval_required": False, "max_attempts": 3
                }
            ],
            "suggestions": [
                "Add a dry-run mode before creating GitHub branches.",
                "Link the Sheets row back to the original Jira issue URL.",
                "Send a follow-up Slack message when the incident is resolved.",
                "Add a conditional step to escalate if no response in 30 minutes."
            ]
        })

    return json.loads(raw_json)

print("LLM caller defined.")
```

---

## Cell 5 — Run the Planner Agent

```python
# Cell 5: Plan a workflow and display the resulting DAG
plan = call_llm(
    name="Critical Bug Triage",
    description=(
        "When a critical bug is filed in Jira, create a GitHub branch named after the issue key, "
        "notify the on-call engineer in Slack with the branch link, "
        "and update the incident tracker Google Sheet with the issue key and branch name."
    )
)

print("=== DAG NODES ===")
for node in plan["dag"]:
    approval = " [🔐 APPROVAL GATE]" if node["approval_required"] else ""
    deps     = f"  ← depends on: {node['depends_on']}" if node["depends_on"] else ""
    print(f"  {node['id']} ({node['type']}) → {node['mcp_server']}.{node['tool']}{approval}{deps}")

print("\n=== AI SUGGESTIONS ===")
for s in plan.get("suggestions", []):
    print(f"  💡 {s}")
```

---

## Cell 6 — Save plan to Supabase

```python
# Cell 6: Persist the planned DAG and suggestions to Supabase workflow_suggestions table
result = supabase.table("workflow_suggestions").insert({
    "owner_id":       "demo-user",
    "workflow_name":  "Critical Bug Triage",
    "description":    "Jira → GitHub → Slack → Google Sheets",
    "dag_json":       plan["dag"],
    "suggestions":    plan.get("suggestions", []),
    "suggestion_type": "template",
}).execute()

print("✅ Plan saved to Supabase. Row ID:", result.data[0]["id"] if result.data else "unknown")
```

---

## Cell 7 — MCP mock caller & policy checker

```python
# Cell 7: Simulate MCP tool calls and check policies before execution

import asyncio, random
from datetime import datetime
from typing import Any, Dict, List, Optional

# --- Policy Checker ---
def check_policy(server: str, tool: str, params: dict) -> Optional[str]:
    """
    Returns a violation message if a rule blocks this call, else None.
    In production this reads from orchestrator/policies.json.
    """
    hour_ist = datetime.utcnow().hour + 5   # approximate IST offset
    if tool == "createRelease" and server == "github-server" and hour_ist >= 19:
        return "Production deployments are blocked after 19:00 IST."
    if server == "slack-server":
        for key in ["email", "phone", "aadhaar"]:
            if key in str(params).lower():
                return f"PII field '{key}' must not be sent to Slack."
    return None

# --- Mock MCP Caller ---
async def call_mcp_mock(server: str, tool: str, params: dict,
                        fail_rate: float = 0.2) -> dict:
    """
    Simulates an MCP tool call over JSON-RPC.
    fail_rate controls random transient failures to test retry logic.
    Replace this with real httpx call in production (see orchestrator/app.py).
    """
    await asyncio.sleep(0.1)
    if random.random() < fail_rate:
        raise RuntimeError(f"[Mock] Transient error: {server}.{tool} temporarily unavailable")
    return {"ok": True, "server": server, "tool": tool, "output": f"mock_result_of_{tool}"}

print("Policy checker and MCP mock defined.")
```

---

## Cell 8 — Executor Agent with retry, policy checks, and smart error recovery

```python
# Cell 8: Full Executor Agent — topological DAG execution with retries and error recovery

import uuid

async def execute_dag(
    nodes: List[dict],
    run_id: str,
    dry_run: bool = False,
    write_to_supabase: bool = True
):
    """
    Executes a DAG of MCP tool calls in dependency order.

    Features:
    - Topological ordering (respects depends_on)
    - Skips downstream nodes if a dependency fails
    - Policy check before every MCP call
    - Exponential backoff retry on transient failures
    - Smart error recovery: logs actionable fix suggestions on final failure
    - Dry-run mode: simulates all calls without hitting real APIs
    - Writes logs to Supabase run_logs table (if write_to_supabase=True)
    """
    completed: set = set()
    failed:    set = set()
    context:   Dict[str, Any] = {}   # stores output of each completed node
    all_logs:  list = []

    def log(message: str, level: str = "info"):
        entry = {
            "run_id":    run_id,
            "level":     level,
            "message":   message,
            "timestamp": datetime.utcnow().isoformat(),
        }
        all_logs.append(entry)
        icon = {"info": "ℹ️ ", "warning": "⚠️ ", "error": "❌"}.get(level, "")
        print(f"{icon} [{level.upper()}] {message}")
        if write_to_supabase:
            try:
                supabase.table("run_logs").insert(entry).execute()
            except Exception as e:
                print(f"[WARN] Could not write log to Supabase: {e}")

    log(f"Run {run_id} started (dry_run={dry_run}, {len(nodes)} nodes)")

    max_idle = 30
    idle_count = 0

    while len(completed) + len(failed) < len(nodes):
        progress = False

        for node in nodes:
            nid = node["id"]

            if nid in completed or nid in failed:
                continue

            # Wait for all dependencies to complete
            deps = node.get("depends_on", [])
            if any(dep not in completed for dep in deps):
                continue

            # Skip if any dependency failed
            if any(dep in failed for dep in deps):
                failed.add(nid)
                log(f"Node '{nid}' skipped — dependency failed", "warning")
                progress = True
                continue

            # Approval gate (auto-approve in notebook; real code waits for DB update)
            if node.get("approval_required") and not dry_run:
                log(f"Node '{nid}' has approval_required=True → auto-approving in notebook mode", "warning")

            # Policy check
            violation = check_policy(node["mcp_server"], node["tool"], node.get("params", {}))
            if violation:
                failed.add(nid)
                log(f"Node '{nid}' blocked by policy: {violation}", "error")
                progress = True
                continue

            # Execute with retry + exponential backoff
            max_attempts = node.get("max_attempts", 3)
            succeeded = False

            for attempt in range(1, max_attempts + 1):
                try:
                    log(f"Executing '{nid}': {node['mcp_server']}.{node['tool']} (attempt {attempt}/{max_attempts})")

                    if dry_run:
                        result = {"dry_run": True, "node_id": nid, "simulated": True}
                    else:
                        result = await call_mcp_mock(
                            node["mcp_server"], node["tool"], node.get("params", {})
                        )

                    context[nid] = result
                    completed.add(nid)
                    log(f"Node '{nid}' ✅ completed: {result}")
                    succeeded = True
                    progress  = True
                    break

                except Exception as ex:
                    log(f"Node '{nid}' attempt {attempt} failed: {ex}", "error")
                    if attempt < max_attempts:
                        backoff = 2 ** attempt
                        log(f"Retrying '{nid}' in {backoff}s…")
                        await asyncio.sleep(backoff)

            if not succeeded:
                failed.add(nid)
                progress = True
                # ── Smart Error Recovery suggestion ─────────────────
                log(
                    f"SMART RECOVERY SUGGESTION for '{nid}': "
                    f"Check credentials for '{node['mcp_server']}', "
                    f"verify tool name '{node['tool']}' exists in that MCP server's tool list, "
                    f"and review params: {node.get('params', {})}",
                    "error"
                )

        if not progress:
            idle_count += 1
            if idle_count >= max_idle:
                log("Execution stalled — possible deadlock or all pending nodes await approvals.", "error")
                break
            await asyncio.sleep(1)
        else:
            idle_count = 0

    final_status = "success" if not failed else "failed"
    log(
        f"Run complete — status: {final_status} | "
        f"completed: {len(completed)} | failed: {len(failed)}"
    )

    # Update workflow_runs table
    if write_to_supabase:
        try:
            supabase.table("workflow_runs") \
                .update({"status": final_status, "finished_at": datetime.utcnow().isoformat()}) \
                .eq("id", run_id).execute()
        except Exception as e:
            print(f"[WARN] Could not update workflow_runs: {e}")

    return {
        "run_id":    run_id,
        "status":    final_status,
        "completed": list(completed),
        "failed":    list(failed),
        "context":   context,
        "logs":      all_logs,
    }


# ── Run the executor on the plan from Cell 5 ──────────────────────
run_id = str(uuid.uuid4())
print(f"\n🚀 Starting run: {run_id}\n{'─'*60}")

result = await execute_dag(
    nodes=plan["dag"],
    run_id=run_id,
    dry_run=False,
    write_to_supabase=True,
)

print(f"\n{'─'*60}")
print(f"Final Status : {result['status']}")
print(f"Completed    : {result['completed']}")
print(f"Failed       : {result['failed']}")
```

---

## Cell 9 — Dry-Run Simulation Mode

```python
# Cell 9: Re-run the same DAG in dry-run mode — no real MCP calls
dry_run_id = str(uuid.uuid4())
print(f"\n🔵 DRY-RUN: {dry_run_id}\n{'─'*60}")

dry_result = await execute_dag(
    nodes=plan["dag"],
    run_id=dry_run_id,
    dry_run=True,
    write_to_supabase=False,   # don't write simulation logs to production DB
)

print(f"\nDry-run result : {dry_result['status']}")
print(f"Steps simulated: {dry_result['completed']}")
```

---

## Cell 10 — Learning Agent

```python
# Cell 10: Learning Agent — mines run_logs and produces improvement suggestions

from typing import Dict

def learning_agent(owner_id: str = "demo-user", workflow_id: str = None) -> list:
    """
    Queries Supabase run_logs for error entries, counts failures per node,
    and generates actionable improvement suggestions.

    Returns a list of suggestion strings and saves them to workflow_suggestions.
    """
    # Fetch all error logs
    query = supabase.table("run_logs").select("message, run_id").eq("level", "error")
    error_logs = query.execute().data

    # Count failures per node
    failure_counts: Dict[str, int] = {}
    for entry in error_logs:
        msg   = entry.get("message", "")
        parts = msg.split()
        # Match log format: "Node 'stepX' attempt N failed: ..."
        for i, part in enumerate(parts):
            if part in ("Node", "node") and i + 1 < len(parts):
                nid = parts[i + 1].strip("'\"")
                if "failed" in msg:
                    failure_counts[nid] = failure_counts.get(nid, 0) + 1
                break

    suggestions = []

    # Suggestion 1: High-failure nodes
    for nid, count in sorted(failure_counts.items(), key=lambda x: -x[1]):
        if count >= 2:
            suggestions.append(
                f"Node '{nid}' failed {count} time(s). "
                "Consider: (1) increasing max_attempts, "
                "(2) adding a pre-validation step before it, "
                "(3) verifying credentials for that MCP server."
            )

    # Suggestion 2: Promote to template if many successful runs
    try:
        successful = supabase.table("workflow_runs") \
            .select("id") \
            .eq("status", "success") \
            .execute().data
        if len(successful) >= 3:
            suggestions.append(
                f"This workflow has succeeded {len(successful)} time(s). "
                "Consider saving it as a reusable template in workflow_templates."
            )
    except Exception as e:
        print(f"[WARN] Could not query workflow_runs: {e}")

    # Suggestion 3: No failures at all — good signal
    if not failure_counts:
        suggestions.append(
            "No node failures detected in recent runs. "
            "Consider reducing max_attempts from 3 to 2 to speed up the workflow."
        )

    # Save suggestions to Supabase
    if suggestions:
        try:
            supabase.table("workflow_suggestions").insert({
                "owner_id":        owner_id,
                "workflow_id":     workflow_id,
                "workflow_name":   "LEARNING_AGENT_AUTO",
                "description":     "Auto-generated suggestions from run history analysis",
                "suggestions":     suggestions,
                "suggestion_type": "improvement",
            }).execute()
            print(f"✅ Saved {len(suggestions)} suggestion(s) to Supabase.")
        except Exception as e:
            print(f"[WARN] Could not save suggestions to Supabase: {e}")
    else:
        print("ℹ️  Not enough data yet to generate meaningful suggestions.")

    return suggestions


print("\n🧠 Learning Agent running…\n")
suggestions = learning_agent(owner_id="demo-user")

for i, s in enumerate(suggestions, 1):
    print(f"  {i}. 💡 {s}\n")
```

---

## Cell 11 — Export reusable functions summary

```python
# Cell 11: Summary of all functions ready to copy into orchestrator/app.py

summary = """
Functions defined in this notebook and their mapping to orchestrator/app.py:

  call_llm(name, description)
    → Used inside planner_agent() → called by POST /plan endpoint
    → Supports: openai (gpt-4o), anthropic (claude-3-5-sonnet), mock fallback

  execute_dag(nodes, run_id, dry_run, write_to_supabase)
    → Used inside executor_agent() → called by POST /execute endpoint
    → Wrapped in asyncio.create_task() for background execution

  learning_agent(owner_id, workflow_id)
    → Used in POST /learn endpoint
    → Can be scheduled as a periodic background job (e.g. every hour)

Remember: In orchestrator/app.py call load_dotenv() BEFORE any os.environ reads.
"""
print(summary)
```

