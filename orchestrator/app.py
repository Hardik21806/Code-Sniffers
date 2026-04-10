# orchestrator/app.py
# ──────────────────────────────────────────────────────────────────────
# IMPORTANT: load_dotenv() must be called BEFORE any os.environ reads.
# ──────────────────────────────────────────────────────────────────────
import os
import json
import asyncio
import textwrap
from datetime import datetime
from collections import defaultdict
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv           # python-dotenv
load_dotenv()                            # reads orchestrator/.env into os.environ

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from supabase import create_client, Client
import httpx

# ── Supabase client ──────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Load MCP server config ───────────────────────────────────────────
with open(os.path.join(os.path.dirname(__file__), "mcp_servers.json")) as f:
    MCP_SERVERS: Dict[str, Any] = json.load(f)

# ── Load policy rules ────────────────────────────────────────────────
with open(os.path.join(os.path.dirname(__file__), "policies.json")) as f:
    POLICIES: Dict[str, Any] = json.load(f)

# ── FastAPI app ──────────────────────────────────────────────────────
app = FastAPI(title="Agentic MCP Orchestrator")

# ── WebSocket connection registry ────────────────────────────────────
run_clients: Dict[str, set] = defaultdict(set)


# ════════════════════════════════════════════════════════════════════
# Pydantic Models
# ════════════════════════════════════════════════════════════════════

class PlanRequest(BaseModel):
    name: str
    description: str
    owner_id: str

class DagNode(BaseModel):
    id: str
    type: str                        # trigger | action | notify | utility | approval_gate
    mcp_server: str
    tool: str
    params: Dict[str, Any] = {}
    depends_on: List[str] = []
    approval_required: bool = False
    max_attempts: int = 3

class PlanResponse(BaseModel):
    dag: List[DagNode]
    suggestions: List[str] = []

class ExecuteRequest(BaseModel):
    run_id: str
    workflow_id: str
    mode: str = "live"               # live | dry-run

class ApprovalCallbackRequest(BaseModel):
    run_id: str
    node_id: str
    decision: str                    # approved | rejected


# ════════════════════════════════════════════════════════════════════
# Utilities
# ════════════════════════════════════════════════════════════════════

async def broadcast(run_id: str, payload: Dict[str, Any]):
    """Push a JSON event to all WebSocket clients watching this run."""
    dead = set()
    for ws in list(run_clients[run_id]):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.add(ws)
    run_clients[run_id] -= dead


async def log_event(run_id: str, message: str, level: str = "info",
                    step_id: Optional[str] = None, payload: Optional[Dict] = None):
    """Write a log entry to Supabase and broadcast it over WebSocket."""
    row = {
        "run_id": run_id,
        "level": level,
        "message": message,
        "payload": payload or {},
        "timestamp": datetime.utcnow().isoformat(),
    }
    if step_id:
        row["step_id"] = step_id
    supabase.table("run_logs").insert(row).execute()
    await broadcast(run_id, {"type": "log", **row})


def check_policies(server: str, tool: str, params: Dict[str, Any]) -> Optional[str]:
    """Returns a violation message if any policy rule blocks this call, else None."""
    now_hour = datetime.utcnow().hour + 5  # UTC → IST (approx)
    for rule in POLICIES.get("rules", []):
        if rule.get("match_server") and rule["match_server"] != server:
            continue
        if rule.get("match_tool") and rule["match_tool"] != tool:
            continue
        if "block_after_hour" in rule and now_hour >= rule["block_after_hour"]:
            return rule["message"]
        if "forbidden_param_keys" in rule:
            for key in rule["forbidden_param_keys"]:
                if key in str(params):
                    return rule["message"]
    return None


# ════════════════════════════════════════════════════════════════════
# MCP Client — unified tool caller
# ════════════════════════════════════════════════════════════════════

