// frontend/src/components/WorkflowBuilder.jsx
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../context/AuthContext';

const API_BASE  = import.meta.env.VITE_API_BASE  || 'http://localhost:4000';
const ORCH_BASE = import.meta.env.VITE_ORCH_BASE || 'http://localhost:8000';

/* ── Chatbot Component ── */
const Chatbot = ({ userProfile, myRuns }) => {
  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: `Hi ${userProfile?.display_name || 'there'}! 👋 I'm your Dhaaga assistant. Ask me anything about your workflows!` }
  ]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getAnswer = (q) => {
    const lq = q.toLowerCase();
    // How many tickets
    if (lq.includes('how many') || lq.includes('ticket') || lq.includes('request')) {
      const total    = myRuns.length;
      const success  = myRuns.filter(r => r.status === 'success').length;
      const running  = myRuns.filter(r => r.status === 'running' || r.status === 'paused').length;
      const failed   = myRuns.filter(r => r.status === 'failed').length;
      return `You have raised **${total} workflow request(s)** total:\n✅ ${success} completed\n⚡ ${running} running/paused\n❌ ${failed} failed`;
    }
    if (lq.includes('latest') || lq.includes('last') || lq.includes('recent')) {
      if (!myRuns.length) return "You haven't run any workflows yet.";
      const r = myRuns;
      return `Your latest run is **${r.workflow_name || r.id}** with status **${r.status}**.`;
    }
    if (lq.includes('status')) {
      if (!myRuns.length) return "No runs found for your account.";
      return myRuns.slice(0, 3).map(r => `• ${r.workflow_name || r.id}: **${r.status}**`).join('\n');
    }
    if (lq.includes('approve') || lq.includes('pending')) {
      const pending = myRuns.filter(r => r.status === 'paused').length;
      return pending > 0
        ? `You have **${pending} workflow(s)** waiting for manager approval.`
        : "No workflows are currently waiting for approval.";
    }
    if (lq.includes('help') || lq.includes('what can')) {
      return "I can help you with:\n• How many tickets/requests you've raised\n• Status of your latest run\n• Pending approvals\n• Navigating Dhaaga";
    }
    // Fallback: call LLM via orchestrator
    return null; // signal async needed
  };

  const send = async () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(m => [...m, { role: 'user', text: userMsg }]);
    setLoading(true);

    // Try local answer first
    const localAnswer = getAnswer(userMsg);
    if (localAnswer) {
      setTimeout(() => {
        setMessages(m => [...m, { role: 'assistant', text: localAnswer }]);
        setLoading(false);
      }, 400);
      return;
    }

    // Fallback to orchestrator /chat
    try {
      const { data } = await axios.post(`${ORCH_BASE}/chat`, {
        message:  userMsg,
        owner_id: userProfile?.id,
        context:  { total_runs: myRuns.length, recent: myRuns.slice(0, 3) },
      });
      setMessages(m => [...m, { role: 'assistant', text: data.reply }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', text: "Sorry, I couldn't reach the server. Try asking about your ticket count or run status!" }]);
    }
    setLoading(false);
  };

  return (
    <>
      {/* Floating button */}
      <button onClick={() => setOpen(o => !o)} style={{
        position: 'fixed', bottom: 28, right: 28, zIndex: 1000,
        width: 56, height: 56, borderRadius: '50%',
        background: 'linear-gradient(135deg, #00D4AA, #6366f1)',
        border: 'none', cursor: 'pointer', fontSize: 24,
        boxShadow: '0 4px 20px rgba(0,212,170,0.5)',
        transition: 'transform 0.2s',
        transform: open ? 'rotate(45deg)' : 'none',
      }}>
        {open ? '✕' : '🤖'}
      </button>

      {/* Chat window */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 96, right: 28, zIndex: 999,
          width: 340, height: 440,
          background: '#0a0f1e',
          border: '1px solid rgba(0,212,170,0.3)',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 16px',
            background: 'linear-gradient(90deg, rgba(0,212,170,0.15), rgba(99,102,241,0.15))',
            borderBottom: '1px solid rgba(0,212,170,0.2)',
          }}>
            <div style={{ fontWeight: 700, color: '#00D4AA', fontSize: 14 }}>🤖 Dhaaga Assistant</div>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>Ask about your workflows</div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background: m.role === 'user'
                  ? 'linear-gradient(135deg, #00D4AA, #06b6d4)'
                  : 'rgba(255,255,255,0.07)',
                color: m.role === 'user' ? '#050d1a' : 'rgba(255,255,255,0.85)',
                padding: '8px 12px',
                borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                fontSize: 13, lineHeight: 1.5,
                whiteSpace: 'pre-line',
              }}>
                {m.text}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: 'flex-start', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                Dhaaga is thinking...
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            display: 'flex', gap: 8, padding: '10px 12px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Ask anything..."
              style={{
                flex: 1, background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(0,212,170,0.2)',
                borderRadius: 8, padding: '8px 12px',
                color: '#fff', fontSize: 13, outline: 'none',
              }}
            />
            <button onClick={send} style={{
              background: 'linear-gradient(135deg,#00D4AA,#6366f1)',
              border: 'none', borderRadius: 8,
              padding: '8px 14px', cursor: 'pointer',
              color: '#fff', fontWeight: 700, fontSize: 13,
            }}>→</button>
          </div>
        </div>
      )}
    </>
  );
};

