import { describe, expect, it } from 'vitest';
import {
  clearDeepSeekApiKey,
  deepseekCredentialStatus,
  generatePromptFilenameSuggestions,
  setDeepSeekApiKey,
} from '../src/lib/api';

describe('DeepSeek browser-development seam', () => {
  it('does not expose or persist a credential outside Tauri', async () => {
    const status = await deepseekCredentialStatus();
    const saved = await setDeepSeekApiKey('sk-browser-test-secret');
    const cleared = await clearDeepSeekApiKey();

    expect(status).toEqual({ configured: false, supported: false });
    expect(saved).toEqual({
      status: { configured: false, supported: false },
      failure: 'unsupported',
    });
    expect(cleared).toEqual({
      status: { configured: false, supported: false },
      failure: 'unsupported',
    });
    expect(JSON.stringify(saved)).not.toContain('sk-browser-test-secret');
    if (typeof localStorage !== 'undefined') expect(localStorage.length).toBe(0);
  });

  it('returns unsupported without calling a model in browser development', async () => {
    await expect(generatePromptFilenameSuggestions('Review this pull request.')).resolves.toEqual({
      names: [],
      failure: 'unsupported',
    });
  });
});
