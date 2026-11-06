import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function AuthPage() {
  const { user, loading: authLoading, signIn, signUp, sendPasswordReset, setNewPassword } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  // Arrived from a reset email. The link signs you in; this is where the new
  // password gets chosen. An old or used link comes back with an error instead.
  const resetting = params.get('reset') === '1';
  const [linkFailed] = useState(() => /[#&]error/.test(window.location.hash));
  const [resetSent, setResetSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  // Signed in, by this form or already when it opened: back to Settings,
  // where the sync shows it has started. Staying here left a filled-in login
  // form on screen with no sign that it had worked.
  useEffect(() => {
    if (user && !resetting) navigate('/settings', { replace: true });
  }, [user, resetting, navigate]);

  const askAgain = () => {
    setParams({}, { replace: true });
    setMode('forgot');
    setResetSent(false);
    setError('');
  };

  const saveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: failed } = await setNewPassword(password);
    setLoading(false);
    if (failed) { setError(failed); return; }
    toast.success('Password saved');
    navigate('/settings', { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (mode === 'forgot') {
      const { error: failed } = await sendPasswordReset(email);
      if (failed) setError(failed);
      else setResetSent(true);
    } else if (mode === 'login') {
      const { error: failed } = await signIn(email, password);
      if (failed) setError(failed);
    } else {
      const { error: failed, signedIn } = await signUp(email, password);
      if (failed) setError(failed);
      else if (!signedIn) setSignupSuccess(true);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="text-center mb-8">
          <h1 className="text-3xl font-display tracking-wide text-foreground">Show Flow</h1>
          <p className="text-[11px] text-mono text-muted-foreground mt-2 tracking-[0.2em] uppercase">
            Shifts · hours · pay
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          {resetting ? (
            // Back from the email.
            user ? (
              <form onSubmit={saveNewPassword} className="space-y-4">
                <div>
                  <p className="text-sm font-semibold">Choose a new password</p>
                  <p className="mt-1 text-[11px] text-muted-foreground break-all">{user.email}</p>
                </div>
                <Input
                  type="password"
                  placeholder="New password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoFocus
                  autoComplete="new-password"
                />
                {error && <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 size={16} className="mr-2 animate-spin" />}
                  Save password
                </Button>
              </form>
            ) : linkFailed || !authLoading ? (
              <div className="text-center py-2 space-y-3">
                <p className="text-sm font-semibold">That link didn't work</p>
                <p className="text-xs text-muted-foreground">It may have expired, or been used already. Each link works once.</p>
                <Button className="w-full" onClick={askAgain}>Send a new link</Button>
              </div>
            ) : (
              <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
            )
          ) : mode === 'forgot' ? (
            resetSent ? (
              <div className="text-center py-2 space-y-3">
                <p className="text-sm font-semibold">Check your email</p>
                <p className="text-xs text-muted-foreground">
                  If {email} has an account, a link to choose a new password is on its way. It can take a minute. Check spam too.
                </p>
                <Button variant="outline" className="w-full" onClick={() => { setMode('login'); setResetSent(false); }}>Back to log in</Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <p className="text-sm font-semibold">Forgot your password?</p>
                  <p className="mt-1 text-xs text-muted-foreground">Type your email and we'll send a link to choose a new one.</p>
                </div>
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                  autoComplete="email"
                />
                {error && <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 size={16} className="mr-2 animate-spin" />}
                  Email me a link
                </Button>
                <button type="button" onClick={() => { setMode('login'); setError(''); }} className="w-full text-xs text-muted-foreground hover:text-foreground">
                  Back to log in
                </button>
              </form>
            )
          ) : signupSuccess ? (
            <div className="text-center py-4">
              <p className="text-sm text-foreground font-medium">Check your email</p>
              <p className="text-xs text-muted-foreground mt-2">
                We sent a confirmation link to <strong>{email}</strong>
              </p>
              <Button
                variant="ghost"
                className="mt-4 text-xs"
                onClick={() => { setSignupSuccess(false); setMode('login'); }}
              >
                Back to login
              </Button>
            </div>
          ) : (
            <>
              <div className="flex gap-1 mb-6 rounded-lg bg-secondary/50 p-1">
                <button
                  onClick={() => { setMode('login'); setError(''); }}
                  className={`flex-1 text-xs font-medium py-2 rounded-md transition-colors ${
                    mode === 'login' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Log In
                </button>
                <button
                  onClick={() => { setMode('signup'); setError(''); }}
                  className={`flex-1 text-xs font-medium py-2 rounded-md transition-colors ${
                    mode === 'signup' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Sign Up
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />

                {error && (
                  <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 size={16} className="mr-2 animate-spin" />}
                  {mode === 'login' ? 'Log In' : 'Create Account'}
                </Button>
                {mode === 'login' && (
                  <button type="button" onClick={() => { setMode('forgot'); setError(''); }} className="w-full text-xs text-muted-foreground hover:text-foreground">
                    Forgot password?
                  </button>
                )}
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
