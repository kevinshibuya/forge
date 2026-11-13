import { describe, expect, it } from 'vitest';
import { FORGE } from './index';

describe('workspace smoke', () => {
  it('resolves the shared package', () => {
    expect(FORGE).toBe('forge');
  });
});
