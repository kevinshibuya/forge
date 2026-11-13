import { describe, it, expect } from 'vitest';
import { renderPage } from '../test/render';
import { spyPendingExcept } from '../test/pending';
import Analytics from './Analytics';

describe('Analytics — pending', () => {
  it('shows the board skeleton under real chrome, and no spinner', () => {
    spyPendingExcept();
    const { container } = renderPage(<Analytics />);

    expect(container.querySelector('[data-probe="skeleton-analytics-board"]')).not.toBeNull();
    expect(container.querySelector('[data-probe="spinner"]')).toBeNull();
    // Chrome is not data: the range pills are on screen before the board resolves.
    for (const range of ['7', '28', '90', 'all']) {
      expect(container.querySelector(`[data-probe="range-${range}"]`)).not.toBeNull();
    }
  });
});
