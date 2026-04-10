// frontend/src/components/WorkflowBuilder.jsx
// Visual Workflow Builder:
//   1. User enters a natural-language workflow description.
//   2. POST /api/workflows/plan → Node backend → Python Planner Agent.
//   3. Response DAG is rendered as an interactive ReactFlow canvas.
//   4. User can optionally edit node positions, then click Execute.
//   5. POST /api/workflows/:id/execute → starts a run; redirects to RunDashboard.

import React, { useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';
const ORCH_BASE = import.meta.env.VITE_ORCH_BASE || 'http://localhost:8000';

const WorkflowBuilder = () => {
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [dag, setDag]                 = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [workflowId, setWorkflowId]   = useState(null);
  const [runId, setRunId]             = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);

  // ── Step 1: Plan workflow via Python orchestrator directly ──────────
  const handlePlan = async () => {
    if (!name || !description) {
      setError('Please fill in both Workflow Name and Description.');
      return;
    }
    setError(null);
    setLoading(true);
    setDag(null);
    setSuggestions([]);
    setWorkflowId(null);
    setRunId(null);

    try {
      // Call orchestrator /plan directly
      const { data } = await axios.post(`${ORCH_BASE}/plan`, {
        name,
        description,
        owner_id: 'demo-user',
      });

      setDag(data.dag || []);
      setSuggestions(data.suggestions || []);

      // Also save to Node backend → Supabase
      try {
        const saveResp = await axios.post(`${API_BASE}/api/workflows/plan`, {
          name,
          description,
          owner_id: 'demo-user',
        });
        // saveResp.data.workflow.id is the saved workflow UUID
        if (saveResp.data?.workflow?.id) {
          setWorkflowId(saveResp.data.workflow.id);
        }
      } catch (saveErr) {
        console.warn('Could not save to Node backend:', saveErr.message);
        // Non-fatal — DAG still shown even if save fails
      }
    } catch (err) {
      setError(`Planning failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Execute workflow ────────────────────────────────────────
  const handleExecute = async () => {
    if (!dag || dag.length === 0) return;
    setError(null);
    setLoading(true);

    try {
      const newRunId = `run-${Date.now()}`;

      // Always call orchestrator /execute directly with full DAG
      const { data } = await axios.post(`${ORCH_BASE}/execute`, {
        run_id:       newRunId,
        workflow_id:  workflowId || 'demo-workflow',
        mode:         'dry-run',
        dry_run:      true,
        dag:          dag,
        input_payload: {},
      });

      setRunId(newRunId);
      alert(`✅ Run started! Run ID: ${newRunId}\n\nGo to the Approvals tab to approve pending steps.\nCheck terminal for live logs.`);
    } catch (err) {
      setError(`Execution failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Node type → color badge ─────────────────────────────────────────
  const typeBadgeColor = (type) => {
    const colors = {
      trigger:      '#3b82f6',
      action:       '#8b5cf6',
      notify:       '#f59e0b',
      utility:      '#10b981',
      approval_gate:'#ef4444',
    };
    return colors[type] || '#6b7280';
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1>⚡ Workflow Builder</h1>
      <p style={{ color: '#6b7280' }}>
        Describe your workflow in plain English — the AI Planner will build the execution DAG.
      </p>

      {/* ── Input form ── */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Workflow Name
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Critical Bug Triage"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db' }}
          />
        </div>
        <div style={{ flex: 2 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Natural Language Description
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="When a critical bug is filed in Jira..."
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db' }}
          />
        </div>
      </div>

      {/* ── Error message ── */}
      {error && (
        <div style={{ color: '#ef4444', marginBottom: 12, fontWeight: 500 }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Plan button ── */}
      <button
        onClick={handlePlan}
        disabled={loading}
        style={{
          background: '#1d4ed8', color: '#fff', border: 'none',
          padding: '10px 24px', borderRadius: 8, cursor: 'pointer',
          fontWeight: 600, fontSize: 15, marginBottom: 24,
        }}
      >
        {loading ? '⏳ Planning...' : '🧠 Plan Workflow'}
      </button>

      {/* ── DAG visualization ── */}
      {dag && dag.length > 0 && (
        <div>
          <h2>📊 Planned DAG  <span style={{ fontSize: 14, color: '#6b7280' }}>({dag.length} steps)</span></h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {dag.map((node, idx) => (
              <div key={node.id} style={{
                border: '1px solid #e5e7eb', borderRadius: 10,
                padding: '14px 18px', background: '#f9fafb',
                display: 'flex', alignItems: 'flex-start', gap: 14,
              }}>
                {/* Step number */}
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: '#1d4ed8', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, flexShrink: 0,
                }}>
                  {idx + 1}
                </div>

                <div style={{ flex: 1 }}>
                  {/* Node ID + type badge */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <strong style={{ fontSize: 15 }}>{node.id}</strong>
                    <span style={{
                      background: typeBadgeColor(node.type),
                      color: '#fff', fontSize: 11, padding: '2px 8px',
                      borderRadius: 12, fontWeight: 600,
                    }}>
                      {node.type}
                    </span>
                    {node.approval_required && (
                      <span style={{
                        background: '#fef3c7', color: '#92400e',
                        fontSize: 11, padding: '2px 8px',
                        borderRadius: 12, fontWeight: 600,
                        border: '1px solid #fcd34d',
                      }}>
                        🔐 Approval Gate
                      </span>
                    )}
                  </div>

                  {/* MCP server + tool */}
                  <div style={{ color: '#374151', fontSize: 13, marginBottom: 4 }}>
                    <span style={{ color: '#6b7280' }}>Server:</span> <code>{node.mcp_server}</code>
                    {'  '}
                    <span style={{ color: '#6b7280' }}>Tool:</span> <code>{node.tool}</code>
                  </div>

                  {/* Dependencies */}
                  {node.depends_on?.length > 0 && (
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      Depends on: {node.depends_on.map(d => (
                        <code key={d} style={{ marginRight: 4 }}>{d}</code>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Execute button ── */}
          <button
            onClick={handleExecute}
            disabled={loading}
            style={{
              background: '#059669', color: '#fff', border: 'none',
              padding: '10px 28px', borderRadius: 8, cursor: 'pointer',
              fontWeight: 600, fontSize: 15, marginBottom: 24,
            }}
          >
            {loading ? '⏳ Starting...' : '🚀 Execute Workflow'}
          </button>

          {runId && (
            <div style={{
              background: '#d1fae5', border: '1px solid #6ee7b7',
              borderRadius: 8, padding: '10px 16px', marginBottom: 16,
            }}>
              ✅ Run started — <strong>Run ID:</strong> <code>{runId}</code>
              <br />
              <span style={{ fontSize: 13, color: '#065f46' }}>
                Go to <strong>Approvals</strong> tab to approve pending steps.
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── AI Suggestions ── */}
      {suggestions.length > 0 && (
        <div style={{
          background: '#eff6ff', border: '1px solid #bfdbfe',
          borderRadius: 10, padding: '16px 20px',
        }}>
          <h3 style={{ margin: '0 0 10px', color: '#1d4ed8' }}>💡 AI Suggestions</h3>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {suggestions.map((s, i) => (
              <li key={i} style={{ marginBottom: 6, color: '#374151' }}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default WorkflowBuilder;