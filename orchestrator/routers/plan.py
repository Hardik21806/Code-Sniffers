# orchestrator/routers/plan.py
from fastapi import APIRouter
from models import WorkflowPlanRequest, WorkflowPlanResponse
from agents.planner import run_planner

router = APIRouter()

@router.post("/plan", response_model=WorkflowPlanResponse)
async def plan(req: WorkflowPlanRequest):
    return await run_planner(req)