async def call_mcp_tool(server_name: str, tool: str,
                        params: Dict[str, Any], dry_run: bool = False) -> Dict[str, Any]:
    """
    Call a tool on an MCP server via JSON-RPC 2.0 over HTTP.
    In dry-run mode, returns a simulated response without calling the real server.
    """
    if dry_run:
        return {"dry_run": True, "server": server_name, "tool": tool, "simulated": True}

    server_cfg = MCP_SERVERS.get(server_name)
    if not server_cfg:
        raise ValueError(f"Unknown MCP server: {server_name}")

    base_url = server_cfg["baseUrl"]
    token = os.environ.get(server_cfg.get("credentials_env", ""), "")

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": tool, "arguments": params},
    }
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{base_url}/mcp", json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            raise RuntimeError(f"MCP error: {data['error']}")
        return data.get("result", {})


# ════════════════════════════════════════════════════════════════════
# Planner Agent
# ════════════════════════════════════════════════════════════════════

PLANNER_SYSTEM_PROMPT = textwrap.dedent("""
You are a workflow planner agent for an Agentic MCP Gateway.

Given a natural language description of a business workflow, output a JSON object with:
- "dag": list of step nodes
- "suggestions": list of improvement ideas

Each node must contain:
  id           (string, unique)
  type         (trigger | action | notify | utility | approval_gate)
  mcp_server   (jira-server | slack-server | sheets-server | github-server)
  tool         (exact MCP tool name to call)
  params       (JSON object with tool arguments; use {prev_step_id.field} for data references)
  depends_on   (list of node ids this step waits for)
  approval_required (true if this is a sensitive operation, else false)
  max_attempts (integer, default 3)

Output ONLY valid JSON. No commentary outside the JSON.
""")

async def planner_agent(req: PlanRequest) -> PlanResponse:
    """LLM-backed planner: converts NL description into a validated DAG."""
    provider = os.environ.get("LLM_PROVIDER", "openai")
    user_prompt = f"Workflow name: {req.name}\n\nDescription:\n{req.description}"

    raw_json = ""

    if provider == "openai":
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
        resp = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )
        raw_json = resp.choices.message.content

    elif provider == "anthropic":
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        resp = await client.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=2048,
            system=PLANNER_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw_json = resp.content.text

    else:
        raise ValueError(f"Unknown LLM_PROVIDER: {provider}")

    parsed = json.loads(raw_json)
    nodes = [DagNode(**n) for n in parsed.get("dag", [])]
    suggestions = parsed.get("suggestions", [])
    return PlanResponse(dag=nodes, suggestions=suggestions)


# ════════════════════════════════════════════════════════════════════
# Executor Agent
# ════════════════════════════════════════════════════════════════════

