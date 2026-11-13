import { describe, expect, it } from 'vitest';
import { apiEngines } from './index';

describe('apiEngines', () => {
  it('installs one engine per provider key present', () => {
    expect(Object.keys(apiEngines({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' })).sort()).toEqual(['anthropic', 'openai']);
    expect(Object.keys(apiEngines({ ANTHROPIC_API_KEY: 'a' }))).toEqual(['anthropic']);
  });

  it('installs nothing without keys, so a keyless process still boots', () => {
    expect(apiEngines({})).toEqual({});
  });
});
