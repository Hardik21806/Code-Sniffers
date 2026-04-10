# Frontend App (React + Vite + JSX)

Tech Stack: **React 18**, **Vite**, **React Router v6**, **ReactFlow** (DAG canvas),
**Axios**, **Supabase JS client** (Realtime for live updates)

---

## File Structure

```
frontend/
├── .env.local.example        ← copy to .env.local, never commit the real one
├── .env.local                ← git-ignored; holds your real secrets
├── package.json
└── src/
    ├── main.jsx
    ├── App.jsx
    └── components/
        ├── WorkflowBuilder.jsx
        ├── RunDashboard.jsx
        └── ApprovalsPanel.jsx
```

---

## File: `frontend/.env.local.example`

```env
# Copy this file to .env.local and fill in your values.
# NEVER commit .env.local to version control.

# Node.js backend URL (Express API)
VITE_API_BASE=http://localhost:4000

# Python MCP Orchestrator URL (FastAPI — for WebSocket)
VITE_ORCH_WS_BASE=ws://localhost:8000

# Supabase (public anon key — safe for browser)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

---

## File: `frontend/package.json`

```json
{
  "name": "agentic-mcp-gateway-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev":     "vite",
    "build":   "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.43.1",
    "@xyflow/react":         "^12.0.0",
    "axios":                 "^1.6.8",
    "react":                 "^18.3.1",
    "react-dom":             "^18.3.1",
    "react-router-dom":      "^6.23.0"
  },
  "devDependencies": {
    "@types/react":          "^18.3.3",
    "@types/react-dom":      "^18.3.0",
    "@vitejs/plugin-react":  "^4.3.0",
    "vite":                  "^5.2.11"
  }
}
```

---

## File: `frontend/src/main.jsx`

```jsx
// frontend/src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

---

## File: `frontend/src/App.jsx`

```jsx
// frontend/src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import WorkflowBuilder from './components/WorkflowBuilder.jsx';
import RunDashboard    from './components/RunDashboard.jsx';
import ApprovalsPanel  from './components/ApprovalsPanel.jsx';
import '@xyflow/react/dist/style.css';

export default function App() {
  return (
    <Router>
      <div style={styles.app}>
        {/* ── Top navigation bar ── */}
        <nav style={styles.nav}>
          <span style={styles.brand}>⚡ MCP Gateway</span>
          <div style={styles.navLinks}>
            <NavLink
              to="/"
              end
              style={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}
            >
              Workflow Builder
            </NavLink>
            <NavLink
              to="/approvals"
              style={({ isActive }) => isActive ? styles.navLinkActive : styles.navLink}
            >
              Approvals
            </NavLink>
          </div>
        </nav>

        {/* ── Page content ── */}
        <main style={styles.main}>
          <Routes>
            <Route path="/"                element={<WorkflowBuilder />} />
            <Route path="/runs/:runId"     element={<RunDashboard />} />
            <Route path="/approvals"       element={<ApprovalsPanel />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

const styles = {
  app: {
    display: 'flex', flexDirection: 'column',
    minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif',
    background: '#f7f6f2', color: '#28251d',
  },
  nav: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 24px', height: 56,
    background: '#fff', borderBottom: '1px solid #dcd9d5',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  brand:         { fontWeight: 700, fontSize: 18, color: '#01696f' },
  navLinks:      { display: 'flex', gap: 8 },
  navLink:       { padding: '6px 14px', borderRadius: 6, color: '#7a7974',
                   textDecoration: 'none', fontSize: 14, fontWeight: 500 },
  navLinkActive: { padding: '6px 14px', borderRadius: 6, background: '#cedcd8',
                   color: '#01696f', textDecoration: 'none',
                   fontSize: 14, fontWeight: 600 },
  main:          { flex: 1, padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' },
};
```

---

## File: `frontend/src/components/WorkflowBuilder.jsx`

