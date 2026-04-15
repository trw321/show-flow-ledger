import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = mode === 'login'
      ? await signIn(email, password)
      : await signUp(email, password);

    if (result.error) {
      setError(result.error);
    } else if (mode === 'signup') {
      setSignupSuccess(true);
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
          <h1 className="text-3xl font-bold text-mono tracking-widest funky-gradient-text">
            AV LEDGER
          </h1>
          <p className="text-xs text-muted-foreground mt-2 tracking-wide uppercase">
            Bookkeeping for AV technicians
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6">
          {signupSuccess ? (
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
              </form>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
