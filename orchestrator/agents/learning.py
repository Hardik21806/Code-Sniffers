# orchestrator/agents/learning.py
from config import supabase

def run_learning_agent(owner_id: str = "global") -> dict:
    try:
        logs = supabase.table("run_logs").select("*").eq("level", "error").execute().data or []
    except Exception:
        return {"suggestions": []}

    stats: dict = {}
    for log in logs:
        msg = log.get("message", "")
        if "Node" in msg and ("error" in msg or "failed" in msg):
            parts = msg.split()
            for i, p in enumerate(parts):
                if p == "Node" and i + 1 < len(parts):
                    nid = parts[i + 1].strip("'")
                    stats[nid] = stats.get(nid, 0) + 1

    suggestions = []
    for nid, count in stats.items():
        if count >= 2:
            suggestions.append(
                f"Node '{nid}' has failed {count} times. Consider increasing retries or adding a pre-validation step."
            )

    if suggestions:
        try:
            supabase.table("workflow_suggestions").insert({
                "owner_id":      owner_id,
                "workflow_name": "LEARNING_AGENT",
                "description":   "Auto-generated improvements",
                "dag_json":      [],
                "suggestions":   suggestions,
            }).execute()
        except Exception:
            pass

    return {"suggestions": suggestions}