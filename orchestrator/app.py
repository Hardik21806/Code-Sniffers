# orchestrator/app.py
# Agentic MCP Gateway — Core Orchestrator (Final Fixed Version)

import os
import re
import json
import asyncio
import textwrap
from datetime import datetime
from collections import defaultdict
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

# ══════════════════════════════════════════════════════════════════════════════
# SUPABASE — graceful fallback
# ══════════════════════════════════════════════════════════════════════════════
try:
    from supabase import create_client
    _sb_url = os.environ.get("SUPABASE_URL", "")
    _sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_KEY", "")
    supabase = create_client(_sb_url, _sb_key) if (_sb_url and _sb_key) else None
    if supabase:
        print("[INFO] Supabase connected ✅")
    else:
        print("[WARN] Supabase not configured — DB writes skipped")
except Exception as _e:
    print(f"[WARN] Supabase init failed: {_e}")
    supabase = None

# ══════════════════════════════════════════════════════════════════════════════
# CONFIG FILES — safe fallbacks
# ══════════════════════════════════════════════════════════════════════════════
_dir = os.path.dirname(os.path.abspath(__file__))

_mcp_path = os.path.join(_dir, "mcp_servers.json")
if os.path.exists(_mcp_path):
    with open(_mcp_path) as _f:
        MCP_SERVERS: Dict[str, Any] = json.load(_f)
    print(f"[INFO] Loaded {len(MCP_SERVERS)} MCP servers")
else:
    print("[WARN] mcp_servers.json not found — all MCP calls return mock responses")
    MCP_SERVERS = {}

_pol_path = os.path.join(_dir, "policies.json")
if os.path.exists(_pol_path):
    with open(_pol_path) as _f:
        POLICIES: Dict[str, Any] = json.load(_f)
    print(f"[INFO] Loaded {len(POLICIES.get('rules', []))} policy rules")
else:
    print("[WARN] policies.json not found — no policies enforced")
    POLICIES = {"rules": []}

