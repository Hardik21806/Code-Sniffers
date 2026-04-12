# orchestrator/agents/executor.py
import asyncio
from typing import List, Dict, Any
from datetime import datetime, timezone
from models import DagNode
from mcp.client import call_mcp_tool
from agents.monitor import log_event, broadcast
from config import supabase

# Stores pending approval signals: run_id → asyncio.Event
_approval_events: Dict[str, asyncio.Event] = {}

def get_approval_event(run_id: str) -> asyncio.Event:
    if run_id not in _approval_events:
        _approval_events[run_id] = asyncio.Event()
    return _approval_events[run_id]

def resolve_approval(run_id: str):
    if run_id in _approval_events:
        _approval_events[run_id].set()

async def run_executor(run_id: str, nodes: List[DagNode], dry_run: bool = True):
    ts = datetime.now(timezone.utc).isoformat()

    # Create run row in Supabase
    try:
        supabase.table("workflow_runs").insert({
            "id":         run_id,
            "workflow_id": run_id,
            "status":     "running",
            "mode":       "dry-run" if dry_run else "live",
            "started_at": ts,
            "created_at": ts,
        }).execute()
    except Exception as e:
        print(f"[executor] run insert error: {e}")

    await log_event(run_id, f"🚀 Run started | nodes={len(nodes)} dry_run={dry_run}")

    completed: set = set()
    failed:    set = set()

    while len(completed) + len(failed) < len(nodes):
        progressed = False

        for node in nodes:
            nid = node.id
            if nid in completed or nid in failed:
                continue
            if any(dep not in completed for dep in node.depends_on):
                continue

            # Approval gate
            if node.approval_required:
                await log_event(run_id, f"⏸ Approval requested for '{nid}' — execution paused")
                await broadcast(run_id, {"type": "approval_requested", "node_id": nid})

                # Create approval row
                try:
                    supabase.table("approvals").insert({
                        "run_id":  run_id,
                        "node_id": nid,
                        "status":  "pending",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }).execute()
                except Exception as e:
                    print(f"[executor] approval insert error: {e}")

                # Update run status to paused
                supabase.table("workflow_runs").update({"status": "paused"}).eq("id", run_id).execute()

                # Wait for approval signal (timeout 10 min)
                event = get_approval_event(run_id)
                event.clear()
                try:
                    await asyncio.wait_for(event.wait(), timeout=600)
                except asyncio.TimeoutError:
                    await log_event(run_id, f"⏱ Approval timeout for '{nid}'", level="error")
                    failed.add(nid)
                    continue

                # Check decision
                try:
                    approval = supabase.table("approvals") \
                        .select("*").eq("run_id", run_id).eq("node_id", nid) \
                        .order("created_at", desc=True).limit(1).execute().data
                    if approval and approval[0].get("status") == "rejected":
                        await log_event(run_id, f"❌ Node '{nid}' rejected by approver", level="error")
                        failed.add(nid)
                        supabase.table("workflow_runs").update({"status": "failed"}).eq("id", run_id).execute()
                        return
                except Exception:
                    pass

                await log_event(run_id, f"👍 Node '{nid}' approved — proceeding")
                supabase.table("workflow_runs").update({"status": "running"}).eq("id", run_id).execute()

            # Execute with retries
            max_retries = 3
            for attempt in range(1, max_retries + 1):
                try:
                    await log_event(run_id, f"▶ {nid} → {node.mcp_server}.{node.tool} (attempt {attempt}/{max_retries})")
                    if not dry_run:
                        result = await call_mcp_tool(node.mcp_server, node.tool, node.params)
                    else:
                        await asyncio.sleep(0.4)
                        result = {"ok": True, "dry_run": True}

                    # Save step result
                    try:
                        supabase.table("workflow_run_steps").insert({
                            "run_id":    run_id,
                            "node_id":   nid,
                            "status":    "success",
                            "result_json": result,
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }).execute()
                    except Exception:
                        pass

                    completed.add(nid)
                    await log_event(run_id, f"✅ Node '{nid}' completed")
                    await broadcast(run_id, {"type": "node_completed", "node_id": nid})
                    progressed = True
                    break

                except Exception as e:
                    await log_event(run_id, f"⚠ Node '{nid}' error (attempt {attempt}): {e}", level="error")
                    if attempt == max_retries:
                        failed.add(nid)
                        await broadcast(run_id, {"type": "node_failed", "node_id": nid, "error": str(e)})
                    else:
                        await asyncio.sleep(2 ** attempt)

        if not progressed:
            await asyncio.sleep(1)

    status = "success" if not failed else "failed"
    emoji  = "✅" if status == "success" else "❌"
    supabase.table("workflow_runs").update({
        "status":      status,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", run_id).execute()

    await log_event(run_id, f"{'🏁'} Run finished — {status} {emoji}{len(completed)} ❌{len(failed)}")
    await broadcast(run_id, {"type": "run_completed", "status": status})