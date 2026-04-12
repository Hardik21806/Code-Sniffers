# orchestrator/main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from routers import plan, execute, approval
from agents.monitor import register_ws, unregister_ws
from agents.learning import run_learning_agent
from config import ORCHESTRATOR_PORT
import uvicorn
from routers import plan, execute, approval, chat   # add chat


app = FastAPI(title="Agentic MCP Orchestrator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(plan.router)
app.include_router(execute.router)
app.include_router(approval.router)
app.include_router(chat.router)   # add this line

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/learning")
async def learning(owner_id: str = "global"):
    return run_learning_agent(owner_id)

@app.websocket("/ws/runs/{run_id}")
async def websocket_run(websocket: WebSocket, run_id: str):
    await register_ws(run_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        unregister_ws(run_id, websocket)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=ORCHESTRATOR_PORT, reload=True)