```jsx
// frontend/src/components/WorkflowBuilder.jsx
// Visual Workflow Builder:
//   1. User enters a natural-language workflow description.
//   2. POST /api/workflows/plan → Node backend → Python Planner Agent.
//   3. Response DAG is rendered as an interactive ReactFlow canvas.
//   4. User can optionally edit node positions, then click Execute.
//   5. POST /api/workflows/:id/execute → starts a run; redirects to RunDashboard.

import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a flat DAG node list from the Planner API into ReactFlow nodes + edges.
 * Positions are auto-distributed in a vertical cascade.
 */
function dagToFlow(dagNodes) {
  const rfNodes = dagNodes.map((n, i) => ({
    id:       n.id,
    type:     'default',
    position: { x: (i % 3) * 280, y: Math.floor(i / 3) * 160 },
    data: {
      label: (
        <div>
          <strong style={{ fontSize: 13 }}>{n.id}</strong>
          <br />
          <span style={{ fontSize: 11, color: '#7a7974' }}>
            {n.mcp_server} → {n.tool}
          </span>
          {n.approval_required && (
            <span style={{
              display: 'inline-block', marginTop: 4,
              background: '#fbecb4', color: '#8a5b00',
              borderRadius: 4, padding: '1px 6px', fontSize: 10,
            }}>
              🔐 Needs Approval
            </span>
          )}
        </div>
      ),
    },
    style: {
      background: n.approval_required ? '#fff8e1' : '#fff',
      border: `1px solid ${n.approval_required ? '#d19900' : '#dcd9d5'}`,
      borderRadius: 8,
      padding: 10,
      minWidth: 200,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    },
  }));

  const rfEdges = [];
  dagNodes.forEach(n => {
    (n.depends_on || []).forEach(dep => {
      rfEdges.push({
        id:           `${dep}->${n.id}`,
        source:       dep,
        target:       n.id,
        markerEnd:    { type: MarkerType.ArrowClosed },
        style:        { stroke: '#01696f', strokeWidth: 2 },
        animated:     true,
      });
    });
  });

  return { rfNodes, rfEdges };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WorkflowBuilder() {
  const navigate = useNavigate();

  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [ownerId]                     = useState('demo-user');
  const [workflowId,  setWorkflowId]  = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [mode,        setMode]        = useState('live'); // 'live' | 'dry-run'

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const onConnect = useCallback(
    params => setRfEdges(eds => addEdge({ ...params, animated: true }, eds)),
    [setRfEdges]
  );

  // ── 1. Plan: NL description → DAG ─────────────────────────────────────────
  const handlePlan = async () => {
    if (!name.trim() || !description.trim()) {
      setError('Please enter both a workflow name and description.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { data } = await axios.post(`${API_BASE}/api/workflows/plan`, {
        name,
        description,
        owner_id: ownerId,
      });

      // data.workflow is the saved row; data.dag is the node list
      setWorkflowId(data.workflow.id);
      setSuggestions(data.suggestions || []);

      const { rfNodes: nodes, rfEdges: edges } = dagToFlow(data.dag);
      setRfNodes(nodes);
      setRfEdges(edges);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── 2. Execute: start a run and navigate to the live dashboard ────────────
  const handleExecute = async () => {
    if (!workflowId) {
      setError('Please plan a workflow first.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { data } = await axios.post(
        `${API_BASE}/api/workflows/${workflowId}/execute`,
        { input_context: {}, mode }
      );
      navigate(`/runs/${data.run.id}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <h1 style={s.h1}>Workflow Builder</h1>
      <p style={s.subtitle}>
        Describe your workflow in plain English — the AI Planner will build the execution DAG.
      </p>

      {/* ── Input panel ── */}
      <div style={s.card}>
        <div style={s.row}>
          <div style={{ flex: 1 }}>
            <label style={s.label}>Workflow Name</label>
            <input
              style={s.input}
              placeholder="e.g. Critical Bug Triage"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div style={{ flex: 2 }}>
            <label style={s.label}>Natural Language Description</label>
            <textarea
              style={{ ...s.input, minHeight: 72, resize: 'vertical' }}
              placeholder={
                'e.g. When a critical bug is filed in Jira, create a GitHub branch, ' +
                'notify on-call in Slack, and update the incident tracker sheet.'
              }
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        </div>

        {error && <p style={s.error}>{error}</p>}

        <div style={s.actions}>
          <button style={s.btnPrimary} onClick={handlePlan} disabled={loading}>
            {loading ? '⏳ Planning…' : '🧠 Plan Workflow'}
          </button>

          {rfNodes.length > 0 && (
            <>
              <select
                style={s.select}
                value={mode}
                onChange={e => setMode(e.target.value)}
              >
                <option value="live">🚀 Live Run</option>
                <option value="dry-run">🔵 Dry-Run (Simulation)</option>
              </select>
              <button style={s.btnSuccess} onClick={handleExecute} disabled={loading}>
                {loading ? '⏳ Starting…' : '▶ Execute Workflow'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── ReactFlow DAG canvas ── */}
      {rfNodes.length > 0 && (
        <div style={s.card}>
          <h2 style={s.h2}>Visual DAG</h2>
          <p style={s.hint}>
            Drag nodes to rearrange. Connect nodes to add dependencies.
            Yellow nodes require a human approval before they execute.
          </p>
          <div style={{ height: 480, border: '1px solid #dcd9d5', borderRadius: 8 }}>
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              fitView
            >
              <MiniMap  nodeStrokeColor="#01696f" nodeColor="#cedcd8" />
              <Controls />
              <Background variant="dots" gap={16} color="#dcd9d5" />
            </ReactFlow>
          </div>
        </div>
      )}

      {/* ── Learning Agent suggestions ── */}
      {suggestions.length > 0 && (
        <div style={{ ...s.card, background: '#f0f8f7', border: '1px solid #cedcd8' }}>
          <h3 style={{ ...s.h2, color: '#01696f' }}>💡 AI Suggestions</h3>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {suggestions.map((sug, i) => (
              <li key={i} style={{ marginBottom: 6, fontSize: 14, color: '#3b5c5e' }}>
                {sug}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Inline styles (swap for Tailwind or CSS modules in production) ─────────

const s = {
  h1:       { fontSize: 24, fontWeight: 700, marginBottom: 4, color: '#28251d' },
  h2:       { fontSize: 17, fontWeight: 600, marginBottom: 8, color: '#28251d' },
  subtitle: { fontSize: 14, color: '#7a7974', marginBottom: 20 },
  card:     {
    background: '#fff', borderRadius: 10, border: '1px solid #dcd9d5',
    padding: 20, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  row:    { display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' },
  label:  { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4, color: '#28251d' },
  input:  {
    width: '100%', padding: '8px 12px', borderRadius: 6,
    border: '1px solid #dcd9d5', fontSize: 14, color: '#28251d',
    background: '#fafaf8', outline: 'none', boxSizing: 'border-box',
  },
  actions:   { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' },
  btnPrimary: {
    padding: '9px 20px', borderRadius: 6, border: 'none',
    background: '#01696f', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
  },
  btnSuccess: {
    padding: '9px 20px', borderRadius: 6, border: 'none',
    background: '#437a22', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
  },
  select: {
    padding: '8px 12px', borderRadius: 6,
    border: '1px solid #dcd9d5', fontSize: 14, background: '#fafaf8', cursor: 'pointer',
  },
  hint:  { fontSize: 12, color: '#7a7974', marginBottom: 8 },
  error: { color: '#a12c7b', fontSize: 13, marginTop: 8 },
};
```

---

## File: `frontend/src/components/RunDashboard.jsx`

```jsx
// frontend/src/components/RunDashboard.jsx
// Real-Time Run Dashboard:
//   - Loads initial logs from Node backend (GET /api/logs/run/:runId).
//   - Opens a WebSocket to the Python FastAPI orchestrator (/ws/runs/:runId).
//   - Receives live events: { type: "log" | "node_status" | "run_completed", ... }
//   - Renders per-step status badges and a scrollable live log area.
//   - Polls /api/workflows/:workflowId/runs to show overall run metadata.

import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';

const API_BASE    = import.meta.env.VITE_API_BASE     || 'http://localhost:4000';
const ORCH_WS_BASE = import.meta.env.VITE_ORCH_WS_BASE || 'ws://localhost:8000';

// Status colour map
const STATUS_COLOR = {
  pending:          { bg: '#f3f0ec', color: '#7a7974' },
  running:          { bg: '#dbeafe', color: '#1e40af' },
  waiting_approval: { bg: '#fff8e1', color: '#8a5b00' },
  success:          { bg: '#d4dfcc', color: '#2e5c10' },
  failed:           { bg: '#e0ced7', color: '#7d1e5e' },
  skipped:          { bg: '#f3f0ec', color: '#bab9b4' },
};

function StatusBadge({ status }) {
  const style = STATUS_COLOR[status] || STATUS_COLOR.pending;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px',
      borderRadius: 99, fontSize: 12, fontWeight: 600,
      background: style.bg, color: style.color,
    }}>
      {status}
    </span>
  );
}

export default function RunDashboard() {
  const { runId } = useParams();

  const [logs,      setLogs]      = useState([]);   // {level, message, timestamp}
  const [steps,     setSteps]     = useState({});   // { nodeId: status }
  const [runStatus, setRunStatus] = useState('running');
  const [wsState,   setWsState]   = useState('connecting'); // 'connecting'|'open'|'closed'
  const logEndRef = useRef(null);

  // ── Scroll log area to bottom on new entries ────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ── WebSocket: live events from FastAPI orchestrator ────────────────────
  useEffect(() => {
    // Load initial logs from Node backend
    axios.get(`${API_BASE}/api/logs/run/${runId}`)
      .then(res => setLogs(res.data))
      .catch(console.error);

    const ws = new WebSocket(`${ORCH_WS_BASE}/ws/runs/${runId}`);

    ws.onopen = () => setWsState('open');

    ws.onmessage = event => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case 'log':
          setLogs(prev => [
            ...prev,
            { level: msg.level, message: msg.message, timestamp: new Date().toISOString() },
          ]);
          break;

        case 'node_status':
          // { type: "node_status", node_id: "step2", status: "success" }
          setSteps(prev => ({ ...prev, [msg.node_id]: msg.status }));
          break;

        case 'run_completed':
          setRunStatus(msg.status);
          ws.close();
          break;

        default:
          break;
      }
    };

    ws.onerror = err => {
      console.error('WebSocket error:', err);
      setWsState('closed');
    };

    ws.onclose = () => setWsState('closed');

    return () => ws.close();
  }, [runId]);

  // ── Render ───────────────────────────────────────────────────────────────
  const logLevelStyle = { info: '#28251d', warning: '#8a5b00', error: '#a12c7b' };

  return (
    <div>
      {/* ── Header ── */}
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>Run Dashboard</h1>
          <p style={s.subtitle}>Run ID: <code>{runId}</code></p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <StatusBadge status={runStatus} />
          <span style={{
            fontSize: 12, padding: '3px 10px', borderRadius: 99,
            background: wsState === 'open' ? '#d4dfcc' : '#f3f0ec',
            color: wsState === 'open' ? '#2e5c10' : '#7a7974',
          }}>
            WS: {wsState}
          </span>
          <Link to="/" style={s.backLink}>← Back to Builder</Link>
        </div>
      </div>

      {/* ── Step Status Cards ── */}
      {Object.keys(steps).length > 0 && (
        <div style={s.card}>
          <h2 style={s.h2}>Step Status</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(steps).map(([nodeId, status]) => (
              <div key={nodeId} style={{
                padding: '8px 14px', borderRadius: 8,
                border: '1px solid #dcd9d5', background: '#fafaf8', minWidth: 140,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{nodeId}</div>
                <StatusBadge status={status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Live Log Area ── */}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ ...s.h2, margin: 0 }}>Live Logs</h2>
          <span style={{ fontSize: 12, color: '#7a7974' }}>{logs.length} entries</span>
        </div>
        <div style={s.logBox}>
          {logs.length === 0 && (
            <span style={{ color: '#bab9b4', fontSize: 13 }}>Waiting for logs…</span>
          )}
          {logs.map((entry, i) => (
            <div key={i} style={{ marginBottom: 3, fontSize: 13, lineHeight: 1.5 }}>
              <span style={{ color: '#bab9b4', marginRight: 8, fontSize: 11 }}>
                {entry.timestamp
                  ? new Date(entry.timestamp).toLocaleTimeString()
                  : ''}
              </span>
              <span style={{
                fontWeight: 600, marginRight: 6,
                color: logLevelStyle[entry.level] || '#28251d',
              }}>
                [{entry.level?.toUpperCase()}]
              </span>
              <span style={{ color: '#3b3a38' }}>{entry.message}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* ── Completion Banner ── */}
      {runStatus !== 'running' && (
        <div style={{
          ...s.card,
          background: runStatus === 'success' ? '#d4dfcc' : '#e0ced7',
          border:     `1px solid ${runStatus === 'success' ? '#437a22' : '#a12c7b'}`,
          textAlign: 'center',
        }}>
          <p style={{ fontWeight: 700, fontSize: 16,
                      color: runStatus === 'success' ? '#2e5c10' : '#7d1e5e' }}>
            {runStatus === 'success' ? '✅ Workflow completed successfully!' : '❌ Workflow run failed.'}
          </p>
          <Link to="/" style={{ color: '#01696f', fontSize: 14 }}>Start a new workflow →</Link>
        </div>
      )}
    </div>
  );
}

const s = {
  h1:       { fontSize: 22, fontWeight: 700, color: '#28251d', marginBottom: 2 },
  h2:       { fontSize: 16, fontWeight: 600, color: '#28251d', marginBottom: 8 },
  subtitle: { fontSize: 13, color: '#7a7974' },
  header:   {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20,
  },
  card: {
    background: '#fff', borderRadius: 10, border: '1px solid #dcd9d5',
    padding: 20, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  logBox: {
    background: '#171614', borderRadius: 8, padding: '12px 16px',
    maxHeight: 420, overflowY: 'auto', fontFamily: 'monospace',
    border: '1px solid #262523',
  },
  backLink: {
    fontSize: 13, color: '#01696f', textDecoration: 'none',
    padding: '5px 12px', borderRadius: 6, border: '1px solid #cedcd8',
  },
};
```

---

## File: `frontend/src/components/ApprovalsPanel.jsx`

```jsx
// frontend/src/components/ApprovalsPanel.jsx
// Human-in-the-loop Approval Panel:
//   - Polls GET /api/approvals/pending every 5 seconds for pending approval gates.
//   - Shows each pending gate with run ID, node ID, and requested_at timestamp.
//   - User clicks Approve or Reject → POST /api/approvals/:id/decision.
//   - Node backend updates Supabase and calls /approval-callback on the orchestrator,
//     which resumes (or aborts) the paused executor.

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

// Optional: read user identity from env / auth context.
// For the demo we use a static string.
const APPROVER_ID = 'demo-user';

function ApprovalCard({ approval, onDecide }) {
  const [deciding, setDeciding]     = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [showReject, setShowReject] = useState(false);

  const handleApprove = async () => {
    setDeciding(true);
    await onDecide(approval.id, 'approved', 'Looks good ✓');
  };

  const handleReject = async () => {
    setDeciding(true);
    await onDecide(approval.id, 'rejected', rejectNote || 'Rejected by reviewer.');
  };

  return (
    <div style={s.approvalCard}>
      {/* ── Card header ── */}
      <div style={s.cardHeader}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#28251d' }}>
            Approval Required
          </div>
          <div style={{ fontSize: 12, color: '#7a7974', marginTop: 2 }}>
            Requested {approval.created_at
              ? new Date(approval.created_at).toLocaleString()
              : '—'}
          </div>
        </div>
        <span style={s.badge}>⏳ Pending</span>
      </div>

      {/* ── Details grid ── */}
      <div style={s.detailGrid}>
        <DetailRow label="Run ID">
          <Link to={`/runs/${approval.run_id}`} style={{ color: '#01696f', fontSize: 13 }}>
            {approval.run_id?.slice(0, 8)}…
          </Link>
        </DetailRow>
        <DetailRow label="Node">{approval.node_id}</DetailRow>
        <DetailRow label="MCP Server">{approval.mcp_server || '—'}</DetailRow>
        <DetailRow label="Tool">{approval.tool || '—'}</DetailRow>
      </div>

      {/* ── Action description ── */}
      {approval.action_description && (
        <div style={s.actionDesc}>
          <strong>What will happen:</strong> {approval.action_description}
        </div>
      )}

      {/* ── Reject note input ── */}
      {showReject && !deciding && (
        <div style={{ marginTop: 8 }}>
          <textarea
            style={{ ...s.input, height: 56 }}
            placeholder="Reason for rejection (optional)…"
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
          />
        </div>
      )}

      {/* ── Action buttons ── */}
      <div style={s.actions}>
        {!deciding ? (
          <>
            <button style={s.btnApprove} onClick={handleApprove}>
              ✓ Approve
            </button>
            {showReject
              ? <button style={s.btnReject} onClick={handleReject}>Confirm Rejection</button>
              : <button style={s.btnRejectGhost} onClick={() => setShowReject(true)}>✕ Reject…</button>
            }
          </>
        ) : (
          <span style={{ fontSize: 13, color: '#7a7974' }}>Processing…</span>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
      <span style={{ fontSize: 12, color: '#7a7974', minWidth: 90 }}>{label}:</span>
      <span style={{ fontSize: 13, color: '#28251d' }}>{children}</span>
    </div>
  );
}

export default function ApprovalsPanel() {
  const [pending,  setPending]  = useState([]);
  const [resolved, setResolved] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const loadPending = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/api/approvals/pending`);
      setPending(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + poll every 5 seconds
  useEffect(() => {
    loadPending();
    const interval = setInterval(loadPending, 5000);
    return () => clearInterval(interval);
  }, [loadPending]);

  const handleDecide = async (id, decision, comments) => {
    try {
      await axios.post(`${API_BASE}/api/approvals/${id}/decision`, {
        decision,
        comments,
        decided_by: APPROVER_ID,
      });
      // Move from pending to resolved list
      const item = pending.find(a => a.id === id);
      setResolved(prev => [
        { ...item, status: decision, decided_at: new Date().toISOString() },
        ...prev,
      ]);
      setPending(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  return (
    <div>
      {/* ── Header ── */}
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.h1}>Approvals</h1>
          <p style={s.subtitle}>
            Review and approve workflow steps that require human confirmation before executing.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {pending.length > 0 && (
            <span style={s.pendingBadge}>{pending.length} pending</span>
          )}
          <button style={s.btnRefresh} onClick={loadPending}>↻ Refresh</button>
        </div>
      </div>

      {error && <p style={s.error}>{error}</p>}

      {/* ── Pending approvals ── */}
      <section>
        <h2 style={s.h2}>Pending</h2>
        {loading ? (
          <p style={{ color: '#7a7974', fontSize: 14 }}>Loading…</p>
        ) : pending.length === 0 ? (
          <div style={s.emptyState}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>All caught up!</div>
            <div style={{ fontSize: 13, color: '#7a7974' }}>
              No pending approvals. Run a workflow to see approval gates here.
            </div>
          </div>
        ) : (
          <div style={s.grid}>
            {pending.map(a => (
              <ApprovalCard key={a.id} approval={a} onDecide={handleDecide} />
            ))}
          </div>
        )}
      </section>

      {/* ── Recently resolved ── */}
      {resolved.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2 style={s.h2}>Recently Resolved (this session)</h2>
          <div style={s.resolvedList}>
            {resolved.map((a, i) => (
              <div key={i} style={s.resolvedItem}>
                <span style={{ fontSize: 13, color: '#28251d', fontWeight: 500 }}>
                  {a.node_id}
                </span>
                <span style={{
                  fontSize: 12, padding: '2px 8px', borderRadius: 99,
                  background: a.status === 'approved' ? '#d4dfcc' : '#e0ced7',
                  color:      a.status === 'approved' ? '#2e5c10'  : '#7d1e5e',
                  fontWeight: 600,
                }}>
                  {a.status}
                </span>
                <span style={{ fontSize: 12, color: '#7a7974' }}>
                  {a.decided_at ? new Date(a.decided_at).toLocaleTimeString() : ''}
                </span>
                <Link to={`/runs/${a.run_id}`} style={{ fontSize: 12, color: '#01696f' }}>
                  View run →
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const s = {
  h1:          { fontSize: 22, fontWeight: 700, color: '#28251d', marginBottom: 2 },
  h2:          { fontSize: 16, fontWeight: 600, color: '#28251d', marginBottom: 12 },
  subtitle:    { fontSize: 14, color: '#7a7974' },
  pageHeader:  {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 24,
  },
  pendingBadge: {
    fontSize: 12, fontWeight: 700, padding: '4px 12px',
    borderRadius: 99, background: '#fff8e1', color: '#8a5b00',
  },
  btnRefresh: {
    padding: '7px 16px', borderRadius: 6, border: '1px solid #dcd9d5',
    background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer',
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 },
  approvalCard: {
    background: '#fff', borderRadius: 10, border: '1px solid #dcd9d5',
    padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  cardHeader: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 14,
  },
  badge: {
    fontSize: 11, fontWeight: 700, padding: '3px 10px',
    borderRadius: 99, background: '#fff8e1', color: '#8a5b00',
  },
  detailGrid:  { marginBottom: 12 },
  actionDesc: {
    fontSize: 13, color: '#3b5c5e', background: '#f0f8f7',
    border: '1px solid #cedcd8', borderRadius: 6,
    padding: '8px 12px', marginBottom: 12,
  },
  actions: { display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  btnApprove: {
    padding: '8px 18px', borderRadius: 6, border: 'none',
    background: '#437a22', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
  },
  btnReject: {
    padding: '8px 18px', borderRadius: 6, border: 'none',
    background: '#a12c7b', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
  },
  btnRejectGhost: {
    padding: '8px 18px', borderRadius: 6,
    border: '1px solid #dcd9d5', background: '#fff',
    color: '#7a7974', fontWeight: 500, fontSize: 13, cursor: 'pointer',
  },
  input: {
    width: '100%', padding: '8px 12px', borderRadius: 6,
    border: '1px solid #dcd9d5', fontSize: 13, color: '#28251d',
    background: '#fafaf8', boxSizing: 'border-box', resize: 'vertical',
  },
  emptyState: {
    textAlign: 'center', padding: '48px 24px',
    background: '#fff', borderRadius: 10, border: '1px solid #dcd9d5',
  },
  resolvedList: { display: 'flex', flexDirection: 'column', gap: 8 },
  resolvedItem: {
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    background: '#fff', borderRadius: 8, border: '1px solid #dcd9d5',
    padding: '10px 16px',
  },
  error: { color: '#a12c7b', fontSize: 13, marginBottom: 12 },
};
```
