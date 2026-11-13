import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '../test/render';
import { spyPendingExcept } from '../test/pending';
import type { RunDto } from '../api/client';
import RunsLog from './RunsLog';

describe('RunsLog — pending', () => {
  it('shows the skeleton, not a spinner, while the fetch is in flight', () => {
    spyPendingExcept();
    const { container } = renderPage(<RunsLog />);

    expect(container.querySelector('[data-probe="skeleton-runs"]')).not.toBeNull();
    expect(container.querySelector('[data-probe="spinner"]')).toBeNull();
  });
});

describe('RunsLog — ?run= opens a row', () => {
  it('expands the named run on load with the kind filter at all', async () => {
    const run: RunDto = {
      id: 113, engine: 'claude', kind: 'draft', model: 'opus', prompt: 'p', output: null, parsedOk: true,
      status: 'failed', failureKind: 'declined', error: 'placeholder', postId: 5,
      declined: { outcome: 'declined', reason: 'placeholder' }, tokensInput: null, tokensCacheWrite: null, tokensCacheRead: null, tokensOutput: null, imagesGenerated: null, costUsd: null,
      startedAt: '2026-09-04T10:00:00.000Z', finishedAt: '2026-09-04T10:00:30.000Z',
    };
    // The detail fetch is left hanging on purpose: its skeleton appears only for an OPEN row.
    spyPendingExcept({ '/runs': [run] });
    const { container } = renderPage(<RunsLog />, { route: '/runs?run=113', path: '/runs' });

    await screen.findByText('#113');
    expect(container.querySelector('[data-probe="skeleton-run-detail"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'all' })).toHaveClass('border-ink');
  });
});
