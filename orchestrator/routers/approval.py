# orchestrator/routers/approval.py
from fastapi import APIRouter
from models import ApprovalCallbackRequest
from agents.executor import resolve_approval
from agents.monitor import broadcast
from config import supabase
from datetime import datetime, timezone

router = APIRouter()

@router.post("/approval-callback")
async def approval_callback(req: ApprovalCallbackRequest):
    try:
        supabase.table("approvals") \
            .update({
                "status":     req.decision or "approved",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }) \
            .eq("run_id", req.run_id) \
            .eq("status", "pending") \
            .execute()
    except Exception as e:
        print(f"[approval] DB error: {e}")

    resolve_approval(req.run_id)
    await broadcast(req.run_id, {"type": "approval_resolved", "decision": req.decision})
    return {"ok": True}