async def executor_agent(run_id: str, workflow_id: str, mode: str):
    """
    Runs the workflow DAG:
    - Topological ordering with parallel execution where safe
    - Configurable retries with exponential backoff
    - Policy checks before every MCP call
    - Pauses on approval_gate nodes and waits for human decision
    - Streams all events via WebSocket
    """
    dry_run = (mode == "dry-run")

    # Load workflow DAG
    wf = supabase.table("workflows").select("dag_json").eq("id", workflow_id).single().execute().data
    nodes = [DagNode(**n) for n in wf["dag_json"]]
    nodes_by_id = {n.id: n for n in nodes}

    completed: set = set()
    failed: set = set()
    paused_for_approval: set = set()
    context: Dict[str, Any] = {}   # stores output of each completed node

    # Mark run as running
    supabase.table("workflow_runs").update({"status": "running", "started_at": datetime.utcnow().isoformat()}).eq("id", run_id).execute()
    await broadcast(run_id, {"type": "run_started", "run_id": run_id})
    await log_event(run_id, f"Run {run_id} started (mode={mode})")

    max_idle_loops = 60   # timeout guard
    idle_count = 0

    while len(completed) + len(failed) < len(nodes):
        progress_made = False

        for node in nodes:
            nid = node.id
            if nid in completed or nid in failed or nid in paused_for_approval:
                continue
            # Wait for all dependencies
            if any(dep not in completed for dep in node.depends_on):
                continue
            # Stop if any dependency failed
            if any(dep in failed for dep in node.depends_on):
                failed.add(nid)
                await log_event(run_id, f"Node {nid} skipped — dependency failed", level="warning")
                continue

            # ── Approval gate ────────────────────────────────────────
            if node.approval_required:
                # Check if approval already exists
                existing = supabase.table("approvals").select("status").eq("run_id", run_id).eq("node_id", nid).execute().data
                if existing:
                    status = existing["status"]
                    if status == "approved":
                        await log_event(run_id, f"Node {nid} approved — proceeding")
                        # Don't skip execution — fall through to MCP call below
                    elif status == "rejected":
                        failed.add(nid)
                        await log_event(run_id, f"Node {nid} rejected by human", level="error")
                        continue
                    else:
                        paused_for_approval.add(nid)
                        continue
                else:
                    # Create approval request
                    step_row = supabase.table("workflow_run_steps").select("id").eq("run_id", run_id).eq("node_id", nid).execute().data
                    step_id = step_row["id"] if step_row else None
                    supabase.table("approvals").insert({
                        "run_id": run_id,
                        "run_step_id": step_id,
                        "node_id": nid,
                        "status": "pending",
                    }).execute()
                    paused_for_approval.add(nid)
                    supabase.table("workflow_runs").update({"status": "paused"}).eq("id", run_id).execute()
                    await broadcast(run_id, {"type": "approval_requested", "node_id": nid})
                    await log_event(run_id, f"Approval requested for node {nid}")
                    progress_made = True
                    continue

            # ── Policy check ─────────────────────────────────────────
            violation = check_policies(node.mcp_server, node.tool, node.params)
            if violation:
                failed.add(nid)
                await log_event(run_id, f"Policy blocked {nid}: {violation}", level="error")
                continue

            # ── Execute with retries ──────────────────────────────────
            # Create or update step record
            supabase.table("workflow_run_steps").upsert({
                "run_id": run_id,
                "node_id": nid,
                "name": node.tool,
                "type": "mcp_tool",
                "status": "running",
                "max_attempts": node.max_attempts,
                "started_at": datetime.utcnow().isoformat(),
            }, on_conflict="run_id,node_id").execute()

            await broadcast(run_id, {"type": "step_started", "node_id": nid})

            success = False
            for attempt in range(1, node.max_attempts + 1):
                try:
                    await log_event(run_id, f"Executing {nid} via {node.mcp_server}.{node.tool} (attempt {attempt}/{node.max_attempts})")
                    result = await call_mcp_tool(node.mcp_server, node.tool, node.params, dry_run)
                    context[nid] = result
                    completed.add(nid)

                    supabase.table("workflow_run_steps").update({
                        "status": "success",
                        "output_json": result,
                        "attempt": attempt,
                        "finished_at": datetime.utcnow().isoformat(),
                    }).eq("run_id", run_id).eq("node_id", nid).execute()

                    await broadcast(run_id, {"type": "step_completed", "node_id": nid, "result": result})
                    await log_event(run_id, f"Node {nid} completed successfully")
                    progress_made = True
                    success = True
                    break

                except Exception as ex:
                    await log_event(run_id, f"Node {nid} attempt {attempt} failed: {ex}", level="error")
                    if attempt < node.max_attempts:
                        backoff = 2 ** attempt
                        await log_event(run_id, f"Retrying {nid} in {backoff}s…")
                        await asyncio.sleep(backoff)

            if not success:
                failed.add(nid)
                supabase.table("workflow_run_steps").update({
                    "status": "failed",
                    "error_json": {"message": f"Failed after {node.max_attempts} attempts"},
                    "finished_at": datetime.utcnow().isoformat(),
                }).eq("run_id", run_id).eq("node_id", nid).execute()
                await broadcast(run_id, {"type": "step_failed", "node_id": nid})

        if not progress_made:
            idle_count += 1
            if idle_count >= max_idle_loops:
                await log_event(run_id, "Execution timed out waiting for approvals or dependencies.", level="error")
                break
            await asyncio.sleep(2)
        else:
            idle_count = 0

    final_status = "success" if not failed else "failed"
    supabase.table("workflow_runs").update({
        "status": final_status,
        "finished_at": datetime.utcnow().isoformat(),
    }).eq("id", run_id).execute()
    await broadcast(run_id, {"type": "run_completed", "status": final_status})
    await log_event(run_id, f"Run finished with status: {final_status}")


# ════════════════════════════════════════════════════════════════════
# Learning Agent
# ════════════════════════════════════════════════════════════════════

