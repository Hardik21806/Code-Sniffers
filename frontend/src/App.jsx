// frontend/src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import LandingPage     from './pages/LandingPage.jsx';
import WorkflowBuilder from './components/WorkflowBuilder.jsx';
import RunDashboard    from './components/RunDashboard.jsx';
import ApprovalsPanel  from './components/ApprovalsPanel.jsx';
import '@xyflow/react/dist/style.css';

const Protected = ({ children, managerOnly = false }) => {
  const { user, profile, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user)   return <Navigate to="/login" replace />;
  if (managerOnly && profile?.role !== 'manager') return <Navigate to="/" replace />;
  return children;
};

const Spinner = () => (
  <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050d1a' }}>
    <div style={{ color: '#00d4aa', fontSize: 18 }}>⚡ Loading...</div>
  </div>
);

const InnerApp = () => {
  const { user, profile, loading, signOut } = useAuth();
  if (loading) return <Spinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif', background: 'var(--color-bg)' }}>

      {user && (
        <nav style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 24px', height: 56, background: 'rgba(5, 10, 20, 0.95)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(232, 197, 71, 0.15)',
          boxShadow: '0 2px 20px rgba(0,0,0,0.3)',
          position: 'sticky', top: 0, zIndex: 100,
        }}>
          <span style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 800, fontSize: 20, color: 'var(--color-primary)' }}>
            ✦ Dhaaga
          </span>

          <div style={{ display: 'flex', gap: 6 }}>
            <NavLink to="/" end style={({ isActive }) => ({
              padding: '6px 14px', borderRadius: 6, textDecoration: 'none', fontSize: 14, fontWeight: 500,
              color: isActive ? 'var(--color-primary)' : 'rgba(255,255,255,0.5)',
              borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
              transition: 'all 0.2s',
            })}>
              Workflow Builder
            </NavLink>
            {profile?.role === 'manager' && (
              <NavLink to="/approvals" style={({ isActive }) => ({
                padding: '6px 14px', borderRadius: 6, textDecoration: 'none', fontSize: 14, fontWeight: 500,
                color: isActive ? 'var(--color-primary)' : 'rgba(255,255,255,0.5)',
                borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                transition: 'all 0.2s',
              })}>
                🔐 Approvals
              </NavLink>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                {profile?.display_name || user.email}
              </div>
              <div style={{
                fontSize: 11, fontWeight: 700,
                color: profile?.role === 'manager' ? '#050d1a' : '#050d1a',
                background: profile?.role === 'manager' ? 'var(--color-primary)' : 'var(--color-accent)',
                padding: '2px 8px', borderRadius: '12px', display: 'inline-block', marginTop: '2px',
                boxShadow: profile?.role === 'manager' ? '0 0 10px rgba(232, 197, 71, 0.4)' : '0 0 10px rgba(0, 212, 170, 0.4)'
              }}>
                {profile?.role === 'manager' ? '👔 Manager' : '👷 Developer'}
              </div>
            </div>
            <button className="magnetic-hover-red" onClick={signOut} style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', fontSize: 13,
              transition: 'all 0.2s'
            }}
            onMouseOver={e => { e.currentTarget.style.color = '#EF4444'; e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.5)'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
            onMouseOut={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}>
              Logout
            </button>
          </div>
        </nav>
      )}

      <main style={user ? { flex: 1, padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' } : { flex: 1 }}>
        <Routes>
          <Route path="/login"         element={user ? <Navigate to="/" replace /> : <LandingPage />} />
          <Route path="/"              element={<Protected><WorkflowBuilder /></Protected>} />
          <Route path="/runs/:runId"   element={<Protected><RunDashboard /></Protected>} />
          <Route path="/approvals"     element={<Protected managerOnly><ApprovalsPanel /></Protected>} />
          <Route path="*"              element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <InnerApp />
      </Router>
    </AuthProvider>
  );
}