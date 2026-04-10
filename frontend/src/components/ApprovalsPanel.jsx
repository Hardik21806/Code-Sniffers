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