# ══════════════════════════════════════════════════════════════════════════════
# FASTAPI
# ══════════════════════════════════════════════════════════════════════════════
app = FastAPI(title="Agentic MCP Orchestrator", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global in-memory state ────────────────────────────────────────────────────
run_clients:        Dict[str, set]             = defaultdict(set)
# run_id → set of node_ids currently paused for approval
approval_paused:    Dict[str, set]             = defaultdict(set)
# run_id → { node_id → "approved" | "rejected" }   ← KEY FIX
approval_decisions: Dict[str, Dict[str, str]]  = defaultdict(dict)
_tool_cache:        Dict[str, List[dict]]       = {}

# ══════════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ══════════════════════════════════════════════════════════════════════════════
class PlanRequest(BaseModel):
    name: str
    description: str
    owner_id: str = "demo-user"

class DagNode(BaseModel):
    id: str
    type: str
    mcp_server: str
    tool: str
    params: Dict[str, Any]  = {}
    depends_on: List[str]   = []
    approval_required: bool = False
    max_attempts: int       = 3

class PlanResponse(BaseModel):
    dag: List[DagNode]
    suggestions: List[str] = []

class ExecuteRequest(BaseModel):
    run_id: str
    workflow_id: str
    mode: str                     = "live"
    dag: Optional[List[dict]]     = None
    input_payload: Optional[dict] = {}
    dry_run: bool                 = False

class ApprovalCallbackRequest(BaseModel):
    run_id: str
    node_id: str  = ""
    decision: str = "approved"

# ══════════════════════════════════════════════════════════════════════════════
# DB HELPERS — every call is wrapped so a failure never crashes the server
# ══════════════════════════════════════════════════════════════════════════════
def db_insert(table: str, row: dict):
    if not supabase:
        return
    try:
        supabase.table(table).insert(row).execute()
    except Exception as e:
        print(f"[DB WARN] insert {table}: {e}")

def db_update(table: str, data: dict, col: str, val: str):
    if not supabase:
        return
    try:
        supabase.table(table).update(data).eq(col, val).execute()
    except Exception as e:
        print(f"[DB WARN] update {table}: {e}")

def db_upsert(table: str, row: dict, on_conflict: str):
    if not supabase:
        return
    try:
        supabase.table(table).upsert(row, on_conflict=on_conflict).execute()
    except Exception as e:
        print(f"[DB WARN] upsert {table}: {e}")

def db_select(table: str, filters: dict) -> List[dict]:
    if not supabase:
        return []
    try:
        q = supabase.table(table).select("*")
        for col, val in filters.items():
            q = q.eq(col, val)
        return q.execute().data or []
    except Exception as e:
        print(f"[DB WARN] select {table}: {e}")
        return []

# ══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET BROADCAST + LOGGING
# ══════════════════════════════════════════════════════════════════════════════
async def broadcast(run_id: str, payload: dict):
    dead = set()
    for ws in list(run_clients.get(run_id, [])):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.add(ws)
    run_clients[run_id] -= dead

async def log_event(
    run_id: str,
    message: str,
    level: str = "info",
    step_id: Optional[str] = None,
    payload: Optional[dict] = None,
):
    row = {
        "run_id":    run_id,
        "level":     level,
        "message":   message,
        "payload":   payload or {},
        "timestamp": datetime.utcnow().isoformat(),
    }
    if step_id:
        row["step_id"] = step_id
    db_insert("run_logs", row)
    await broadcast(run_id, {"type": "log", **row})
    print(f"[{level.upper()}][{run_id[:8]}] {message}")

# ══════════════════════════════════════════════════════════════════════════════
# POLICY ENGINE
# ══════════════════════════════════════════════════════════════════════════════
def check_policies(server: str, tool: str, params: Dict[str, Any]) -> Optional[str]:
    now_hour_ist = (datetime.utcnow().hour + 5) % 24
    for rule in POLICIES.get("rules", []):
        if rule.get("match_server") and rule["match_server"] != server:
            continue
        if rule.get("match_tool") and rule["match_tool"] != tool:
            continue
        if "block_after_hour" in rule:
            if now_hour_ist >= rule["block_after_hour"]:
                return rule.get("message", "Blocked by time policy")
        if "forbidden_param_keys" in rule:
            params_str = json.dumps(params)
            for key in rule["forbidden_param_keys"]:
                if key in params_str:
                    return rule.get("message", f"Forbidden param: {key}")
    return None

# ══════════════════════════════════════════════════════════════════════════════
# CONTEXT RESOLVER — replaces {step_id.field} in params
# ══════════════════════════════════════════════════════════════════════════════
def _resolve_ref(ref_str: str, context: Dict[str, Any]) -> Any:
    parts   = ref_str.split(".")
    step_id = parts[0]
    if step_id not in context:
        return "{" + ref_str + "}"
    value = context[step_id]
    for key in parts[1:]:
        if isinstance(value, dict) and key in value:
            value = value[key]
        else:
            return "{" + ref_str + "}"
    return value

def resolve_params(params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    PLACEHOLDER = re.compile(r"^\{([\w.]+)\}$")

    def _resolve(value: Any) -> Any:
        if isinstance(value, str):
            m = PLACEHOLDER.match(value)
            if m:
                return _resolve_ref(m.group(1), context)
            def _inline(m2):
                return str(_resolve_ref(m2.group(1), context))
            return re.sub(r"\{([\w.]+)\}", _inline, value)
        elif isinstance(value, dict):
            return {k: _resolve(v) for k, v in value.items()}
        elif isinstance(value, list):
            return [_resolve(item) for item in value]
        return value

    return {k: _resolve(v) for k, v in params.items()}

# ══════════════════════════════════════════════════════════════════════════════
# MCP CLIENT
# ══════════════════════════════════════════════════════════════════════════════
def _jsonrpc(method: str, params: Any) -> dict:
    return {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}

def _headers(cfg: dict) -> dict:
    token = os.environ.get(cfg.get("credentials_env", ""), "")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

async def discover_tools(server_name: str) -> List[dict]:
    if server_name in _tool_cache:
        return _tool_cache[server_name]
    cfg = MCP_SERVERS.get(server_name)
    if not cfg:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{cfg['baseUrl']}/mcp",
                json=_jsonrpc("tools/list", {}),
                headers=_headers(cfg),
            )
            resp.raise_for_status()
            tools = resp.json().get("result", {}).get("tools", [])
            _tool_cache[server_name] = tools
            return tools
    except Exception as e:
        print(f"[WARN] discover_tools({server_name}): {e}")
        return []

async def call_mcp_tool(
    server_name: str,
    tool: str,
    params: Dict[str, Any],
    dry_run: bool = False,
) -> dict:
    if dry_run:
        return {
            "dry_run": True,
            "server":  server_name,
            "tool":    tool,
            "result":  f"[DRY-RUN] {server_name}.{tool} called with {params}",
        }
    cfg = MCP_SERVERS.get(server_name)
    if not cfg:
        # Mock — safe for demo when real MCP servers aren't running
        import random
        await asyncio.sleep(0.15)
        if random.random() < 0.04:
            raise RuntimeError(f"[MOCK] Transient error: {server_name}.{tool}")
        return {
            "ok":     True,
            "server": server_name,
            "tool":   tool,
            "result": f"mock_result_{tool}_{random.randint(100, 999)}",
        }
    payload = _jsonrpc("tools/call", {"name": tool, "arguments": params})
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{cfg['baseUrl']}/mcp", json=payload, headers=_headers(cfg))
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            err = data["error"]
            raise RuntimeError(
                f"MCP error {server_name}.{tool}: [{err.get('code')}] {err.get('message')}"
            )
        return data.get("result", {})

# ══════════════════════════════════════════════════════════════════════════════
# PLANNER AGENT
# ══════════════════════════════════════════════════════════════════════════════
PLANNER_SYSTEM_PROMPT = textwrap.dedent("""
You are a workflow planner for an Agentic MCP Gateway.

Output ONLY a single valid JSON object with exactly two keys:
  "dag"         : list of step nodes
  "suggestions" : list of 3-5 improvement strings

NODE SCHEMA:
{
  "id"               : "<unique snake_case string>",
  "type"             : "trigger|action|notify|utility|approval_gate",
  "mcp_server"       : "jira-server|slack-server|sheets-server|github-server",
  "tool"             : "<tool name>",
  "params"           : { "<key>": "<value or {prev_step_id.field}>" },
  "depends_on"       : ["<step_id>"],
  "approval_required": true | false,
  "max_attempts"     : 3
}

Use {step_id.field} in params to pass data between steps.
Set approval_required=true for: GitHub releases, external Slack messages, DB deletions, prod deploys.
Output ONLY valid JSON. No markdown. No text outside the JSON object.
""")

def _mock_dag(name: str) -> dict:
    return {
        "dag": [
            {
                "id": "watch_jira", "type": "trigger",
                "mcp_server": "jira-server", "tool": "watchCriticalBugs",
                "params": {"project_key": "PROJ", "priority": "P1"},
                "depends_on": [], "approval_required": False, "max_attempts": 3,
            },
            {
                "id": "create_branch", "type": "action",
                "mcp_server": "github-server", "tool": "createBranch",
                "params": {"branch_name": "bugfix/{watch_jira.issue_key}"},
                "depends_on": ["watch_jira"], "approval_required": False, "max_attempts": 3,
            },
            {
                "id": "notify_slack", "type": "notify",
                "mcp_server": "slack-server", "tool": "sendMessage",
                "params": {
                    "channel": "#oncall",
                    "text": "🐛 Bug {watch_jira.issue_key} — branch {create_branch.branch_name} created.",
                },
                "depends_on": ["create_branch"], "approval_required": True, "max_attempts": 2,
            },
            {
                "id": "update_sheet", "type": "utility",
                "mcp_server": "sheets-server", "tool": "appendRow",
                "params": {
                    "spreadsheet_id": "YOUR_SHEET_ID",
                    "values": ["{watch_jira.issue_key}", "{create_branch.branch_name}", "open"],
                },
                "depends_on": ["notify_slack"], "approval_required": False, "max_attempts": 3,
            },
        ],
        "suggestions": [
            "Add a dry-run mode before creating GitHub branches.",
            "Link the Sheets row back to the original Jira issue URL.",
            "Send a follow-up Slack message when the incident is resolved.",
            "Add a conditional escalation step if no response in 30 minutes.",
            f"Consider breaking '{name}' into smaller reusable sub-workflows.",
        ],
    }

async def planner_agent(req: PlanRequest) -> PlanResponse:
    provider = os.environ.get("LLM_PROVIDER", "mock").strip().lower()
    raw_json  = ""

    if provider == "openai":
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
            resp = await client.chat.completions.create(
                model="gpt-4o",
                response_format={"type": "json_object"},
                temperature=0.2,
                messages=[
                    {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
                    {"role": "user",   "content": f"Name: {req.name}\nDescription: {req.description}"},
                ],
            )
            raw_json = resp.choices[0].message.content
        except Exception as e:
            print(f"[WARN] OpenAI failed: {e} — falling back to mock")
            provider = "mock"

    elif provider == "anthropic":
        try:
            import anthropic
            client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            resp = await client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=4096,
                system=PLANNER_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": f"Name: {req.name}\nDescription: {req.description}"}],
            )
            raw_json = resp.content[0].text
            raw_json = re.sub(r"^```json\s*", "", raw_json.strip())
            raw_json = re.sub(r"```$",        "", raw_json.strip())
        except Exception as e:
            print(f"[WARN] Anthropic failed: {e} — falling back to mock")
            provider = "mock"

    if provider == "mock" or not raw_json:
        print("[INFO] Using mock planner (set LLM_PROVIDER=openai/anthropic for real LLM)")
        parsed = _mock_dag(req.name)
        return PlanResponse(
            dag=[DagNode(**n) for n in parsed["dag"]],
            suggestions=parsed["suggestions"],
        )

    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError as e:
        print(f"[WARN] LLM returned invalid JSON ({e}) — falling back to mock")
        parsed = _mock_dag(req.name)

    nodes       = [DagNode(**n) for n in parsed.get("dag", [])]
    suggestions = parsed.get("suggestions", [])

    node_ids = {n.id for n in nodes}
    for node in nodes:
        for dep in node.depends_on:
            if dep not in node_ids:
                suggestions.append(f"Warning: '{node.id}' depends on unknown node '{dep}'.")

    return PlanResponse(dag=nodes, suggestions=suggestions)

# ══════════════════════════════════════════════════════════════════════════════
# EXECUTOR — single node with retries
# ══════════════════════════════════════════════════════════════════════════════
async def _execute_node(
    node:      DagNode,
    run_id:    str,
    context:   Dict[str, Any],
    completed: set,
    failed:    set,
    dry_run:   bool,
):
    nid = node.id
    db_upsert("workflow_run_steps", {
        "run_id":       run_id,
        "node_id":      nid,
        "name":         node.tool,
        "type":         "mcp_tool",
        "status":       "running",
        "attempt":      0,
        "max_attempts": node.max_attempts,
        "started_at":   datetime.utcnow().isoformat(),
    }, on_conflict="run_id,node_id")

    await broadcast(run_id, {"type": "step_started", "node_id": nid})

    last_error = None
    for attempt in range(1, node.max_attempts + 1):
        try:
            await log_event(
                run_id,
                f"▶ {nid} → {node.mcp_server}.{node.tool}  (attempt {attempt}/{node.max_attempts})",
                payload={"server": node.mcp_server, "tool": node.tool},
            )
            resolved = resolve_params(node.params, context)
            result   = await call_mcp_tool(node.mcp_server, node.tool, resolved, dry_run)

            context[nid] = result
            completed.add(nid)

            db_upsert("workflow_run_steps", {
                "run_id":      run_id,
                "node_id":     nid,
                "name":        node.tool,
                "type":        "mcp_tool",
                "status":      "success",
                "output_json": result,
                "attempt":     attempt,
                "finished_at": datetime.utcnow().isoformat(),
            }, on_conflict="run_id,node_id")

            await broadcast(run_id, {"type": "step_completed", "node_id": nid, "result": result})
            await log_event(run_id, f"✅ Node '{nid}' completed")
            return

        except Exception as ex:
            last_error = str(ex)
            await log_event(run_id, f"❌ Node '{nid}' attempt {attempt} failed: {ex}", level="error")
            if attempt < node.max_attempts:
                backoff = 2 ** attempt
                await log_event(run_id, f"🔁 Retrying '{nid}' in {backoff}s…")
                await asyncio.sleep(backoff)

    failed.add(nid)
    db_upsert("workflow_run_steps", {
        "run_id":      run_id,
        "node_id":     nid,
        "name":        node.tool,
        "type":        "mcp_tool",
        "status":      "failed",
        "error_json":  {"message": f"Failed after {node.max_attempts} attempts", "last_error": last_error},
        "finished_at": datetime.utcnow().isoformat(),
    }, on_conflict="run_id,node_id")
    await broadcast(run_id, {"type": "step_failed", "node_id": nid, "error": last_error})
    await log_event(
        run_id,
        f"💡 Recovery hint for '{nid}': check '{node.mcp_server}' credentials, "
        f"verify tool '{node.tool}', review params: {node.params}",
        level="error",
    )

# ══════════════════════════════════════════════════════════════════════════════
# EXECUTOR — full DAG loop
# ══════════════════════════════════════════════════════════════════════════════
async def executor_agent(run_id: str, dag_nodes: List[DagNode], dry_run: bool = False):
    completed:  set                     = set()
    failed:     set                     = set()
    in_flight:  Dict[str, asyncio.Task] = {}
    context:    Dict[str, Any]          = {}

    # Initialise per-run approval state
    approval_paused[run_id]    = set()
    approval_decisions[run_id] = {}

    db_update("workflow_runs", {
        "status":     "running",
        "started_at": datetime.utcnow().isoformat(),
    }, "id", run_id)
    await broadcast(run_id, {"type": "run_started", "run_id": run_id})
    await log_event(run_id, f"🚀 Run started  |  nodes={len(dag_nodes)}  dry_run={dry_run}")

    idle_ticks = 0
    MAX_IDLE   = 60     # 60 × 2s = 2 min max wait for approvals

    while True:
        # Reap finished tasks
        for nid, task in list(in_flight.items()):
            if task.done():
                del in_flight[nid]

        if (len(completed) + len(failed)) == len(dag_nodes) and not in_flight:
            break

        progress = False

        for node in dag_nodes:
            nid = node.id

            if nid in completed or nid in failed or nid in in_flight:
                continue

            # ── Dependency check ──────────────────────────────────────────
            if any(dep not in completed for dep in node.depends_on):
                if any(dep in failed for dep in node.depends_on):
                    failed.add(nid)
                    await log_event(run_id, f"⏭ Node '{nid}' skipped — dependency failed", level="warning")
                    await broadcast(run_id, {"type": "step_skipped", "node_id": nid})
                    progress = True
                continue

            # ── Approval gate — IN-MEMORY FIRST (key fix) ─────────────────
            if node.approval_required:
                decision = approval_decisions[run_id].get(nid)

                if decision == "approved":
                    await log_event(run_id, f"👍 Node '{nid}' approved — proceeding")
                    # fall through to execution below

                elif decision == "rejected":
                    failed.add(nid)
                    await log_event(run_id, f"🚫 Node '{nid}' rejected by human", level="error")
                    await broadcast(run_id, {"type": "step_failed", "node_id": nid, "error": "Rejected by human"})
                    progress = True
                    continue

                else:
                    # No decision yet — create approval request (only once)
                    if nid not in approval_paused[run_id]:
                        db_insert("approvals", {
                            "run_id":     run_id,
                            "node_id":    nid,
                            "mcp_server": node.mcp_server,
                            "tool":       node.tool,
                            "status":     "pending",
                            "created_at": datetime.utcnow().isoformat(),
                        })
                        approval_paused[run_id].add(nid)
                        db_update("workflow_runs", {"status": "paused"}, "id", run_id)
                        await broadcast(run_id, {
                            "type":       "approval_requested",
                            "node_id":    nid,
                            "mcp_server": node.mcp_server,
                            "tool":       node.tool,
                        })
                        await log_event(run_id, f"⏸ Approval requested for '{nid}' — execution paused")
                        progress = True
                    continue

            # ── Policy check ──────────────────────────────────────────────
            violation = check_policies(node.mcp_server, node.tool, node.params)
            if violation:
                failed.add(nid)
                await log_event(run_id, f"🛡 Policy BLOCKED '{nid}': {violation}", level="error")
                await broadcast(run_id, {"type": "step_blocked", "node_id": nid, "reason": violation})
                progress = True
                continue

            # ── Launch node as concurrent asyncio task ────────────────────
            task = asyncio.create_task(
                _execute_node(node, run_id, context, completed, failed, dry_run)
            )
            in_flight[nid] = task
            progress = True

        if not progress and not in_flight:
            idle_ticks += 1
            if idle_ticks >= MAX_IDLE:
                await log_event(
                    run_id,
                    "⏰ Execution timed out — possible deadlock or stuck approvals.",
                    level="error",
                )
                break
            await asyncio.sleep(2)
        else:
            idle_ticks = 0
            await asyncio.sleep(0.1)

    # Wait for any remaining tasks
    if in_flight:
        await asyncio.gather(*in_flight.values(), return_exceptions=True)

    final_status = "success" if not failed else "failed"
    db_update("workflow_runs", {
        "status":      final_status,
        "finished_at": datetime.utcnow().isoformat(),
    }, "id", run_id)
    await broadcast(run_id, {
        "type":      "run_completed",
        "status":    final_status,
        "completed": list(completed),
        "failed":    list(failed),
    })
    await log_event(run_id, f"🏁 Run finished — {final_status}  ✅{len(completed)}  ❌{len(failed)}")

    # Cleanup memory
    approval_paused.pop(run_id, None)
    approval_decisions.pop(run_id, None)

# ══════════════════════════════════════════════════════════════════════════════
# LEARNING AGENT
# ══════════════════════════════════════════════════════════════════════════════
def learning_agent(workflow_id: str = "", owner_id: str = "demo-user") -> List[str]:
    if not supabase:
        return ["Supabase not connected — learning agent unavailable."]
    try:
        logs = supabase.table("run_logs").select("message").ilike("message", "%failed%").execute().data or []
        counts: Dict[str, int] = {}
        for log in logs:
            m = re.search(r"Node '([^']+)' attempt \d+ failed", log.get("message", ""))
            if m:
                nid = m.group(1)
                counts[nid] = counts.get(nid, 0) + 1

        suggestions = [
            f"Node '{nid}' failed {c} time(s). Consider increasing max_attempts or adding pre-validation."
            for nid, c in counts.items() if c >= 2
        ]

        if suggestions:
            db_insert("workflow_suggestions", {
                "workflow_id":     workflow_id or None,
                "owner_id":        owner_id,
                "workflow_name":   "LEARNING_AGENT_AUTO",
                "description":     "Auto-generated from run history",
                "suggestions":     suggestions,
                "suggestion_type": "improvement",
            })

        return suggestions or ["No significant failure patterns found yet."]
    except Exception as e:
        return [f"Learning agent error: {e}"]

# ══════════════════════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/")
def root():
    return {
        "service":            "Agentic MCP Orchestrator",
        "status":             "running ✅",
        "llm_provider":       os.environ.get("LLM_PROVIDER", "mock"),
        "supabase_connected": supabase is not None,
        "mcp_servers":        list(MCP_SERVERS.keys()),
        "endpoints": [
            "GET  /",
            "GET  /health",
            "GET  /tools",
            "POST /plan",
            "POST /execute",
            "POST /approval-callback",
            "POST /learn",
            "WS   /ws/runs/{run_id}",
        ],
    }

@app.get("/health")
async def health():
    mcp_status = {}
    for name, cfg in MCP_SERVERS.items():
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"{cfg['baseUrl']}/health")
                mcp_status[name] = "ok" if r.status_code == 200 else f"http_{r.status_code}"
        except Exception:
            mcp_status[name] = "unreachable (mock mode)"
    return {
        "status":            "ok",
        "timestamp":         datetime.utcnow().isoformat(),
        "llm_provider":      os.environ.get("LLM_PROVIDER", "mock"),
        "supabase_connected": supabase is not None,
        "mcp_servers":       mcp_status,
    }