def learning_agent(workflow_id: str, owner_id: str):
    """
    Mines past run logs to produce improvement suggestions:
    - Identifies high-failure nodes
    - Suggests increasing retries or adding validation steps
    - Stores suggestions in workflow_suggestions table
    """
    logs = supabase.table("run_logs") \
        .select("message, run_id") \
        .ilike("message", "%failed%") \
        .execute().data

    failure_counts: Dict[str, int] = {}
    for log in logs:
        msg = log.get("message", "")
        parts = msg.split()
        # Expect log format: "Node <id> attempt N failed: ..."
        if "Node" in parts and "failed" in parts:
            try:
                nid = parts[parts.index("Node") + 1]
                failure_counts[nid] = failure_counts.get(nid, 0) + 1
            except IndexError:
                pass

    suggestions = []
    for nid, count in failure_counts.items():
        if count >= 2:
            suggestions.append(
                f"Node '{nid}' has failed {count} times. Consider increasing max_attempts, "
                f"adding a validation step before it, or reviewing its parameters."
            )

    if suggestions:
        supabase.table("workflow_suggestions").insert({
            "workflow_id": workflow_id,
            "owner_id": owner_id,
            "workflow_name": "AUTO",
            "description": "Learning Agent suggestions from run history",
            "suggestions": suggestions,
            "suggestion_type": "improvement",
        }).execute()

    return suggestions


# ════════════════════════════════════════════════════════════════════
# FastAPI Routes
# ════════════════════════════════════════════════════════════════════

@app.post("/plan", response_model=PlanResponse)
async def plan_workflow(req: PlanRequest):
    """Planner Agent: converts NL description → DAG."""
    plan = await planner_agent(req)

    # Store suggestions for learning
    supabase.table("workflow_suggestions").insert({
        "owner_id": req.owner_id,
        "workflow_name": req.name,
        "description": req.description,
        "dag_json": [n.dict() for n in plan.dag],
        "suggestions": plan.suggestions,
        "suggestion_type": "template",
    }).execute()

    return plan


@app.post("/execute")
async def execute_workflow(req: ExecuteRequest):
    """Executor Agent: starts DAG execution in a background task."""
    supabase.table("workflow_runs") \
        .update({"status": "running"}) \
        .eq("id", req.run_id).execute()

    asyncio.create_task(executor_agent(req.run_id, req.workflow_id, req.mode))
    return {"status": "started", "run_id": req.run_id}


@app.post("/approval-callback")
async def approval_callback(req: ApprovalCallbackRequest):
    """
    Called by Node backend after a human approves/rejects a gate.
    Executor agent loop will detect the updated approval status on next iteration.
    """
    # Un-pause the node so the executor loop processes it again
    paused = run_clients.get(req.run_id)  # clients are still connected
    await broadcast(req.run_id, {
        "type": "approval_resolved",
        "node_id": req.node_id,
        "decision": req.decision,
    })
    return {"ok": True}


@app.post("/learn")
async def trigger_learning(body: Dict[str, str]):
    """Manually trigger Learning Agent for a workflow."""
    suggestions = learning_agent(body.get("workflow_id", ""), body.get("owner_id", ""))
    return {"suggestions": suggestions}


@app.get("/health")
async def health():
    return {"status": "ok"}


# ════════════════════════════════════════════════════════════════════
# WebSocket — Real-Time Dashboard
# ════════════════════════════════════════════════════════════════════

@app.websocket("/ws/runs/{run_id}")
async def run_websocket(websocket: WebSocket, run_id: str):
    """
    React dashboard connects here to get live run events.
    Events include: run_started, step_started, step_completed,
    step_failed, approval_requested, approval_resolved, run_completed, log.
    """
    await websocket.accept()
    run_clients[run_id].add(websocket)

    # Send existing logs on connect so the dashboard catches up
    existing_logs = supabase.table("run_logs") \
        .select("*") \
        .eq("run_id", run_id) \
        .order("timestamp", ascending=True).execute().data
    for log_row in existing_logs:
        await websocket.send_json({"type": "log", **log_row})

    try:
        while True:
            # Keep connection alive — client can send pings
            await websocket.receive_text()
    except WebSocketDisconnect:
        run_clients[run_id].discard(websocket)
