# orchestrator/agents/monitor.py
from collections import defaultdict
from typing import Dict, Any
from fastapi import WebSocket
from datetime import datetime, timezone
from config import supabase

run_clients: Dict[str, set] = defaultdict(set)

async def broadcast(run_id: str, payload: Dict[str, Any]):
    dead = set()
    for ws in list(run_clients[run_id]):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.add(ws)
    run_clients[run_id] -= dead

async def log_event(run_id: str, message: str, level: str = "info"):
    ts = datetime.now(timezone.utc).isoformat()
    try:
        supabase.table("run_logs").insert({
            "run_id":    run_id,
            "level":     level,
            "message":   message,
            "timestamp": ts,
        }).execute()
    except Exception as e:
        print(f"[monitor] DB log error: {e}")
    await broadcast(run_id, {
        "type":      "log",
        "level":     level,
        "message":   message,
        "timestamp": ts,
    })

async def register_ws(run_id: str, ws: WebSocket):
    await ws.accept()
    run_clients[run_id].add(ws)

def unregister_ws(run_id: str, ws: WebSocket):
    run_clients[run_id].discard(ws)