@app.get("/tools")
async def list_tools():
    return {name: await discover_tools(name) for name in MCP_SERVERS}

@app.post("/plan", response_model=PlanResponse)
async def plan_workflow(req: PlanRequest):
    plan = await planner_agent(req)
    db_insert("workflow_suggestions", {
        "owner_id":        req.owner_id,
        "workflow_name":   req.name,
        "description":     req.description,
        "dag_json":        [n.dict() for n in plan.dag],
        "suggestions":     plan.suggestions,
        "suggestion_type": "template",
    })
    return plan

@app.post("/execute")
async def execute_workflow(req: ExecuteRequest):
    dag_data = req.dag
    dry_run  = req.dry_run or (req.mode == "dry-run")

    if not dag_data and req.workflow_id and supabase:
        try:
            wf       = supabase.table("workflows").select("dag_json").eq("id", req.workflow_id).single().execute()
            dag_data = wf.data.get("dag_json", [])
        except Exception as e:
            return {"error": f"Could not load workflow: {e}"}

    if not dag_data:
        return {"error": "No DAG provided and workflow not found in DB."}

    nodes = [DagNode(**n) for n in dag_data]
    db_update("workflow_runs", {"status": "running"}, "id", req.run_id)
    asyncio.create_task(executor_agent(req.run_id, nodes, dry_run))
    return {"status": "started", "run_id": req.run_id, "nodes": len(nodes), "dry_run": dry_run}

