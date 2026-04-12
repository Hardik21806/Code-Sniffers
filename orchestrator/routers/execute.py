# orchestrator/routers/execute.py
import asyncio
from fastapi import APIRouter
from models import ExecuteRequest, DagNode
from agents.executor import run_executor

router = APIRouter()

@router.post("/execute")
async def execute(req: ExecuteRequest):
    nodes = [DagNode(**n) for n in req.dag]
    asyncio.create_task(run_executor(req.run_id, nodes, req.dry_run))
    return {"status": "started", "run_id": req.run_id, "nodes": len(nodes), "dry_run": req.dry_run}