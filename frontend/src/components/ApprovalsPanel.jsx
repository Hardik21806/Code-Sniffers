// frontend/src/components/ApprovalsPanel.jsx
// Human-in-the-loop Approval Panel:
//   - Polls GET /api/approvals/pending every 5 seconds for pending approval gates.
//   - Shows each pending gate with run ID, node ID, and requested_at timestamp.
//   - User clicks Approve or Reject → POST /api/approvals/:id/decision.
//   - Node backend updates Supabase and calls /approval-callback on the orchestrator,
//     which resumes (or aborts) the paused executor.

// frontend/src/components/ApprovalsPanel.jsx
import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API_BASE  = import.meta.env.VITE_API_BASE  || 'http://localhost:4000';
const ORCH_BASE = import.meta.env.VITE_ORCH_BASE || 'http://localhost:8000';

// Simple Supabase fetch (no auth needed — RLS disabled)
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function supaFetch(table, params = '') {
  const res = await fetch(
    `${SUPA_URL}/rest/v1/${table}?${params}`,
    {
      headers: {
        apikey:        SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status}`);
  return res.json();
}

const ApprovalsPanel = () => {
  const [pending,  setPending]  = useState([]);
  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [userName, setUserName] = useState(
    () => localStorage.getItem('mcp_user') || ''
  );
  const [nameInput, setNameInput] = useState('');

  // ── Load approvals + run history ────────────────────────────────────
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Pending approvals
      const { data: pendingData, error: pendingErr } = await (async () => {
        try {
          const res = await axios.get(`${API_BASE}/api/approvals/pending`);
          return { data: res.data || [], error: null };
        } catch (e) {
          return { data: [], error: e.message };
        }
      })();
      setPending(pendingData);

      // Run history from Supabase run_logs
      try {
        const logs = await supaFetch(
          'run_logs',
          'order=timestamp.desc&limit=50'
        );
        // Group by run_id
        const grouped = {};
        for (const log of logs) {
          if (!grouped[log.run_id]) grouped[log.run_id] = [];
          grouped[log.run_id].push(log);
        }
        setHistory(grouped);
      } catch (histErr) {
        console.warn('History fetch failed:', histErr.message);
        setHistory({});
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  // ── Save username to localStorage ────────────────────────────────────
  const saveUser = () => {
    if (!nameInput.trim()) return;
    localStorage.setItem('mcp_user', nameInput.trim());
    setUserName(nameInput.trim());
    setNameInput('');
  };

  // ── Decide approval ──────────────────────────────────────────────────
  const decide = async (approval, decision) => {
    const approver = userName || 'anonymous';
    try {
      try {
        await axios.post(`${API_BASE}/api/approvals/${approval.id}/decision`, {
          decision,
          comments:    `${decision} by ${approver}`,
          approved_by: approver,
        });
      } catch {
        await axios.post(`${ORCH_BASE}/approval-callback`, {
          run_id:   approval.run_id,
          node_id:  approval.node_id,
          decision,
        });
      }
      await loadData();
    } catch (err) {
      alert(`Decision failed: ${err.message}`);
    }
  };

  // ── Status badge color ───────────────────────────────────────────────
  const statusColor = (status) => ({
    success: { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' },
    failed:  { bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
    running: { bg: '#dbeafe', color: '#1e40af', border: '#93c5fd' },
    paused:  { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
  }[status] || { bg: '#f3f4f6', color: '#374151', border: '#d1d5db' });

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>

      {/* ── User identity bar ── */}
      <div style={{
        background: '#f8fafc', border: '1px solid #e2e8f0',
        borderRadius: 10, padding: '12px 20px',
        display: 'flex', alignItems: 'center',
        gap: 12, marginBottom: 24,
      }}>
        <span style={{ fontSize: 20 }}>👤</span>
        {userName ? (
          <span>
            Logged in as <strong>{userName}</strong>
            <button
              onClick={() => { localStorage.removeItem('mcp_user'); setUserName(''); }}
              style={{
                marginLeft: 12, background: 'none', border: '1px solid #d1d5db',
                borderRadius: 6, padding: '2px 10px', cursor: 'pointer',
                fontSize: 12, color: '#6b7280',
              }}
            >
              Change
            </button>
          </span>
        ) : (
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#6b7280', fontSize: 14 }}>
              Set your name so approvals show who approved:
            </span>
            <input
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveUser()}
              placeholder="e.g. Hardik"
              style={{
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid #d1d5db', fontSize: 14,
              }}
            />
            <button
              onClick={saveUser}
              style={{
                background: '#1d4ed8', color: '#fff', border: 'none',
                padding: '4px 14px', borderRadius: 6,
                cursor: 'pointer', fontWeight: 600,
              }}
            >
              Save
            </button>
          </span>
        )}
      </div>

      {/* ── Approvals header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>🔐 Approvals</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0' }}>
            Review and approve workflow steps that require human confirmation.
          </p>
        </div>
        <button
          onClick={loadData}
          style={{
            background: '#f3f4f6', border: '1px solid #d1d5db',
            borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 500,
          }}
        >
          ↺ Refresh
        </button>
      </div>

      {error && (
        <div style={{ color: '#ef4444', marginBottom: 12 }}>⚠ {error}</div>
      )}

      {/* ── Pending approvals ── */}
      <h2 style={{ marginBottom: 12 }}>Pending</h2>
      {loading && pending.length === 0 ? (
        <p style={{ color: '#6b7280' }}>Loading...</p>
      ) : pending.length === 0 ? (
        <div style={{
          border: '1px solid #e5e7eb', borderRadius: 12,
          padding: '40px 24px', textAlign: 'center', background: '#fafafa',
          marginBottom: 32,
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
          <strong>All caught up!</strong>
          <p style={{ color: '#6b7280', margin: '4px 0 0' }}>
            No pending approvals. Run a workflow to see approval gates here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
          {pending.map(a => (
            <div key={a.id} style={{
              border: '1px solid #fcd34d', borderRadius: 10,
              padding: '16px 20px', background: '#fffbeb',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                  🔐 {a.node_id}
                  <span style={{
                    marginLeft: 8, fontSize: 11, background: '#fef3c7',
                    color: '#92400e', padding: '2px 8px', borderRadius: 12,
                    border: '1px solid #fcd34d',
                  }}>
                    pending
                  </span>
                </div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  Run: <code>{a.run_id}</code>
                </div>
                {a.mcp_server && (
                  <div style={{ fontSize: 13, color: '#6b7280' }}>
                    <code>{a.mcp_server}</code> → <code>{a.tool}</code>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  Approving as: <strong>{userName || 'anonymous'}</strong>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => decide(a, 'approved')}
                    style={{
                      background: '#059669', color: '#fff', border: 'none',
                      padding: '8px 20px', borderRadius: 8,
                      cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    ✅ Approve
                  </button>
                  <button
                    onClick={() => decide(a, 'rejected')}
                    style={{
                      background: '#ef4444', color: '#fff', border: 'none',
                      padding: '8px 20px', borderRadius: 8,
                      cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    ❌ Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Run History section ── */}
      <h2 style={{ marginBottom: 12 }}>📜 Run History</h2>
      {Object.keys(history).length === 0 ? (
        <p style={{ color: '#6b7280' }}>No run history yet. Execute a workflow first.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Object.entries(history).map(([runId, logs]) => {
            const lastLog   = logs[logs.length - 1]?.message || '';
            const isSuccess = lastLog.includes('success');
            const isFailed  = lastLog.includes('failed') || lastLog.includes('Failed');
            const status    = isSuccess ? 'success' : isFailed ? 'failed' : 'running';
            const sc        = statusColor(status);
            const firstTime = logs[0]?.timestamp?.slice(11, 19) || '';
            const lastTime  = logs[logs.length - 1]?.timestamp?.slice(11, 19) || '';

            return (
              <details key={runId} style={{
                border: `1px solid ${sc.border}`,
                borderRadius: 10, background: sc.bg,
                padding: '12px 16px',
              }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{
                    background: sc.border, color: sc.color,
                    padding: '2px 10px', borderRadius: 12, fontSize: 12,
                  }}>
                    {status}
                  </span>
                  <code style={{ fontSize: 13 }}>{runId}</code>
                  <span style={{ fontWeight: 400, fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>
                    {firstTime} → {lastTime}  ({logs.length} events)
                  </span>
                </summary>

                {/* Log lines */}
                <div style={{
                  marginTop: 10, background: '#1e1e1e', borderRadius: 8,
                  padding: '10px 14px', fontFamily: 'monospace',
                  fontSize: 12, maxHeight: 200, overflowY: 'auto',
                }}>
                  {logs.map((l, i) => (
                    <div key={i} style={{
                      color: l.level === 'error' ? '#f87171'
                           : l.level === 'warning' ? '#fbbf24'
                           : '#86efac',
                      marginBottom: 2,
                    }}>
                      <span style={{ color: '#6b7280', marginRight: 8 }}>
                        {l.timestamp?.slice(11, 19)}
                      </span>
                      {l.message}
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ApprovalsPanel;