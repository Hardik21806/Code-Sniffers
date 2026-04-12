# orchestrator/agents/planner.py
import os, json, re
from openai import OpenAI
from models import DagNode, WorkflowPlanRequest, WorkflowPlanResponse
from config import supabase
from datetime import datetime, timezone

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))

SYSTEM_PROMPT = """
You are a workflow planner for an Agentic MCP Gateway called Dhaaga.
Convert the natural language workflow description into a JSON object.

Return ONLY this exact JSON structure, no commentary, no markdown:
{
  "nodes": [
    {
      "id": "snake_case_name",
      "type": "trigger|action|notify|utility",
      "mcp_server": "jira-server|github-server|slack-server|sheets-server",
      "tool": "toolName",
      "params": {},
      "depends_on": [],
      "approval_required": false
    }
  ],
  "suggestions": ["tip1", "tip2"]
}

Rules:
- id must be snake_case
- type: trigger (first step), action (code/devops), notify (messaging), utility (data/sheets)
- mcp_server: pick the most relevant from [jira-server, github-server, slack-server, sheets-server]
- approval_required: true ONLY for Slack messages or production deployments
- depends_on: list previous step ids in order
- suggestions: 2-3 actionable improvement tips
"""

def _fallback_dag() -> dict:
    return {
        "nodes": [
            {"id": "watch_jira",    "type": "trigger", "mcp_server": "jira-server",   "tool": "watchCriticalBugs", "params": {"project_key": "PROJ"}, "depends_on": [], "approval_required": False},
            {"id": "create_branch", "type": "action",  "mcp_server": "github-server", "tool": "createBranch",      "params": {"template": "bugfix/{issue_key}"}, "depends_on": ["watch_jira"], "approval_required": False},
            {"id": "notify_slack",  "type": "notify",  "mcp_server": "slack-server",  "tool": "sendMessage",       "params": {"channel": "#oncall"}, "depends_on": ["create_branch"], "approval_required": True},
            {"id": "update_sheet",  "type": "utility", "mcp_server": "sheets-server", "tool": "appendRow",         "params": {"sheet": "Incidents"}, "depends_on": ["notify_slack"], "approval_required": False},
        ],
        "suggestions": [
            "Add a dry-run step before GitHub branch creation.",
            "Add SLA tracking to the Sheets step.",
        ]
    }

async def run_planner(req: WorkflowPlanRequest) -> WorkflowPlanResponse:
    raw = None

    # Try real LLM first
    if os.environ.get("OPENAI_API_KEY"):
        try:
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": f"Workflow name: {req.name}\n\nDescription: {req.description}"}
                ],
                temperature=0.3,
                max_tokens=1200,
            )
            text = response.choices[0].message.content.strip()
            # Strip markdown if model wraps in ```json
            text = re.sub(r"^```json\s*", "", text)
            text = re.sub(r"\s*```$",    "", text)
            raw  = json.loads(text)
        except Exception as e:
            print(f"[planner] LLM error, using fallback: {e}")
            raw = _fallback_dag()
    else:
        print("[planner] No OPENAI_API_KEY, using fallback DAG")
        raw = _fallback_dag()

    nodes = [DagNode(**n) for n in raw["nodes"]]

    # State update: persist plan with LLM-generated content
    try:
        supabase.table("workflow_suggestions").insert({
            "owner_id":      req.owner_id,
            "workflow_name": req.name,
            "description":   req.description,
            "dag_json":      [n.dict() for n in nodes],
            "suggestions":   raw.get("suggestions", []),
            "created_at":    datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception as e:
        print(f"[planner] Supabase error: {e}")

    return WorkflowPlanResponse(dag=nodes, suggestions=raw.get("suggestions", []))