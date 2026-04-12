# orchestrator/models.py
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class DagNode(BaseModel):
    id: str
    type: str
    mcp_server: str
    tool: str
    params: Dict[str, Any] = {}
    depends_on: List[str] = []
    approval_required: bool = False

class WorkflowPlanRequest(BaseModel):
    name: str
    description: str
    owner_id: str

class WorkflowPlanResponse(BaseModel):
    dag: List[DagNode]
    suggestions: List[str] = []

class ExecuteRequest(BaseModel):
    run_id: str
    workflow_id: str
    dag: List[Dict[str, Any]]
    dry_run: bool = True
    input_payload: Dict[str, Any] = {}

class ApprovalCallbackRequest(BaseModel):
    run_id: str
    node_id: Optional[str] = None
    decision: Optional[str] = "approved"