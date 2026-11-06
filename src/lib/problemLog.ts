import posthog from 'posthog-js';
import { supabase } from '@/integrations/supabase/client';

/**
 * What was happening when something went wrong, for the problems that happen
 * once a month and can't be made to happen again on purpose.
 *
 * The last taps, pages and errors are kept in memory as you use the app — on
 * this device, going nowhere. They only leave it when Report a problem is
 * tapped, or the app crashes, and then only to your own account. Tapped things
 * are named, never what was typed into them.
 */

export interface Step {
  at: string;
  kind: 'tap' | 'page' | 'error';
  what: string;
}

const MAX_STEPS = 60;
/** Enough of the screen to read what was on it. */
const MAX_SCREEN = 3000;
const CRASH_GAP_MS = 60_000;

const steps: Step[] = [];
let lastCrashAt = 0;

export function logStep(kind: Step['kind'], what: string): void {
  steps.push({ at: new Date().toISOString().slice(11, 19), kind, what: what.slice(0, 120) });
  if (steps.length > MAX_STEPS) steps.shift();
}

/** What a tapped thing is called. For a field, its name and never its contents. */
export function describeTap(target: Element): string {
  const el = target.closest('button, a, [role="button"], [role="tab"], summary, label, input, select, textarea') ?? target;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    return `${tag}: ${el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.getAttribute('name') ?? 'field'}`;
  }
  const name = el.getAttribute('aria-label') ?? (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return `${tag}: ${name.slice(0, 60) || '(no label)'}`;
}

/** The words on screen right now. A form field's contents are not part of this. */
export function readScreen(): string {
  return (document.body.innerText ?? '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, MAX_SCREEN);
}

function device() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
    online: navigator.onLine,
    homeScreenApp: window.matchMedia?.('(display-mode: standalone)').matches ?? false,
    browser: navigator.userAgent,
  };
}

export type ReportResult = 'sent' | 'signed-out' | 'failed';

/** Sends what was happening to your own account. Never throws. */
export async function sendProblemReport(input: { kind: 'report' | 'crash'; note?: string; screen?: string }): Promise<ReportResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return 'signed-out';
    const { error } = await supabase.from('problem_reports').insert({
      user_id: session.user.id,
      kind: input.kind,
      note: input.note?.trim() || null,
      page: window.location.pathname + window.location.search,
      on_screen: input.screen ?? readScreen(),
      trail: steps.map(s => ({ ...s })),
      device: device(),
      build: document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null,
      replay_url: posthog.sessionRecordingStarted?.() ? posthog.get_session_replay_url?.() ?? null : null,
    } as never);
    return error ? 'failed' : 'sent';
  } catch {
    return 'failed';
  }
}

/** A crash reports itself, once a minute at most: one failure can throw over and over. */
export function reportCrash(message: string): void {
  logStep('error', message);
  const now = Date.now();
  if (now - lastCrashAt < CRASH_GAP_MS) return;
  lastCrashAt = now;
  void sendProblemReport({ kind: 'crash', note: message.slice(0, 500) });
}

/** Starts keeping the trail. Called once, when the app starts. */
export function startProblemLog(): void {
  document.addEventListener('pointerdown', e => {
    if (e.target instanceof Element) logStep('tap', describeTap(e.target));
  }, { capture: true, passive: true });
  window.addEventListener('error', e => reportCrash(e.message || 'Unknown error'));
  window.addEventListener('unhandledrejection', e => reportCrash(String(e.reason?.message ?? e.reason ?? 'Unhandled rejection')));
}
