# orchestrator/mcp/client.py
import asyncio
from typing import Any, Dict
from .servers import get_servers

async def call_mcp_tool(server_name: str, tool: str, params: Dict[str, Any]) -> Dict[str, Any]:
    servers = get_servers()
    server  = servers.get(server_name, {})
    transport = server.get("transport", "mock")

    if transport == "mock":
        # Simulate latency + success
        await asyncio.sleep(0.3)
        return {
            "ok": True,
            "server": server_name,
            "tool": tool,
            "params": params,
            "result": f"[mock] {tool} executed successfully",
        }

    # Real HTTP+SSE MCP call (fill in when connecting real servers)
    raise NotImplementedError(f"Transport '{transport}' not yet implemented for {server_name}")