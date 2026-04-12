// frontend/src/pages/RunDashboard.jsx
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import VisualDagBuilder from '../components/VisualDagBuilder';

const WS_BASE = import.meta.env.VITE_WS_BASE || 'ws://localhost:8000';

const STATUS_COLOR = {
  success: '#00D4AA',
  failed:  '#EF4444',
  running: '#6366f1',
  paused:  '#E8C547',
  queued:  '#9ca3af',
};

const LOG_COLOR = {
  error:   '#EF4444',
  warning: '#F59E0B',
  info:    '#00D4AA',
};

export default function RunDashboard() {
  const { runId }   = useParams();
  const navigate    = useNavigate();

  const [run,          setRun]          = useState(null);
  const [dag,          setDag]          = useState([]);
  const [logs,         setLogs]         = useState([]);
  const [nodeStatuses, setNodeStatuses] = useState({});
  const [connected,    setConnected]    = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState([]);

  const logsEndRef = useRef(null);
  const wsRef      = useRef(null);

  // ── Load run + workflow DAG from Supabase ──────────────────
  useEffect(() => {
    if (!runId) return;

    const loadRun = async () => {
      try {
        const { data: runData } = await supabase
          .from('workflow_runs')
          .select('*')
          .eq('id', runId)
          .single();

        if (!runData) return;
        setRun(runData);

        // Load DAG from the workflow
        if (runData.workflow_id) {
          const { data: wfData } = await supabase
            .from('workflows')
            .select('dag_json')
            .eq('id', runData.workflow_id)
            .single();

          if (wfData?.dag_json) {
            setDag(wfData.dag_json);
          }
        }

        // Load existing step statuses
        const { data: steps } = await supabase
          .from('workflow_run_steps')
          .select('node_id, status')
          .eq('run_id', runId);

        if (steps) {
          const statusMap = {};
          steps.forEach(s => { statusMap[s.node_id] = s.status; });
          setNodeStatuses(statusMap);
        }

        // Load pending approvals
        const { data: approvals } = await supabase
          .from('approvals')
          .select('*')
          .eq('run_id', runId)
          .eq('status', 'pending');
        setPendingApprovals(approvals || []);

      } catch (e) {
        console.error('[RunDashboard] load error:', e);
      }
    };

    loadRun();
  }, [runId]);

  // ── WebSocket: real-time log + node color updates ──────────
  useEffect(() => {
    if (!runId) return;

    const ws = new WebSocket(`${WS_BASE}/ws/runs/${runId}`);
    wsRef.current = ws;

    ws.onopen  = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        // Live log streaming
        if (msg.type === 'log') {
          setLogs(prev => [...prev, msg]);
        }

        // Node color changes — Visual DAG Builder
        if (msg.type === 'step_started') {
          setNodeStatuses(p => ({ ...p, [msg.node_id]: 'running' }));
        }
        if (msg.type === 'step_completed') {
          setNodeStatuses(p => ({ ...p, [msg.node_id]: 'success' }));
        }
        if (msg.type === 'step_failed') {
          setNodeStatuses(p => ({ ...p, [msg.node_id]: 'failed' }));
        }
        if (msg.type === 'step_skipped') {
          setNodeStatuses(p => ({ ...p, [msg.node_id]: 'skipped' }));
        }
        if (msg.type === 'approval_requested') {
          setNodeStatuses(p => ({ ...p, [msg.node_id]: 'paused' }));
          setPendingApprovals(p => [...p, { node_id: msg.node_id, run_id: runId, status: 'pending' }]);
        }
        if (msg.type === 'approval_resolved') {
          setNodeStatuses(p => ({
            ...p,
            [msg.node_id]: msg.decision === 'approved' ? 'running' : 'failed',
          }));
          setPendingApprovals(p => p.filter(a => a.node_id !== msg.node_id));
        }

        // Run status update
        if (msg.type === 'run_completed') {
          setRun(prev => prev ? { ...prev, status: msg.status } : prev);
        }
        if (msg.type === 'run_started') {
          setRun(prev => prev ? { ...prev, status: 'running' } : prev);
        }

      } catch (err) {
        console.error('[ws] parse error:', err);
      }
    };

    return () => ws.close();
  }, [runId]);

  // ── Auto-scroll logs ───────────────────────────────────────
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ── Approval actions ───────────────────────────────────────
  const handleApproval = async (nodeId, decision) => {
    try {
      await supabase
        .from('approvals')
        .update({ status: decision })
        .eq('run_id', runId)
        .eq('node_id', nodeId);

      // Tell orchestrator
      await fetch(`${import.meta.env.VITE_ORCH_BASE || 'http://localhost:8000'}/approval-callback`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ run_id: runId, node_id: nodeId, decision }),
      });

      setPendingApprovals(p => p.filter(a => a.node_id !== nodeId));
    } catch (e) {
      console.error('[approval]', e);
    }
  };

  const runStatusColor = STATUS_COLOR[run?.status] || '#9ca3af';

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '8px 14px', color: '#fff',
            cursor: 'pointer', fontSize: 13,
          }}
        >← Back</button>

        <div style={{ flex: 1 }}>
          <h1 style={{ color: '#fff', fontWeight: 800, fontSize: 22, margin: 0 }}>
            ⚡ Run Dashboard
          </h1>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 3, fontFamily: 'monospace' }}>
            {runId}
          </div>
        </div>

        {/* Run status badge */}
        {run && (
          <div style={{
            background: `${runStatusColor}18`,
            border:     `1px solid ${runStatusColor}`,
            borderRadius: 20, padding: '6px 16px',
            color: runStatusColor, fontWeight: 700, fontSize: 13,
          }}>
            {run.status === 'running' && <span style={{ marginRight: 6 }}>⚡</span>}
            {run.status?.toUpperCase()}
          </div>
        )}

        {/* WebSocket indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
          <span className={connected ? "status-dot-green" : ""} style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#00D4AA' : '#EF4444',
            display: 'inline-block',
            boxShadow: connected ? '0 0 6px #00D4AA' : 'none',
          }} />
          {connected ? 'Live' : 'Disconnected'}
        </div>
      </div>

      {/* ── Pending Approvals Banner ── */}
      {pendingApprovals.length > 0 && (
        <div style={{
          background: 'rgba(232,197,71,0.1)',
          border: '1px solid rgba(232,197,71,0.4)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 20,
        }}>
          <div style={{ color: '#E8C547', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
            🔐 Approval Required ({pendingApprovals.length})
          </div>
          {pendingApprovals.map(a => (
            <div key={a.node_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#fff', fontSize: 14 }}>
                Node: <code style={{ color: '#E8C547' }}>{a.node_id}</code>
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="magnetic-hover-teal"
                  onClick={() => handleApproval(a.node_id, 'approved')}
                  style={{
                    background: 'linear-gradient(90deg,#00D4AA,#06b6d4)',
                    border: 'none', borderRadius: 8,
                    padding: '7px 18px', cursor: 'pointer',
                    color: '#050d1a', fontWeight: 700, fontSize: 13,
                  }}
                >✅ Approve</button>
                <button className="magnetic-hover-red"
                  onClick={() => handleApproval(a.node_id, 'rejected')}
                  style={{
                    background: 'rgba(239,68,68,0.15)',
                    border: '1px solid #EF4444', borderRadius: 8,
                    padding: '7px 18px', cursor: 'pointer',
                    color: '#EF4444', fontWeight: 700, fontSize: 13,
                  }}
                >❌ Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Visual DAG Builder — nodes change color in real time ── */}
      <VisualDagBuilder dag={dag} nodeStatuses={nodeStatuses} />

      {/* ── Live Log Stream ── */}
      <div style={{ marginTop: 24 }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
          📋 LIVE LOGS
          <span style={{ marginLeft: 8, color: 'rgba(255,255,255,0.25)', fontWeight: 400 }}>
            {logs.length} events
          </span>
        </div>
        <div style={{
          background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, padding: 16,
          height: 320, overflowY: 'auto',
          fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
        }}>
          {logs.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.2)', textAlign: 'center', paddingTop: 40 }}>
              {connected ? 'Waiting for events...' : 'Connecting...'}
            </div>
          ) : (
            logs.map((log, i) => (
              <div key={i} style={{ marginBottom: 5, display: 'flex', gap: 10 }}>
                <span style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>
                  {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('en-IN') : ''}
                </span>
                <span style={{
                  color: LOG_COLOR[log.level] || 'rgba(255,255,255,0.7)',
                  flexShrink: 0, fontSize: 11, fontWeight: 700,
                  textTransform: 'uppercase', minWidth: 50,
                }}>
                  [{log.level || 'info'}]
                </span>
                <span style={{ color: 'rgba(255,255,255,0.75)' }}>{log.message}</span>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

    </div>
  );
}