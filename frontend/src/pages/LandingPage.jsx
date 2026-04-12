// frontend/src/pages/LandingPage.jsx
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';

/* ── Floating particles canvas ── */
const ParticleCanvas = () => {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx    = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = Array.from({ length: 80 }, () => ({
      x:   Math.random() * canvas.width,
      y:   Math.random() * canvas.height,
      vx:  (Math.random() - 0.5) * 0.4,
      vy:  (Math.random() - 0.5) * 0.4,
      r:   Math.random() * 2 + 1,
      a:   Math.random(),
    }));

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width)  p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,212,170,${p.a * 0.6})`;
        ctx.fill();
      });
      // Draw connecting lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 130) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(232,197,71,${0.9 * (1 - dist / 130)})`;
            ctx.lineWidth = 1.0;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    const onResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);
  return <canvas ref={ref} style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} />;
};

/* ── Glowing input ── */
const GlowInput = ({ type = 'text', value, onChange, placeholder, style = {} }) => (
  <input
    type={type} value={value} onChange={onChange} placeholder={placeholder}
    style={{
      width: '100%', padding: '11px 16px',
      background: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(0,212,170,0.3)',
      borderRadius: 10, color: '#fff', fontSize: 14,
      outline: 'none', boxSizing: 'border-box', marginBottom: 14,
      transition: 'border-color 0.2s',
      ...style,
    }}
    onFocus={e => e.target.style.borderColor = 'rgba(0,212,170,0.9)'}
    onBlur={e  => e.target.style.borderColor = 'rgba(0,212,170,0.3)'}
  />
);

/* ── Main component ── */
const LandingPage = () => {
  const [tab,         setTab]         = useState('login');
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role,        setRole]        = useState('worker');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [message,     setMessage]     = useState(null);
  const [dots,        setDots]        = useState('');

  // Animated dots on loading
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(id);
  }, [loading]);

  const handleLogin = async () => {
    setLoading(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  };

  const handleSignup = async () => {
    if (!displayName.trim()) { setError('Display name is required.'); return; }
    setLoading(true); setError(null);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { display_name: displayName, role } },
    });
    if (error) setError(error.message);
    else setMessage('Account created! You can now log in.');
    setLoading(false);
  };

  const handleGoogle = () => supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0a0f1e',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Video Background */}
      <video
        autoPlay muted loop playsInline
        style={{
          position: 'absolute', width: '100%', height: '100%',
          objectFit: 'cover', zIndex: 0,
        }}
        src="/landing-bg.mov"
      />
      {/* Dark Overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(5, 10, 20, 0.75)', zIndex: 0,
      }} />

      <ParticleCanvas />

      {/* Glow blobs */}
      <div style={{ position: 'fixed', top: '20%', left: '10%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,212,170,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '20%', right: '10%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 440, padding: '0 20px' }}>

        {/* Hero text */}
        <div style={{ textAlign: 'center', marginBottom: 32 }} className="stagger-anim">
          <div style={{ fontSize: 52, marginBottom: 8, filter: 'drop-shadow(0 0 20px rgba(232,197,71,0.6))', animation: 'floatAnim 4s ease-in-out infinite' }}>✦</div>
          <h1 style={{
            margin: 0, fontSize: 48, fontWeight: 800,
            fontFamily: '"Space Grotesk", sans-serif',
            color: '#E8C547',
            letterSpacing: '-1px',
          }}>
            Dhaaga
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', margin: '8px 0 0', fontSize: 16, letterSpacing: '0.5px' }}>
            Connect workflows like threads
          </p>
        </div>

        {/* Card */}
        <div className="stagger-anim stagger-delay-1 float-anim" style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(232,197,71,0.15)',
          borderRadius: 20,
          padding: '32px 28px',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}>

          {/* Tabs */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 4, marginBottom: 24 }}>
            {['login', 'signup'].map(t => (
              <button key={t} onClick={() => { setTab(t); setError(null); setMessage(null); }} style={{
                flex: 1, padding: '8px', border: 'none', borderRadius: 8, cursor: 'pointer',
                background: tab === t ? 'rgba(0,212,170,0.15)' : 'transparent',
                color: tab === t ? '#00d4aa' : 'rgba(255,255,255,0.4)',
                fontWeight: tab === t ? 700 : 500, fontSize: 14,
                transition: 'all 0.2s',
                boxShadow: tab === t ? '0 0 12px rgba(0,212,170,0.2)' : 'none',
              }}>
                {t === 'login' ? 'Log In' : 'Sign Up'}
              </button>
            ))}
          </div>

          {/* Alerts */}
          {error   && <div style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13 }}>⚠ {error}</div>}
          {message && <div style={{ color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13 }}>✅ {message}</div>}

          {/* Signup-only fields */}
          {tab === 'signup' && (
            <>
              <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>DISPLAY NAME</label>
              <GlowInput value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Hardik Manglani" />

              <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: 8 }}>ROLE</label>
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                {[
                  { value: 'worker',  icon: '👷', label: 'Developer' },
                  { value: 'manager', icon: '👔', label: 'Manager'   },
                ].map(r => (
                  <button key={r.value} onClick={() => setRole(r.value)} style={{
                    flex: 1, padding: '10px', borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${role === r.value ? 'rgba(0,212,170,0.8)' : 'rgba(255,255,255,0.1)'}`,
                    background: role === r.value ? 'rgba(0,212,170,0.12)' : 'rgba(255,255,255,0.03)',
                    color: role === r.value ? '#00d4aa' : 'rgba(255,255,255,0.5)',
                    fontWeight: role === r.value ? 700 : 500, fontSize: 14,
                    boxShadow: role === r.value ? '0 0 16px rgba(0,212,170,0.2)' : 'none',
                    transition: 'all 0.2s',
                  }}>
                    {r.icon} {r.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Email + Password */}
          <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>EMAIL</label>
          <GlowInput type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />

          <label style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>PASSWORD</label>
          <GlowInput type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />

          {/* Submit */}
          <button
            onClick={tab === 'login' ? handleLogin : handleSignup}
            disabled={loading}
            style={{
              width: '100%', padding: '12px', borderRadius: 10,
              background: loading ? 'rgba(0,212,170,0.3)' : 'linear-gradient(90deg, #00d4aa, #06b6d4)',
              border: 'none', color: '#050d1a', fontWeight: 800,
              fontSize: 15, cursor: loading ? 'not-allowed' : 'pointer',
              marginBottom: 12, letterSpacing: '0.3px',
              boxShadow: loading ? 'none' : '0 0 24px rgba(0,212,170,0.4)',
              transition: 'all 0.2s',
            }}
          >
            {loading ? `Processing${dots}` : tab === 'login' ? '→ Log In' : '→ Create Account'}
          </button>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 12px' }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
          </div>

          {/* Google */}
          <button onClick={handleGoogle} style={{
            width: '100%', padding: '11px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, cursor: 'pointer',
            color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            transition: 'all 0.2s',
          }}
            onMouseOver={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'}
            onMouseOut={e  => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
          >
            <img src="https://www.google.com/favicon.ico" width={16} height={16} alt="" />
            Continue with Google
          </button>

          {/* Role hint */}
          <div style={{ marginTop: 20, padding: '12px 14px', background: 'rgba(0,212,170,0.05)', borderRadius: 10, border: '1px solid rgba(0,212,170,0.1)' }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, lineHeight: 1.7 }}>
              <span style={{ color: '#00d4aa' }}>👔 Manager</span> — approve workflows, view all runs<br />
              <span style={{ color: '#6366f1' }}>👷 Developer</span> — create & execute workflows, view own runs
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;