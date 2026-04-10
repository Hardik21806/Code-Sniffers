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
