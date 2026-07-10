import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowRight, 
  ShieldCheck, 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  KeyRound
} from 'lucide-react';
import { useLogin } from '../../lib/queries.js';
import { useAuthStore } from '../../store/authStore.js';

export function LoginPage() {
  const [email, setEmail] = useState('admin@mysteryrooms.in');
  const [password, setPassword] = useState('Admin@123');
  const [showPassword, setShowPassword] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0, glowX: 0, glowY: 0 });
  
  const login = useLogin();
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  // Prevent scrollbars on the body while login screen is active
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      const { data } = await login.mutateAsync({ email, password });
      setAuth({ user: data.user, accessToken: data.accessToken });
      navigate('/');
    } catch (error) {
      // handled by login query error state
    }
  };

  const handleMouseMove = (e) => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const x = (e.clientX / width) - 0.5; // -0.5 to 0.5
    const y = (e.clientY / height) - 0.5; // -0.5 to 0.5
    
    setTilt({
      x: x * 10,   // rotateY
      y: y * -10,  // rotateX
      glowX: x * 50,
      glowY: y * 50
    });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0, glowX: 0, glowY: 0 });
  };

  const handleQuickFill = () => {
    setIsAutofilling(true);
    setEmail('admin@mysteryrooms.in');
    setPassword('Admin@123');
    setTimeout(() => {
      setIsAutofilling(false);
    }, 800);
  };

  const err = login.error?.response?.data?.message;

  return (
    <div 
      className="login-wrap-centered"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Dynamic backdrop glows behind card */}
      <div 
        className="login-glow-centered-1"
        style={{
          transform: `translate(${tilt.glowX * -1.2}px, ${tilt.glowY * -1.2}px)`
        }}
      />
      <div 
        className="login-glow-centered-2"
        style={{
          transform: `translate(${tilt.glowX * 0.8}px, ${tilt.glowY * 0.8}px)`
        }}
      />

      {/* Floating particles */}
      <div className="floating-particle" style={{ width: 140, height: 140, top: '15%', left: '10%', animationDuration: '12s' }} />
      <div className="floating-particle" style={{ width: 90, height: 90, bottom: '25%', right: '15%', animationDuration: '16s' }} />
      <div className="floating-particle" style={{ width: 110, height: 110, top: '70%', left: '20%', animationDuration: '14s' }} />
      <div className="floating-particle" style={{ width: 70, height: 70, top: '20%', right: '25%', animationDuration: '18s' }} />

      {/* Centered glassmorphism console card */}
      <div 
        className="login-card-centered animate-fade-in-up anim-delay-2"
        style={{
          transform: `perspective(1000px) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg)`,
          transition: isAutofilling ? 'none' : 'transform 0.2s ease-out'
        }}
      >
        <form onSubmit={onSubmit} className="fade-in">
          {/* Logo */}
          <div className="center animate-fade-in-up anim-delay-1" style={{ marginBottom: 16 }}>
            <img 
              src="/logo.png" 
              alt="Mystery Rooms" 
              style={{
                width: 150,
                height: 'auto',
                filter: 'drop-shadow(0 6px 18px rgba(224, 161, 58, 0.28))'
              }}
            />
          </div>

          {/* Module badge */}
          <div className="center animate-fade-in-up anim-delay-2" style={{ marginBottom: 20 }}>
            <div 
              className="badge" 
              style={{ 
                background: 'rgba(224,161,58,0.1)', 
                color: '#e8bb63', 
                border: '1px solid rgba(224,161,58,0.18)',
                fontSize: '10.5px',
                padding: '3px 10px'
              }}
            >
              Module 1 · Project Management System
            </div>
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: '#fff', textAlign: 'center' }}>
            Welcome back
          </h2>
          <p style={{ marginTop: 4, marginBottom: 22, fontSize: 13, color: 'rgba(255, 255, 255, 0.5)', textAlign: 'center' }}>
            Sign in to your operations console.
          </p>

          {/* Form fields */}
          <div className="field animate-fade-in-up anim-delay-3">
            <label className="label" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>Email Address</label>
            <div className="login-input-wrapper">
              <input
                className={`input ${isAutofilling ? 'input-pulse-flash' : ''}`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="Enter your email"
                required
              />
              <Mail className="login-input-icon" size={16} />
            </div>
          </div>

          <div className="field animate-fade-in-up anim-delay-4">
            <label className="label" style={{ color: 'rgba(255, 255, 255, 0.6)' }}>Password</label>
            <div className="login-input-wrapper">
              <input
                className={`input ${isAutofilling ? 'input-pulse-flash' : ''}`}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
              <Lock className="login-input-icon" size={16} />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {err && (
            <div 
              className="badge fade-in" 
              style={{ 
                background: 'var(--danger-soft)', 
                color: 'var(--danger)', 
                marginBottom: 12, 
                width: '100%', 
                justifyContent: 'center',
                padding: '8px 12px',
                borderRadius: 'var(--radius)'
              }}
            >
              {err}
            </div>
          )}

          <button 
            className="btn btn-primary full btn-shimmer-wrap animate-fade-in-up anim-delay-5" 
            style={{ padding: '10px', marginTop: 6, height: 42 }} 
            disabled={login.isPending}
          >
            {login.isPending ? (
              <span className="spinner" />
            ) : (
              <>
                <span>Sign in</span> 
                <ArrowRight size={16} />
              </>
            )}
          </button>

          {/* Quick Fill Key Card */}
          <div className="login-demo-card animate-fade-in-up anim-delay-6" onClick={handleQuickFill} title="Click to fill credentials">
            <div className="login-demo-card-icon">
              <KeyRound size={15} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="login-demo-text-primary">
                Quick Access Key
              </div>
              <div className="login-demo-text-secondary">
                admin@mysteryrooms.in / Admin@123
              </div>
            </div>
          </div>

          {/* Security details footer */}
          <div 
            className="row center gap-2 animate-fade-in-up anim-delay-6" 
            style={{ color: 'rgba(255, 255, 255, 0.35)', fontSize: 10.5, marginTop: 22, justifyContent: 'center' }}
          >
            <ShieldCheck size={14} style={{ color: 'var(--primary)' }} /> 
            <span>Role-based access · Audit trail · Secured API</span>
          </div>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;
