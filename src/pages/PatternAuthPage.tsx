import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import PatternLock from '@/components/PatternLock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff, Copy, Check, Loader2 } from 'lucide-react';

// ── Local pattern storage ────────────────────────────────────────────────────

function hashPattern(pattern: number[]): string {
  // Simple deterministic hash of the pattern
  return btoa(`showflow:${pattern.join('-')}:2026`);
}

const PATTERN_KEY = 'showflow-pattern';
const RECOVERY_KEY = 'showflow-recovery';
const NAME_KEY = 'showflow-username';

function savePattern(pattern: number[], name: string, recovery: string) {
  localStorage.setItem(PATTERN_KEY, hashPattern(pattern));
  localStorage.setItem(NAME_KEY, name);
  localStorage.setItem(RECOVERY_KEY, btoa(recovery));
}

function checkPattern(pattern: number[]): boolean {
  return localStorage.getItem(PATTERN_KEY) === hashPattern(pattern);
}

function getStoredName(): string | null {
  return localStorage.getItem(NAME_KEY);
}

function getStoredRecovery(): string | null {
  const raw = localStorage.getItem(RECOVERY_KEY);
  return raw ? atob(raw) : null;
}

function hasPattern(): boolean {
  return !!localStorage.getItem(PATTERN_KEY);
}

function clearPattern() {
  localStorage.removeItem(PATTERN_KEY);
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(RECOVERY_KEY);
}

function generateRecoveryPhrase(): string {
  const words = ['amber','blaze','cedar','delta','ember','frost','grove','haven',
    'ivory','jade','karma','lunar','maple','neon','onyx','prism','quartz','raven',
    'storm','tide','ultra','vault','wisp','xenon','yoke','zeal','arc','bolt',
    'crane','dusk','echo','flux','glow','haze','iris','jolt','knot','lava'];
  const picked: string[] = [];
  const used = new Set<number>();
  while (picked.length < 4) {
    const i = Math.floor(Math.random() * words.length);
    if (!used.has(i)) { used.add(i); picked.push(words[i]); }
  }
  return picked.join('-');
}

// ── Component ────────────────────────────────────────────────────────────────

type Screen = 'unlock' | 'setup-name' | 'setup-draw' | 'setup-confirm' | 'setup-phrase' | 'recovery';

