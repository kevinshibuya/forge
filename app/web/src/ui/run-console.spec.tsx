import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '../test/render';
import type { RunDto } from '../api/client';
import { FailureCard } from './run-console';
import { failureMessage } from './run-failure';

const failed = (over: Partial<RunDto> = {}): RunDto => ({
  id: 113, engine: 'claude', kind: 'draft', model: 'opus', prompt: 'p', output: null,
  parsedOk: null, status: 'failed', failureKind: 'other', error: 'Error: something broke', postId: 5,
  declined: null, tokensInput: null, tokensCacheWrite: null, tokensCacheRead: null, tokensOutput: null, imagesGenerated: null, costUsd: null,
  startedAt: '2026-09-04T10:00:00.000Z', finishedAt: '2026-09-04T10:00:30.000Z',
  ...over,
});
const decline = { outcome: 'declined' as const, reason: 'the idea is a placeholder', question: 'is post 5 a smoke test?' };

describe('failureMessage', () => {
  it('reads a decline in the ink tone with the reason then the question, and everything else in salmon', () => {
    expect(failureMessage(failed({ failureKind: 'declined', error: decline.reason, declined: decline }))).toEqual({
      label: 'declined', tone: 'ink', lines: [decline.reason, decline.question],
    });
    expect(failureMessage(failed({ failureKind: 'declined', error: 'r', declined: { outcome: 'declined', reason: 'r' } }))).toEqual({
      label: 'declined', tone: 'ink', lines: ['r'],
    });
    const broken = failureMessage(failed({ failureKind: 'invalid_output', error: 'zod: x', output: 'one\n\ntwo\nthree\nfour' }));
    expect(broken).toEqual({ label: 'invalid output', tone: 'salmon', lines: ['the engine broke its contract', 'one', 'two', 'three'] });
    const other = failureMessage(failed({ failureKind: 'nonzero_exit', error: 'Error: exit 1', output: 'tail' }));
    expect(other).toEqual({ label: 'nonzero exit', tone: 'salmon', lines: ['exit 1', 'tail'] });
    expect(failureMessage(failed({ failureKind: null, error: null, output: null })).label).toBe('failed');
  });
});

describe('FailureCard', () => {
  it('shows a decline with its question set apart and opens the run on the runs log', () => {
    renderPage(<FailureCard run={failed({ failureKind: 'declined', error: decline.reason, declined: decline })} onDismiss={() => {}} />);
    expect(screen.getByText('declined')).toBeInTheDocument();
    expect(screen.getByText(decline.reason)).toBeInTheDocument();
    expect(screen.getByText(decline.question)).toHaveClass('text-ink');
    expect(screen.getByRole('link', { name: /open run/ })).toHaveAttribute('href', '/runs?run=113');
    expect(screen.getByRole('link', { name: /open post #5/ })).toHaveAttribute('href', '/posts/5');
    expect(screen.queryByText(/Error:/)).toBeNull();
  });

  it('names a broken contract and quotes the head of the raw output', () => {
    renderPage(<FailureCard run={failed({ failureKind: 'invalid_output', error: 'zod: x', output: 'line one\nline two' })} onDismiss={() => {}} />);
    expect(screen.getByText('invalid output')).toBeInTheDocument();
    expect(screen.getByText('the engine broke its contract')).toBeInTheDocument();
    expect(screen.getByText('line one')).toBeInTheDocument();
    expect(screen.getByText('line two')).toBeInTheDocument();
  });
});
