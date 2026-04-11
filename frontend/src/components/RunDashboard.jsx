// frontend/src/components/RunDashboard.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE  || 'http://localhost:4000';
const ORCH_WS  = (import.meta.env.VITE_ORCH_BASE || 'http://localhost:8000')
  .replace('http://', 'ws://')
  .replace('https://', 'wss://');

// ── Node status → visual style ────────────────────────────────────────────
const NODE_STYLE = {
  pending:          { bg: '#f3f4f6', border: '#d1d5db', color: '#6b7280',  icon: '⏳' },
  running:          { bg: '#dbeafe', border: '#3b82f6', color: '#1d4ed8',  icon: '▶' },
  success:          { bg: '#d1fae5', border: '#10b981', color: '#065f46',  icon: '✅' },
  failed:           { bg: '#fee2e2', border: '#ef4444', color: '#991b1b',  icon: '❌' },
  skipped:          { bg: '#f3f4f6', border: '#d1d5db', color: '#9ca3af',  icon: '⏭' },
  waiting_approval: { bg: '#fef3c7', border: '#f59e0b', color: '#92400e',  icon: '🔐' },
};

// ── Parse log messages to extract node statuses ───────────────────────────
function inferNodeStatuses(logs, dagNodes) {
  const statuses = {};
  dagNodes.forEach(n => { statuses[n.id] = 'pending'; });

  for (const log of logs) {
    const msg = log.message || '';
    for (const node of dagNodes) {
      const id = node.id;
      if (msg.includes(`▶ ${id}`) || msg.includes(`▶ ${id} →`)) {
        statuses[id] = 'running';
      }
      if (msg.includes(`✅ Node '${id}' completed`)) {
        statuses[id] = 'success';
      }
      if (msg.includes(`❌ Node '${id}'`) || msg.includes(`Node '${id}' failed`)) {
        statuses[id] = 'failed';
      }
      if (msg.includes(`⏭ Node '${id}' skipped`)) {
        statuses[id] = 'skipped';
      }
      if (msg.includes(`⏸ Approval requested for '${id}'`)) {
        statuses[id] = 'waiting_approval';
      }
      if (msg.includes(`👍 Node '${id}' approved`)) {
        statuses[id] = 'running';
      }
    }
  }
  return statuses;
}

// ── Single DAG node card ──────────────────────────────────────────────────
const DagNodeCard = ({ node, status }) => {
  const s = NODE_STYLE[status] || NODE_STYLE.pending;
  return (
    <div style={{
      border:       `2px solid ${s.border}`,
      background:   s.bg,
      borderRadius: 10,
      padding:      '10px 14px',
      minWidth:     160,
      maxWidth:     200,
      transition:   'all 0.3s ease',
      boxShadow:    status === 'running' ? `0 0 12px ${s.border}` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 16 }}>{s.icon}</span>
        <strong style={{ color: s.color, fontSize: 13 }}>{node.id}</strong>
      </div>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>
        <code>{node.mcp_server}</code>
      </div>
      <div style={{ fontSize: 11, color: '#374151' }}>
        <code>{node.tool}</code>
      </div>
      {node.approval_required && (
        <div style={{
          marginTop: 6, fontSize: 10, background: '#fef3c7',
          color: '#92400e', padding: '2px 6px', borderRadius: 8,
          display: 'inline-block', border: '1px solid #fcd34d',
        }}>
          🔐 Approval Gate
        </div>
      )}
      <div style={{
        marginTop: 6, fontSize: 11, fontWeight: 600, color: s.color,
        textTransform: 'capitalize',
      }}>
        {status.replace('_', ' ')}
      </div>
    </div>
  );
};

// ── Arrow between nodes ───────────────────────────────────────────────────
const Arrow = () => (
  <div style={{
    display:    'flex',
    alignItems: 'center',
    color:      '#9ca3af',
    fontSize:   20,
    padding:    '0 4px',
    userSelect: 'none',
  }}>
    →
  </div>
);

