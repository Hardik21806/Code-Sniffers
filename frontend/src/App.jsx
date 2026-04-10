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