@app.post("/approval-callback")
async def approval_callback(req: ApprovalCallbackRequest):
    # ── Store decision in memory FIRST — executor sees it on next tick ────────
    if req.node_id:
        approval_decisions[req.run_id][req.node_id] = req.decision
        approval_paused[req.run_id].discard(req.node_id)

    if req.decision == "approved":
        db_update("workflow_runs", {"status": "running"}, "id", req.run_id)

    # Update approval row in DB
    rows = db_select("approvals", {"run_id": req.run_id, "node_id": req.node_id})
    if rows:
        db_update("approvals", {
            "status":     req.decision,
            "updated_at": datetime.utcnow().isoformat(),
        }, "id", rows[0]["id"])

    await broadcast(req.run_id, {
        "type":     "approval_resolved",
        "node_id":  req.node_id,
        "decision": req.decision,
    })
    await log_event(
        req.run_id,
        f"Approval for '{req.node_id}': {req.decision.upper()}",
        level="info" if req.decision == "approved" else "warning",
    )
    return {"ok": True}

@app.post("/learn")
async def trigger_learning(body: dict = {}):
    suggestions = learning_agent(
        workflow_id=body.get("workflow_id", ""),
        owner_id=body.get("owner_id", "demo-user"),
    )
    return {"suggestions": suggestions}

# ══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET — real-time dashboard
# ══════════════════════════════════════════════════════════════════════════════
@app.websocket("/ws/runs/{run_id}")
async def run_websocket(websocket: WebSocket, run_id: str):
    await websocket.accept()
    run_clients[run_id].add(websocket)

    # Replay past logs so dashboard is immediately populated
    if supabase:
        try:
            past = (
                supabase.table("run_logs")
                .select("*")
                .eq("run_id", run_id)
                .order("timestamp", desc=False)
                .execute()
                .data or []
            )
            for row in past:
                await websocket.send_json({"type": "log", **row})
        except Exception:
            pass

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        run_clients[run_id].discard(websocket)
 