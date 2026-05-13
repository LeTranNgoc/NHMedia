import { describe, it, expect } from 'vitest';
import { SHARED_PACKAGE_VERSION } from './index.js';

describe('shared package', () => {
  it('exports version', () => {
    expect(SHARED_PACKAGE_VERSION).toBe('0.1.0');
  });
});
