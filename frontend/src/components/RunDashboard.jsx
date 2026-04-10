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
