import { describe, it, expect } from 'vitest';
import { renderPage } from '../test/render';
import { spyPendingExcept } from '../test/pending';
import PostAnalytics from './PostAnalytics';

describe('PostAnalytics — pending', () => {
  it('shows the detail skeleton, not a spinner, while the fetch is in flight', () => {
    spyPendingExcept();
    const { container } = renderPage(<PostAnalytics />, {
      route: '/analytics/1', path: '/analytics/:postId',
    });

    expect(container.querySelector('[data-probe="skeleton-post-analytics"]')).not.toBeNull();
    expect(container.querySelector('[data-probe="spinner"]')).toBeNull();
  });
});
