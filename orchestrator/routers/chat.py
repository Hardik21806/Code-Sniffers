# orchestrator/routers/chat.py
import os
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Any, Dict, Optional

router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    owner_id: Optional[str] = None
    context: Dict[str, Any] = {}

@router.post("/chat")
async def chat(req: ChatRequest):
    try:
        from openai import OpenAI
        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        ctx = req.context
        system = f"""You are Dhaaga Assistant, a helpful AI for an agentic workflow orchestration system.
User context: They have {ctx.get('total_runs', 0)} total workflow runs.
Recent runs: {ctx.get('recent', [])}
Answer concisely in 1-3 sentences. Be friendly and helpful."""

        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system",  "content": system},
                {"role": "user",    "content": req.message},
            ],
            max_tokens=200,
            temperature=0.5,
        )
        return {"reply": response.choices.message.content.strip()}
    except Exception as e:
        return {"reply": f"I can see you have {req.context.get('total_runs', 0)} workflow runs. Ask me about their status!"}