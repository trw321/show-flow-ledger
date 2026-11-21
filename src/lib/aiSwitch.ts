/**
 * AI-free mode, enforced where it matters: at the request. Settings promises
 * "AI readers off", but only the shift reader checked the switch, so pay
 * stubs, statements, receipts, timesheets and photos were still sent to be
 * read with it on. Every AI read goes through aiFetch, which sends nothing
 * while the switch is on and fails with a message saying why.
 */

export const AI_OFF_MESSAGE = 'AI is off (Settings → AI-free mode), so nothing was sent to be read. Enter it by hand.';

let off = false;

/** Kept in step with the saved setting by the prefs provider. */
export function setAIOff(value: boolean): void {
  off = value;
}

export function aiIsOff(): boolean {
  return off;
}

/** fetch for an AI reader: refuses, sending nothing, while AI is off. */
export function aiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (off) return Promise.reject(new Error(AI_OFF_MESSAGE));
  return fetch(input, init);
}
