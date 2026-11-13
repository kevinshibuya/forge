import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '../test/render';
import type { RunDto } from '../api/client';
import { FailureStrip } from './failure-strip';
import { newestRunOfKinds } from './run-failure';

const run = (over: Partial<RunDto> & { id: number }): RunDto => ({
  engine: 'claude', kind: 'draft', model: 'opus', prompt: 'p', output: null, parsedOk: null,
  status: 'failed', failureKind: 'other', error: 'boom', postId: 5, declined: null,
  tokensInput: null, tokensCacheWrite: null, tokensCacheRead: null, tokensOutput: null, imagesGenerated: null, costUsd: null,
  startedAt: '2026-09-04T10:00:00.000Z', finishedAt: null,
  ...over,
});

describe('newestRunOfKinds', () => {
  it('picks by startedAt before id, so a lower id that started later wins', () => {
    const older = run({ id: 9, startedAt: '2026-09-04T10:00:00.000Z' });
    const newer = run({ id: 8, startedAt: '2026-09-04T11:00:00.000Z' });
    expect(newestRunOfKinds([older, newer], ['draft', 'refine_selection'])?.id).toBe(8);
  });
  it('breaks a startedAt tie on the higher id', () => {
    expect(newestRunOfKinds([run({ id: 3 }), run({ id: 4 })], ['draft'])?.id).toBe(4);
  });
  it('ignores other kinds and returns null on empty', () => {
    const review = run({ id: 20, kind: 'image_review', startedAt: '2026-09-05T00:00:00.000Z' });
    expect(newestRunOfKinds([review, run({ id: 2 })], ['draft', 'refine_selection'])?.id).toBe(2);
    expect(newestRunOfKinds([review], ['draft'])).toBeNull();
    expect(newestRunOfKinds([], ['draft'])).toBeNull();
  });
});

describe('FailureStrip', () => {
  it('renders a decline with its reason and question, and the relaunch control', () => {
    const declined = { outcome: 'declined' as const, reason: 'the idea is a placeholder', question: 'is post 5 a smoke test?' };
    renderPage(<FailureStrip run={run({ id: 113, failureKind: 'declined', error: declined.reason, declined })} onRelaunch={() => {}} />);
    expect(screen.getByText('declined')).toBeInTheDocument();
    expect(screen.getByText(declined.reason)).toBeInTheDocument();
    expect(screen.getByText(declined.question)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'relaunch' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open run/ })).toHaveAttribute('href', '/runs?run=113');
  });
});
