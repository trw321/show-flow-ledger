import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/AuthContext';
import PatternLock from '@/components/PatternLock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Eye, EyeOff, Copy, Check } from 'lucide-react';
import {
  patternToPassword,
  usernameToEmail,
  generateRecoveryPhrase,
  recoveryPhraseToPassword,
  savePatternSetup,
  loadPatternSetup,
} from '@/lib/patternAuth';

type Screen =
  | 'unlock'        // returning user — draw pattern
  | 'setup-name'    // new user — enter name/handle
  | 'setup-draw'    // new user — draw pattern (first time)
  | 'setup-confirm' // new user — confirm pattern
  | 'setup-phrase'  // show recovery phrase
  | 'recovery';     // forgot pattern — enter recovery phrase

export default function PatternAuthPage() {
  const { signIn, signUp } = useAuth();
  const setup = loadPatternSetup();
  const isReturning = !!setup;

  const [screen, setScreen] = useState<Screen>(isReturning ? 'unlock' : 'setup-name');
  const [username, setUsername] = useState('');
  const [firstPattern, setFirstPattern] = useState<number[]>([]);
  const [confirmedPattern, setConfirmedPattern] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [patternError, setPatternError] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [copied, setCopied] = useState(false);
  const [showPhrase, setShowPhrase] = useState(false);

  // ── Unlock (returning user) ──────────────────────────────────────────────
  const handleUnlock = async (pattern: number[]) => {
    if (!setup) return;
    setLoading(true);
    setPatternError(false);
    const password = patternToPassword(pattern);
    const result = await signIn(setup.email, password);
    if (result.error) {
      setPatternError(true);
      setError('Pattern not recognized — try again or use recovery phrase');
      setTimeout(() => { setPatternError(false); setError(''); }, 1500);
    }
    setLoading(false);
  };

  // ── Setup: step 1 — name ────────────────────────────────────────────────
  const handleNameSubmit = () => {
    if (!username.trim()) { setError('Enter a name or handle'); return; }
    setError('');
    setScreen('setup-draw');
  };

  // ── Setup: step 2 — draw pattern ────────────────────────────────────────
  const handleFirstPattern = (pattern: number[]) => {
    setFirstPattern(pattern);
    setScreen('setup-confirm');
  };

  // ── Setup: step 3 — confirm pattern ─────────────────────────────────────
  const handleConfirmPattern = async (pattern: number[]) => {
    if (pattern.join('') !== firstPattern.join('')) {
      setPatternError(true);
      setError("Patterns don't match — try again");
      setTimeout(() => {
        setPatternError(false);
        setError('');
        setScreen('setup-draw');
        setFirstPattern([]);
      }, 1500);
      return;
    }

    setLoading(true);
    setError('');

    const email = usernameToEmail(username);
    const password = patternToPassword(pattern);
    const phrase = generateRecoveryPhrase();
    const recoveryPassword = recoveryPhraseToPassword(phrase);

    // Try sign up with pattern password
    const signUpResult = await signUp(email, password);
    if (signUpResult.error && !signUpResult.error.includes('already registered')) {
      setError(signUpResult.error);
      setLoading(false);
      return;
    }

    // If already registered with this name, sign in instead
    if (signUpResult.error?.includes('already registered')) {
      const signInResult = await signIn(email, password);
      if (signInResult.error) {
        setError('This name is taken — try a different one');
        setLoading(false);
        setScreen('setup-name');
        return;
      }
      savePatternSetup({ username, email, recoveryPhrase: phrase });
      setRecoveryPhrase(phrase);
      setConfirmedPattern(pattern);
      setLoading(false);
      setScreen('setup-phrase');
      return;
    }

    // Also sign up a recovery account using the recovery phrase as password
    // We use a slightly different email for the recovery account
    const recoveryEmail = `recovery-${usernameToEmail(username)}`;
    await signUp(recoveryEmail, recoveryPassword);

    // Save setup locally
    savePatternSetup({ username, email, recoveryPhrase: phrase });
    setRecoveryPhrase(phrase);
    setConfirmedPattern(pattern);
    setLoading(false);
    setScreen('setup-phrase');
  };

  // ── Recovery ────────────────────────────────────────────────────────────
  const handleRecovery = async () => {
    if (!setup) return;
    setLoading(true);
    setError('');
    const password = recoveryPhraseToPassword(recoveryInput.trim());
    const recoveryEmail = `recovery-${setup.email}`;
    const result = await signIn(recoveryEmail, password);
    if (result.error) {
      setError('Recovery phrase not recognized');
    }
    setLoading(false);
  };

  const copyPhrase = () => {
    navigator.clipboard.writeText(recoveryPhrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-xs flex flex-col items-center gap-6"
      >
        {/* Logo */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-mono tracking-widest funky-gradient-text">AV LEDGER</h1>
          <p className="text-xs text-muted-foreground mt-1 tracking-wide uppercase">Bookkeeping for AV technicians</p>
        </div>

        <AnimatePresence mode="wait">

          {/* ── UNLOCK ── */}
          {screen === 'unlock' && (
            <motion.div key="unlock" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4 w-full">
              <p className="text-sm text-muted-foreground">
                Hey {setup?.username} — draw your pattern
              </p>
              <PatternLock onComplete={handleUnlock} disabled={loading} error={patternError} />
              {loading && <Loader2 size={20} className="animate-spin text-primary" />}
              {error && <p className="text-xs text-destructive text-center">{error}</p>}
              <button onClick={() => setScreen('recovery')} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2">
                Forgot pattern? Use recovery phrase
              </button>
              <button onClick={() => setScreen('setup-name')} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2">
                New user? Set up a new account
              </button>
            </motion.div>
          )}

          {/* ── SETUP: NAME ── */}
          {screen === 'setup-name' && (
            <motion.div key="setup-name" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-4 w-full">
              <p className="text-sm text-center text-muted-foreground">What should we call you?</p>
              <Input
                placeholder="Name or handle (e.g. T-Dubs)"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleNameSubmit()}
                autoFocus
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button onClick={handleNameSubmit} className="w-full">Next →</Button>
              {isReturning && (
                <button onClick={() => setScreen('unlock')} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2 text-center">
                  ← Back to unlock
                </button>
              )}
            </motion.div>
          )}

          {/* ── SETUP: DRAW ── */}
          {screen === 'setup-draw' && (
            <motion.div key="setup-draw" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4 w-full">
              <p className="text-sm text-muted-foreground text-center">Draw your pattern<br /><span className="text-xs">(connect at least 4 dots)</span></p>
              <PatternLock onComplete={handleFirstPattern} />
              <button onClick={() => { setFirstPattern([]); setScreen('setup-draw'); }} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2">
                Whoops — start over
              </button>
            </motion.div>
          )}

          {/* ── SETUP: CONFIRM ── */}
          {screen === 'setup-confirm' && (
            <motion.div key="setup-confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4 w-full">
              <p className="text-sm text-muted-foreground text-center">Draw it again to confirm</p>
              <PatternLock onComplete={handleConfirmPattern} disabled={loading} error={patternError} />
              {loading && <Loader2 size={20} className="animate-spin text-primary" />}
              {error && <p className="text-xs text-destructive text-center">{error}</p>}
              <button onClick={() => { setFirstPattern([]); setPatternError(false); setError(''); setScreen('setup-draw'); }} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2">
                Whoops — redo my pattern
              </button>
            </motion.div>
          )}

          {/* ── SETUP: RECOVERY PHRASE ── */}
          {screen === 'setup-phrase' && (
            <motion.div key="setup-phrase" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-4 w-full">
              <div className="text-center">
                <p className="text-sm font-medium">Save your recovery phrase</p>
                <p className="text-xs text-muted-foreground mt-1">If you forget your pattern, this is the only way back in. Write it down somewhere safe.</p>
              </div>

              <div className="rounded-xl border border-border bg-secondary/30 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Recovery phrase</span>
                  <button onClick={() => setShowPhrase(!showPhrase)} className="text-muted-foreground hover:text-foreground">
                    {showPhrase ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {showPhrase ? (
                  <p className="text-lg font-mono font-bold tracking-widest text-primary text-center">{recoveryPhrase}</p>
                ) : (
                  <p className="text-lg font-mono text-center text-muted-foreground tracking-widest">••••-••••-••••-••••</p>
                )}
                <Button variant="outline" size="sm" onClick={copyPhrase} className="w-full">
                  {copied ? <><Check size={14} className="mr-1" /> Copied!</> : <><Copy size={14} className="mr-1" /> Copy phrase</>}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground text-center">This phrase is shown once. You can find it in Settings later.</p>
              <Button onClick={() => signIn(usernameToEmail(username), patternToPassword(confirmedPattern))} className="w-full">
                I saved it — let me in
              </Button>
            </motion.div>
          )}

          {/* ── RECOVERY ── */}
          {screen === 'recovery' && (
            <motion.div key="recovery" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-4 w-full">
              <p className="text-sm text-center text-muted-foreground">Enter your recovery phrase<br /><span className="text-xs">(4 words separated by dashes)</span></p>
              <Input
                placeholder="word-word-word-word"
                value={recoveryInput}
                onChange={e => setRecoveryInput(e.target.value)}
                className="font-mono"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button onClick={handleRecovery} disabled={loading || !recoveryInput.trim()} className="w-full">
                {loading && <Loader2 size={14} className="mr-1 animate-spin" />}
                Unlock
              </Button>
              <button onClick={() => setScreen('unlock')} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2 text-center">
                ← Back
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
    </div>
  );
}