export default function PatternAuthPage({ onUnlocked }: { onUnlocked: () => void }) {
  const isSetup = hasPattern();
  const [screen, setScreen] = useState<Screen>(isSetup ? 'unlock' : 'setup-name');
  const [username, setUsername] = useState('');
  const [firstPattern, setFirstPattern] = useState<number[]>([]);
  const [patternError, setPatternError] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [showPhrase, setShowPhrase] = useState(false);
  const [copied, setCopied] = useState(false);

  const unlock = async () => {
    setLoading(true);
    try {
      const signIn = supabase.auth.signInAnonymously().then(({ error }) => {
        if (error) throw error;
      });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 12000)
      );
      await Promise.race([signIn, timeout]);
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === 'timeout';
      setError(isTimeout
        ? 'Taking too long — wait 30s and try again (server waking up)'
        : `Sign-in failed: ${err instanceof Error ? err.message : 'unknown error'}. Enable Anonymous sign-ins in your Supabase dashboard → Authentication → Providers.`
      );
      setLoading(false);
      return;
    }
    setLoading(false);
    onUnlocked();
  };

  // ── Unlock ───────────────────────────────────────────────────────────────
  const handleUnlock = async (pattern: number[]) => {
    if (checkPattern(pattern)) {
      await unlock();
    } else {
      setPatternError(true);
      setError('Pattern not recognized');
      setTimeout(() => { setPatternError(false); setError(''); }, 1500);
    }
  };

  // ── Setup ────────────────────────────────────────────────────────────────
  const handleNameSubmit = () => {
    if (!username.trim()) { setError('Enter a name or handle'); return; }
    setError('');
    setScreen('setup-draw');
  };

  const handleFirstPattern = (pattern: number[]) => {
    setFirstPattern(pattern);
    setHasStarted(false);
    setScreen('setup-confirm');
  };

  const handleConfirmPattern = async (pattern: number[]) => {
    if (pattern.join('') !== firstPattern.join('')) {
      setPatternError(true);
      setError("Patterns don't match — try again");
      setTimeout(() => {
        setPatternError(false); setError('');
        setScreen('setup-draw'); setFirstPattern([]);
      }, 1500);
      return;
    }
    const phrase = generateRecoveryPhrase();
    savePattern(pattern, username, phrase);
    setRecoveryPhrase(phrase);
    setScreen('setup-phrase');
  };

  // ── Recovery ─────────────────────────────────────────────────────────────
  const handleRecovery = async () => {
    const stored = getStoredRecovery();
    if (!stored || recoveryInput.trim().toLowerCase() !== stored.toLowerCase()) {
      setError('Recovery phrase not recognized');
      return;
    }
    clearPattern();
    setScreen('setup-name');
    setError('');
    setRecoveryInput('');
  };

  const copyPhrase = () => {
    navigator.clipboard.writeText(recoveryPhrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-xs flex flex-col items-center gap-6 py-8"
      >
        <div className="text-center">
          <h1 className="text-3xl font-bold text-mono tracking-widest funky-gradient-text">AV LEDGER</h1>
          <p className="text-xs text-muted-foreground mt-1 tracking-wide uppercase">Bookkeeping for AV technicians</p>
        </div>

        <AnimatePresence mode="wait">

          {/* UNLOCK */}
          {screen === 'unlock' && (
            <motion.div key="unlock" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4 w-full">
              <p className="text-sm text-muted-foreground">Hey {getStoredName()} — draw your pattern</p>
              <PatternLock onComplete={handleUnlock} disabled={loading} error={patternError} size={220} />
              {loading && <Loader2 size={20} className="animate-spin text-primary" />}
              {error && <p className="text-xs text-destructive text-center">{error}</p>}
              <button onClick={() => setScreen('recovery')} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2">
                Forgot pattern? Use recovery phrase
              </button>
              <button onClick={() => { clearPattern(); setScreen('setup-name'); }} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2">
                New user? Set up a new account
              </button>
            </motion.div>
          )}

          {/* SETUP: NAME */}
          {screen === 'setup-name' && (
            <motion.div key="setup-name" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-4 w-full">
              <p className="text-sm text-center text-muted-foreground">What should we call you?</p>
              <Input placeholder="Name or handle (e.g. T-Dubs)" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleNameSubmit()} autoFocus />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button onClick={handleNameSubmit} className="w-full">Next →</Button>
              {isSetup && (
                <button onClick={() => setScreen('unlock')} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2 text-center">← Back</button>
              )}
            </motion.div>
          )}

          {/* SETUP: DRAW */}
          {screen === 'setup-draw' && (
            <motion.div key="setup-draw" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4 w-full">
              <p className="text-sm text-muted-foreground text-center">Draw your pattern<br /><span className="text-xs">(connect at least 4 dots)</span></p>
              <PatternLock onComplete={handleFirstPattern} onStart={() => setHasStarted(true)} size={220} />
              {hasStarted && (
                <button onClick={() => { setFirstPattern([]); setHasStarted(false); }} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2">
                  Whoops — start over
                </button>
              )}
            </motion.div>
          )}

          {/* SETUP: CONFIRM */}
          {screen === 'setup-confirm' && (
            <motion.div key="setup-confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-4 w-full">
              <p className="text-sm text-muted-foreground text-center">Draw it again to confirm</p>
              <PatternLock onComplete={handleConfirmPattern} error={patternError} size={220} onStart={() => setHasStarted(true)} />
              {error && <p className="text-xs text-destructive text-center">{error}</p>}
              {hasStarted && (
                <button onClick={() => { setFirstPattern([]); setHasStarted(false); setPatternError(false); setError(''); setScreen('setup-draw'); }} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2">
                  Whoops — redo my pattern
                </button>
              )}
            </motion.div>
          )}

          {/* SETUP: RECOVERY PHRASE */}
          {screen === 'setup-phrase' && (
            <motion.div key="setup-phrase" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-4 w-full">
              <div className="text-center">
                <p className="text-sm font-medium">Save your recovery phrase</p>
                <p className="text-xs text-muted-foreground mt-1">If you forget your pattern, this is the only way back in. Write it down.</p>
              </div>
              <div className="rounded-xl border border-border bg-secondary/30 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Recovery phrase</span>
                  <button onClick={() => setShowPhrase(!showPhrase)} className="text-muted-foreground hover:text-foreground">
                    {showPhrase ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {showPhrase
                  ? <p className="text-lg font-mono font-bold tracking-widest text-primary text-center">{recoveryPhrase}</p>
                  : <p className="text-lg font-mono text-center text-muted-foreground tracking-widest">••••-••••-••••-••••</p>
                }
                <Button variant="outline" size="sm" onClick={copyPhrase} className="w-full">
                  {copied ? <><Check size={14} className="mr-1" /> Copied!</> : <><Copy size={14} className="mr-1" /> Copy phrase</>}
                </Button>
              </div>
              <Button onClick={unlock} disabled={loading} className="w-full">
                {loading && <Loader2 size={14} className="mr-1 animate-spin" />}
                I saved it — let me in
              </Button>
            </motion.div>
          )}

          {/* RECOVERY */}
          {screen === 'recovery' && (
            <motion.div key="recovery" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-4 w-full">
              <p className="text-sm text-center text-muted-foreground">Enter your recovery phrase</p>
              <Input placeholder="word-word-word-word" value={recoveryInput} onChange={e => setRecoveryInput(e.target.value)} className="font-mono" />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button onClick={handleRecovery} disabled={!recoveryInput.trim()} className="w-full">Unlock</Button>
              <button onClick={() => { setScreen('unlock'); setError(''); }} className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2 text-center">← Back</button>
            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
    </div>
  );
}