// ── Main component ────────────────────────────────────────────────────────
const RunDashboard = () => {
  const { runId }          = useParams();
  const navigate           = useNavigate();
  const [logs, setLogs]    = useState([]);
  const [status, setStatus]= useState('running');
  const [wsState, setWsState] = useState('connecting');
  const [dagNodes, setDagNodes] = useState([]);
  const [nodeStatuses, setNodeStatuses] = useState({});
  const [summary, setSummary] = useState({ success: 0, failed: 0, pending: 0 });
  const wsRef      = useRef(null);
  const logsEndRef = useRef(null);
  const logsRef    = useRef([]);

  // ── Load DAG from sessionStorage ──────────────────────────────────
  useEffect(() => {
    const saved = sessionStorage.getItem(`dag_${runId}`);
    if (saved) {
      const nodes = JSON.parse(saved);
      setDagNodes(nodes);
      const initial = {};
      nodes.forEach(n => { initial[n.id] = 'pending'; });
      setNodeStatuses(initial);
    }
  }, [runId]);

  // ── Update node statuses whenever logs change ──────────────────────
  useEffect(() => {
    if (dagNodes.length === 0) return;
    const statuses = inferNodeStatuses(logsRef.current, dagNodes);
    setNodeStatuses(statuses);

    // Update summary counts
    const vals = Object.values(statuses);
    setSummary({
      success: vals.filter(s => s === 'success').length,
      failed:  vals.filter(s => s === 'failed').length,
      pending: vals.filter(s => ['pending', 'running', 'waiting_approval'].includes(s)).length,
    });
  }, [logs, dagNodes]);

  // ── WebSocket connection ───────────────────────────────────────────
  useEffect(() => {
    if (!runId) return;

    // Load existing logs from Node backend
    axios.get(`${API_BASE}/api/logs/run/${runId}`)
      .then(res => {
        const existing = res.data || [];
        logsRef.current = existing;
        setLogs(existing);
      })
      .catch(() => {});

    const connect = () => {
      const ws = new WebSocket(`${ORCH_WS}/ws/runs/${runId}`);
      wsRef.current = ws;
      ws.onopen  = () => setWsState('open');
      ws.onerror = () => setWsState('error');
      ws.onclose = () => {
        setWsState('closed');
        setTimeout(() => {
          if (wsRef.current?.readyState !== WebSocket.OPEN) connect();
        }, 3000);
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log') {
          const entry = {
            level:     msg.level,
            message:   msg.message,
            timestamp: msg.timestamp || new Date().toISOString(),
          };
          logsRef.current = [...logsRef.current, entry];
          setLogs(prev => [...prev, entry]);
        }
        if (msg.type === 'run_completed') {
          setStatus(msg.status);
          setWsState('done');
        }
        if (msg.type === 'approval_requested') setStatus('paused');
        if (msg.type === 'approval_resolved')  setStatus('running');
      };
    };
    connect();
    return () => wsRef.current?.close();
  }, [runId]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ── Build rows of nodes for DAG layout ────────────────────────────
  // Simple linear layout: each node that has no deps = new row start
  const buildRows = () => {
    if (dagNodes.length === 0) return [];
    const rows  = [];
    const added = new Set();

    const getLevel = (node, memo = {}) => {
      if (memo[node.id] !== undefined) return memo[node.id];
      if (!node.depends_on || node.depends_on.length === 0) {
        memo[node.id] = 0;
        return 0;
      }
      const depLevels = node.depends_on.map(dep => {
        const depNode = dagNodes.find(n => n.id === dep);
        return depNode ? getLevel(depNode, memo) : 0;
      });
      memo[node.id] = Math.max(...depLevels) + 1;
      return memo[node.id];
    };

    const memo   = {};
    const levels = {};
    dagNodes.forEach(n => { levels[n.id] = getLevel(n, memo); });
    const maxLevel = Math.max(...Object.values(levels));
    for (let i = 0; i <= maxLevel; i++) {
      rows.push(dagNodes.filter(n => levels[n.id] === i));
    }
    return rows;
  };

  const rows        = buildRows();
  const statusColor = {
    success: { bg: '#d1fae5', color: '#065f46' },
    failed:  { bg: '#fee2e2', color: '#991b1b' },
    paused:  { bg: '#fef3c7', color: '#92400e' },
    running: { bg: '#dbeafe', color: '#1e40af' },
  }[status] || { bg: '#f3f4f6', color: '#374151' };

  const wsColor = { open: '#059669', error: '#ef4444', closed: '#f59e0b', connecting: '#6b7280', done: '#10b981' };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0 }}>Run Dashboard</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0', fontSize: 13 }}>
            Run ID: <code>{runId}</code>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{
            background: statusColor.bg, color: statusColor.color,
            padding: '4px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
          }}>
            {status}
          </span>
          <span style={{
            background: '#f3f4f6', border: `1px solid ${wsColor[wsState] || '#d1d5db'}`,
            color: wsColor[wsState], padding: '4px 12px', borderRadius: 20, fontSize: 12,
          }}>
            WS: {wsState}
          </span>
          <button
            onClick={() => navigate('/approvals')}
            style={{
              background: '#fef3c7', border: '1px solid #fcd34d',
              borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontWeight: 500,
            }}
          >
            🔐 Approvals
          </button>
          <button
            onClick={() => navigate('/')}
            style={{
              background: '#f3f4f6', border: '1px solid #d1d5db',
              borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
            }}
          >
            ← Back to Builder
          </button>
        </div>
      </div>

      {/* ── Summary bar ── */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 24,
      }}>
        {[
          { label: '✅ Completed', value: summary.success, bg: '#d1fae5', color: '#065f46' },
          { label: '❌ Failed',    value: summary.failed,  bg: '#fee2e2', color: '#991b1b' },
          { label: '⏳ Pending',   value: summary.pending, bg: '#f3f4f6', color: '#374151' },
          { label: '📋 Total',     value: dagNodes.length, bg: '#dbeafe', color: '#1e40af' },
        ].map(item => (
          <div key={item.label} style={{
            background: item.bg, borderRadius: 10,
            padding: '12px 20px', flex: 1, textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: item.color }}>
              {item.value}
            </div>
            <div style={{ fontSize: 12, color: item.color, marginTop: 2 }}>
              {item.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Live DAG View ── */}
      {dagNodes.length > 0 && (
        <div style={{
          border: '1px solid #e5e7eb', borderRadius: 12,
          padding: 20, marginBottom: 24, background: '#fafafa',
        }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16 }}>⚡ Live Execution DAG</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'flex-start' }}>
            {rows.map((row, rowIdx) => (
              <div key={rowIdx} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                {rowIdx > 0 && (
                  <div style={{
                    width: '100%', display: 'flex',
                    justifyContent: 'center',
                    color: '#9ca3af', fontSize: 20, margin: '-8px 0',
                  }}>
                    ↓
                  </div>
                )}
                {row.map((node, nodeIdx) => (
                  <React.Fragment key={node.id}>
                    {nodeIdx > 0 && <Arrow />}
                    <DagNodeCard
                      node={node}
                      status={nodeStatuses[node.id] || 'pending'}
                    />
                  </React.Fragment>
                ))}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
            {Object.entries(NODE_STYLE).map(([key, val]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                <span>{val.icon}</span>
                <span style={{ color: '#6b7280', textTransform: 'capitalize' }}>
                  {key.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Live Logs ── */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{
          background: '#f9fafb', padding: '12px 16px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <strong>Live Logs</strong>
          <span style={{ color: '#6b7280', fontSize: 13 }}>{logs.length} entries</span>
        </div>
        <div style={{
          background: '#111827', padding: 16,
          fontFamily: 'monospace', fontSize: 12,
          minHeight: 250, maxHeight: 400, overflowY: 'auto',
        }}>
          {logs.length === 0 ? (
            <span style={{ color: '#6b7280' }}>Waiting for logs...</span>
          ) : (
            logs.map((l, i) => (
              <div key={i} style={{
                color:        l.level === 'error'   ? '#f87171'
                            : l.level === 'warning' ? '#fbbf24'
                            : '#86efac',
                marginBottom: 3,
              }}>
                <span style={{ color: '#4b5563', marginRight: 8 }}>
                  {l.timestamp?.slice(11, 19) || ''}
                </span>
                {l.message}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};

export default RunDashboard;