/* ── My Tickets Panel ── */
const MyTickets = ({ runs, navigate }) => {
  const [expanded, setExpanded] = useState(null);

  const statusColor = (s) => ({
    success: '#00D4AA', failed: '#EF4444',
    running: '#6366f1', paused: '#E8C547',
    queued: '#9ca3af',
  }[s] || '#9ca3af');

  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(0,212,170,0.15)',
      borderRadius: 16, padding: 20, marginTop: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ color: '#fff', margin: 0, fontSize: 18, fontWeight: 700 }}>
          🎫 My Workflow Requests
          <span style={{
            marginLeft: 10, background: 'rgba(0,212,170,0.15)',
            color: '#00D4AA', fontSize: 13, fontWeight: 700,
            padding: '2px 10px', borderRadius: 20,
          }}>
            {runs.length} total
          </span>
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { label: `✅ ${runs.filter(r => r.status === 'success').length}`,  color: '#00D4AA' },
            { label: `⚡ ${runs.filter(r => r.status === 'running' || r.status === 'paused').length}`, color: '#6366f1' },
            { label: `❌ ${runs.filter(r => r.status === 'failed').length}`,   color: '#EF4444' },
          ].map((s, i) => (
            <span key={i} style={{
              fontSize: 12, fontWeight: 700, color: s.color,
              background: `${s.color}15`, padding: '3px 10px', borderRadius: 20,
            }}>{s.label}</span>
          ))}
        </div>
      </div>

      {runs.length === 0 ? (
        <div style={{ color: 'rgba(255,255,255,0.3)', textAlign: 'center', padding: '20px 0', fontSize: 14 }}>
          No workflow requests yet. Plan your first workflow above!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {runs.map((run, idx) => (
            <div key={run.id}>
              <button
                onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                style={{
                  width: '100%', textAlign: 'left',
                  background: expanded === run.id ? 'rgba(0,212,170,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${expanded === run.id ? 'rgba(0,212,170,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 10, padding: '12px 16px',
                  cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'space-between',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'rgba(0,212,170,0.15)',
                    color: '#00D4AA', fontWeight: 800, fontSize: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{idx + 1}</span>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>
                      {run.workflow_name || run.id}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
                      {run.created_at ? new Date(run.created_at).toLocaleString('en-IN') : ''}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: statusColor(run.status),
                    background: `${statusColor(run.status)}15`,
                    padding: '3px 10px', borderRadius: 20,
                  }}>{run.status}</span>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                    {expanded === run.id ? '▲' : '▼'}
                  </span>
                </div>
              </button>

              {/* Expanded logs */}
              {expanded === run.id && (
                <div style={{
                  background: '#0d1117',
                  border: '1px solid rgba(0,212,170,0.1)',
                  borderTop: 'none', borderRadius: '0 0 10px 10px',
                  padding: 14,
                }}>
                  <button
                    onClick={() => navigate(`/runs/${run.id}`)}
                    style={{
                      background: 'linear-gradient(90deg,#00D4AA,#06b6d4)',
                      border: 'none', borderRadius: 8,
                      padding: '8px 16px', cursor: 'pointer',
                      color: '#050d1a', fontWeight: 700, fontSize: 13,
                      marginBottom: 10,
                    }}
                  >
                    ⚡ Open Run Dashboard →
                  </button>
                  <RunLogs runId={run.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Inline Run Logs ── */
const RunLogs = ({ runId }) => {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    supabase.from('run_logs').select('*').eq('run_id', runId)
      .order('timestamp', { ascending: true })
      .then(({ data }) => setLogs(data || []));
  }, [runId]);

  const levelColor = l => ({ error: '#EF4444', warning: '#F59E0B', info: '#00D4AA' }[l] || '#9ca3af');

  return (
    <div style={{ fontFamily: 'monospace', fontSize: 12, maxHeight: 180, overflowY: 'auto' }}>
      {logs.length === 0
        ? <div style={{ color: 'rgba(255,255,255,0.3)' }}>No logs yet...</div>
        : logs.map((l, i) => (
          <div key={i} style={{ color: levelColor(l.level), marginBottom: 3 }}>
            <span style={{ color: 'rgba(255,255,255,0.25)', marginRight: 8 }}>
              {l.timestamp ? new Date(l.timestamp).toLocaleTimeString('en-IN') : ''}
            </span>
            {l.message}
          </div>
        ))
      }
    </div>
  );
};

/* ── Main WorkflowBuilder ── */
const WorkflowBuilder = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [dag,         setDag]         = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [myRuns,      setMyRuns]      = useState([]);
  const [workflowId,  setWorkflowId]  = useState(null);

  // Load user's own runs
  useEffect(() => {
    if (!user) return;
    supabase.from('workflow_runs')
      .select('*')
      .eq('requested_by', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setMyRuns(data || []));
  }, [user]);

  const handlePlan = async () => {
    if (!name.trim() || !description.trim()) {
      alert('Please enter both a workflow name and description.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.post(`${API_BASE}/api/workflows/plan`, {
        name, description, owner_id: user?.id || 'demo',
      });
      setDag(data.dag);
      setSuggestions(data.suggestions || []);
      setWorkflowId(data.workflow?.id || null);
    } catch (e) {
      alert('Planning failed: ' + (e.response?.data?.error || e.message));
    }
    setLoading(false);
  };

  const handleExecute = async () => {
    if (!dag) return;
    setLoading(true);
    try {
      const runId = `run-${Date.now()}`;

      // Save run to Supabase directly (so it shows in My Tickets)
      await supabase.from('workflow_runs').insert({
        id:            runId,
        workflow_id:   workflowId || runId,
        workflow_name: name,
        status:        'queued',
        requested_by:  user?.id,
        mode:          'dry-run',
        created_at:    new Date().toISOString(),
      });

      // Tell orchestrator to execute
      await axios.post(`${ORCH_BASE}/execute`, {
        run_id:      runId,
        workflow_id: workflowId || runId,
        dag,
        dry_run:     true,
      });

      // Refresh my runs
      const { data } = await supabase.from('workflow_runs')
        .select('*').eq('requested_by', user?.id)
        .order('created_at', { ascending: false });
      setMyRuns(data || []);

      navigate(`/runs/${runId}`);
    } catch (e) {
      alert('Execution failed: ' + (e.response?.data?.error || e.message));
    }
    setLoading(false);
  };

  const typeColor = t => ({ trigger: '#E8C547', action: '#00D4AA', notify: '#6366f1', utility: '#F59E0B' }[t] || '#9ca3af');

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: '#fff', fontWeight: 800, fontSize: 28, margin: 0 }}>
          ⚡ Workflow Builder
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 6, fontSize: 14 }}>
          Describe your workflow in plain English — the AI Planner will build the execution DAG.
        </p>
      </div>

      {/* Form */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16, padding: 24, marginBottom: 20,
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20 }}>
          <div>
            <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 700, letterSpacing: '0.5px', display: 'block', marginBottom: 8 }}>WORKFLOW NAME</label>
            <input
              value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Critical Bug Triage"
              style={{
                width: '100%', padding: '11px 14px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, color: '#fff', fontSize: 14,
                outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s'
              }}
              onFocus={e => e.target.style.borderColor = '#E8C547'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
            />
          </div>
          <div>
            <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 700, letterSpacing: '0.5px', display: 'block', marginBottom: 8 }}>NATURAL LANGUAGE DESCRIPTION</label>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="e.g. When a critical bug is filed in Jira, create a GitHub branch, notify on-call in Slack, and update the incident tracker..."
              style={{
                width: '100%', padding: '11px 14px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10, color: '#fff', fontSize: 14,
                outline: 'none', resize: 'vertical', boxSizing: 'border-box',
                fontFamily: 'inherit', transition: 'border-color 0.2s'
              }}
              onFocus={e => e.target.style.borderColor = '#E8C547'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
            />
          </div>
        </div>
        <button className="magnetic-hover" onClick={handlePlan} disabled={loading} style={{
          marginTop: 16, padding: '12px 28px',
          background: loading ? 'rgba(232,197,71,0.3)' : 'linear-gradient(90deg,#E8C547,#F59E0B)',
          border: 'none', borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer',
          color: '#050d1a', fontWeight: 700, fontSize: 15,
          boxShadow: loading ? 'none' : '0 0 20px rgba(232,197,71,0.4)',
        }}>
          {loading ? '🧠 Planning...' : '🧠 Plan Workflow'}
        </button>
      </div>

      {/* DAG Result */}
      {dag && (
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(0,212,170,0.2)',
          borderRadius: 16, padding: 24, marginBottom: 20,
        }}>
          <h2 style={{ color: '#fff', fontWeight: 700, fontSize: 18, marginBottom: 16 }}>
            📊 Planned DAG
            <span style={{ marginLeft: 10, color: '#00D4AA', fontSize: 14, fontWeight: 500 }}>
              ({dag.length} steps)
            </span>
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dag.map((node, i) => (
              <div key={node.id} className="float-anim stagger-anim" style={{
                animationDelay: `${i * 0.15}s`,
                display: 'flex', alignItems: 'flex-start', gap: 14,
                background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(10px)',
                border: `1px solid rgba(255,255,255,0.08)`,
                borderLeft: `4px solid ${typeColor(node.type)}`,
                borderRadius: 10, padding: '12px 16px',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #E8C547, #F59E0B)',
                  color: '#050d1a', fontWeight: 800, fontSize: 13,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{node.id}</span>
                    <span style={{
                      fontSize: 11, fontWeight: 700,
                      color: typeColor(node.type),
                      background: `${typeColor(node.type)}15`,
                      padding: '2px 8px', borderRadius: 20,
                    }}>{node.type}</span>
                    {node.approval_required && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#E8C547', background: 'rgba(232,197,71,0.15)', padding: '2px 8px', borderRadius: 20 }}>
                        🔐 Approval Gate
                      </span>
                    )}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                    Server: <code style={{ color: '#00D4AA' }}>{node.mcp_server}</code>
                    {' '}Tool: <code style={{ color: '#E8C547' }}>{node.tool}</code>
                    {node.depends_on?.length > 0 && (
                      <span style={{ marginLeft: 10, color: 'rgba(255,255,255,0.3)' }}>
                        Depends on: {node.depends_on.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {suggestions.length > 0 && (
            <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(99,102,241,0.08)', borderRadius: 10, border: '1px solid rgba(99,102,241,0.2)' }}>
              <div style={{ color: '#6366f1', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>💡 AI Suggestions</div>
              {suggestions.map((s, i) => (
                <div key={i} style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 4 }}>• {s}</div>
              ))}
            </div>
          )}

          <button className="magnetic-hover-teal" onClick={handleExecute} disabled={loading} style={{
            marginTop: 16, padding: '12px 28px',
            background: loading ? 'rgba(0,212,170,0.3)' : 'linear-gradient(90deg,#00D4AA,#06b6d4)',
            border: 'none', borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer',
            color: '#050d1a', fontWeight: 800, fontSize: 15,
            boxShadow: loading ? 'none' : '0 0 20px rgba(0,212,170,0.4)',
          }}>
            {loading ? 'Starting...' : '🚀 Execute Workflow'}
          </button>
        </div>
      )}

      {/* My Tickets */}
      <MyTickets runs={myRuns} navigate={navigate} />

      {/* Chatbot */}
      <Chatbot userProfile={profile} myRuns={myRuns} />
    </div>
  );
};

export default WorkflowBuilder;