# orchestrator/mcp/servers.py
import json, os

_SERVERS = None

def get_servers() -> dict:
    global _SERVERS
    if _SERVERS is None:
        path = os.path.join(os.path.dirname(__file__), "../../mcp_servers.json")
        try:
            with open(path) as f:
                _SERVERS = json.load(f)
        except Exception:
            _SERVERS = {
                "jira-server":   {"transport": "mock", "baseUrl": ""},
                "github-server": {"transport": "mock", "baseUrl": ""},
                "slack-server":  {"transport": "mock", "baseUrl": ""},
                "sheets-server": {"transport": "mock", "baseUrl": ""},
            }
    return _SERVERS