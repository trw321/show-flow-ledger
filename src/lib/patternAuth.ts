// Pattern auth helpers
// The pattern (e.g. [0,3,6,7,8]) is hashed into a password used with Supabase
// The user never sees or types an email/password

const RECOVERY_WORDS = [
  'amber','blaze','cedar','delta','ember','frost','grove','haven',
  'ivory','jade','karma','lunar','maple','neon','onyx','prism',
  'quartz','raven','storm','tide','ultra','vault','wisp','xenon',
  'yoke','zeal','arc','bolt','crane','dusk','echo','flux',
  'glow','haze','iris','jolt','knot','lava','mist','nova',
  'orbit','peak','quest','reef','sage','torch','umber','vibe',
  'wave','xray','yield','zero'
];

// Convert pattern to a deterministic password string
export function patternToPassword(pattern: number[]): string {
  // e.g. [0,3,6,7,8] -> "p0-3-6-7-8-showflow"
  return `p${pattern.join('-')}-showflow2026`;
}

// Generate a fake but consistent email from a username/identifier
export function usernameToEmail(username: string): string {
  // Sanitize and create a fake email for Supabase
  const safe = username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
  return `${safe}@showflow.app`;
}

// Generate a 4-word recovery phrase
export function generateRecoveryPhrase(): string {
  const words: string[] = [];
  const used = new Set<number>();
  while (words.length < 4) {
    const idx = Math.floor(Math.random() * RECOVERY_WORDS.length);
    if (!used.has(idx)) {
      used.add(idx);
      words.push(RECOVERY_WORDS[idx]);
    }
  }
  return words.join('-');
}

// Convert recovery phrase to a password (for fallback login)
export function recoveryPhraseToPassword(phrase: string): string {
  return `r-${phrase.toLowerCase().trim()}-showflow2026`;
}

// Store pattern setup locally (just the username, not the pattern itself)
const SETUP_KEY = 'showflow-pattern-setup';

export interface PatternSetup {
  username: string;
  email: string;
  recoveryPhrase: string; // stored so user can view it again if needed
}

export function savePatternSetup(setup: PatternSetup) {
  localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
}

export function loadPatternSetup(): PatternSetup | null {
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPatternSetup() {
  localStorage.removeItem(SETUP_KEY);
}
