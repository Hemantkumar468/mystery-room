import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useLogin } from '../../lib/queries.js';
import { useAuthStore } from '../../store/authStore.js';

export function LoginPage() {
  const [email, setEmail] = useState('admin@mysteryrooms.in');
  const [password, setPassword] = useState('Admin@123');
  const login = useLogin();
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    const { data } = await login.mutateAsync({ email, password });
    setAuth({ user: data.user, accessToken: data.accessToken });
    navigate('/');
  };

  const err = login.error?.response?.data?.message;

  return (
    <div className="login-wrap">
      {/* Brand panel */}
      <div className="login-brand">
        <div className="login-glow login-glow-gold" />
        <div className="login-glow login-glow-teal" />

        <img src="/logo.png" alt="Mystery Rooms" className="login-logo" />

        <div style={{ position: 'relative', maxWidth: 440 }}>
          <div className="badge" style={{ background: 'rgba(224,161,58,0.16)', color: '#e8bb63', marginBottom: 20 }}>
            Module 1 · Project Management System
          </div>
          <h1 style={{ fontSize: 38, lineHeight: 1.12, fontWeight: 750, letterSpacing: '-0.02em', color: '#fff' }}>
            Open every outlet like&nbsp;clockwork.
          </h1>
          <p style={{ color: '#b7b2c2', marginTop: 18, fontSize: 15, lineHeight: 1.6 }}>
            Design a launch playbook once, run it in every city. Track sourcing to
            soft-launch with live MIS, master data and a shared calendar.
          </p>
        </div>

        <div className="row gap-2" style={{ position: 'relative', color: '#8b8798', fontSize: 12.5 }}>
          <ShieldCheck size={15} /> Role-based access · Audit trail · Encrypted credentials
        </div>
      </div>

      {/* Form panel */}
      <div className="center" style={{ background: 'var(--bg)', padding: 32 }}>
        <form onSubmit={onSubmit} style={{ width: '100%', maxWidth: 360 }} className="fade-in">
          <h2 style={{ fontSize: 24, fontWeight: 700 }}>Welcome back</h2>
          <p className="muted" style={{ marginTop: 6, marginBottom: 28 }}>
            Sign in to your operations console.
          </p>

          <div className="field">
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {err && (
            <div className="badge" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', marginBottom: 14 }}>
              {err}
            </div>
          )}

          <button className="btn btn-primary full" style={{ padding: '11px', marginTop: 6 }} disabled={login.isPending}>
            {login.isPending ? <span className="spinner" /> : <>Sign in <ArrowRight size={16} /></>}
          </button>

          <div
            className="sm muted"
            style={{ marginTop: 20, padding: 12, background: 'var(--surface-hover)', borderRadius: 'var(--radius)', textAlign: 'center' }}
          >
            Demo · <span className="mono">admin@mysteryrooms.in</span> / <span className="mono">Admin@123</span>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;
