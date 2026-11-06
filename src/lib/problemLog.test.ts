import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('posthog-js', () => ({ default: {} }));
const { describeTap } = await import('./problemLog');

const inPage = (html: string) => {
  const box = document.createElement('div');
  box.innerHTML = html;
  return box.firstElementChild!;
};

describe('naming what was tapped', () => {
  it('says which button', () => {
    const b = inPage('<button><svg></svg><span> Mark   paid </span></button>');
    expect(describeTap(b.querySelector('span')!)).toBe('button: Mark paid');
  });

  it('prefers the label a screen reader gets', () => {
    expect(describeTap(inPage('<button aria-label="Close add pay"><svg></svg></button>'))).toBe('button: Close add pay');
  });

  it('names a field, and never says what is in it', () => {
    const field = inPage('<input placeholder="Rate" value="60.69" />');
    expect(describeTap(field)).toBe('input: Rate');
    expect(describeTap(field)).not.toContain('60.69');
  });
});
