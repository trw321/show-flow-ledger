import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_OFF_MESSAGE, aiFetch, setAIOff } from './aiSwitch';

describe('AI-free mode at the request', () => {
  afterEach(() => { setAIOff(false); vi.unstubAllGlobals(); });

  it('sends nothing while AI is off, and says why', async () => {
    const sent = vi.fn();
    vi.stubGlobal('fetch', sent);
    setAIOff(true);
    await expect(aiFetch('https://example.test/functions/v1/parse-statement', { method: 'POST' })).rejects.toThrow(AI_OFF_MESSAGE);
    expect(sent).not.toHaveBeenCalled();
  });

  it('sends as normal while AI is on', async () => {
    const sent = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', sent);
    setAIOff(false);
    await aiFetch('https://example.test/functions/v1/parse-statement');
    expect(sent).toHaveBeenCalledTimes(1);
  });
});
