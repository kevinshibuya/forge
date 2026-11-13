import { describe, it, expect, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError, type IdeaDto } from '../api/client';
import { renderPage } from '../test/render';
import { spyPendingExcept } from '../test/pending';
import Backlog from './Backlog';

const EMPTY_COPY = 'backlog is empty — add the first idea above';
const ERROR_LABEL = 'backlog failed to load';

const idea = (over: Partial<IdeaDto> & { id: number }): IdeaDto => ({
  rawText: 'an idea worth writing down', source: 'braindump', status: 'new',
  suggestedTier: null, newsExpiry: null, notes: null, promotedPostId: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

describe('Backlog — error vs empty', () => {
  it('shows the error and NOT the empty state when the fetch fails', async () => {
    // The contract, not the guard: a failed load must never read as "you have no ideas".
    // `!ideas.isError` is NOT what makes this pass — on a first-load rejection `data` is
    // undefined, so `data?.length === 0` is already false. This case would catch a future
    // `data ?? []`; the stale-`[]`-plus-failed-refetch shape the guard actually covers is a
    // known gap (ADR 0013).
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'ideas table is gone'));
    renderPage(<Backlog />);

    const label = await screen.findByText(ERROR_LABEL);
    expect(label.parentElement?.textContent).toBe(`${ERROR_LABEL} · ideas table is gone`);
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it('shows the empty state and no error when the backlog is genuinely empty', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([]);
    renderPage(<Backlog />);

    expect(await screen.findByText(EMPTY_COPY)).toBeInTheDocument();
    expect(screen.queryByText(ERROR_LABEL)).toBeNull();
  });

  it('shows neither once there are ideas', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([idea({ id: 1, rawText: 'the one idea' })]);
    renderPage(<Backlog />);

    // A settle point, not a rendering assertion: both queries below are null while the page is
    // still loading, so asserting absence before the data lands would pass for the wrong reason.
    await screen.findByText('the one idea');
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryByText(ERROR_LABEL)).toBeNull();
  });

  it('does not add an empty state to the error when a refetch fails after an empty load', async () => {
    // The shape the `!isError` guard actually exists for. A first-load rejection leaves `data`
    // undefined, so the empty branch is already unreachable — but here the successful `[]` stays
    // cached while `isError` flips true, and without the guard the page would claim both at once.
    const get = vi.spyOn(api, 'get').mockResolvedValue([]);
    const { client } = renderPage(<Backlog />);
    await screen.findByText(EMPTY_COPY);

    get.mockRejectedValue(new ApiError(503, 'upstream went away'));
    await act(() => client.refetchQueries());

    expect(await screen.findByText(ERROR_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });
});

describe('Backlog — pending', () => {
  it('shows the skeleton, not a spinner, while the fetch is in flight', () => {
    spyPendingExcept();
    const { container } = renderPage(<Backlog />);

    expect(container.querySelector('[data-probe="skeleton-backlog"]')).not.toBeNull();
    expect(container.querySelector('[data-probe="spinner"]')).toBeNull();
  });
});

describe('Backlog — tell marks', () => {
  it('marks a tell in the triage notes', async () => {
    spyPendingExcept({ '/ideas?status=new,triaged': [idea({ id: 1, notes: 'delve into the ladder' })] });
    renderPage(<Backlog />);

    await waitFor(() => expect(document.querySelector('mark[data-tip]')).not.toBeNull());
    const mark = document.querySelector('mark[data-tip]')!;
    expect(mark.getAttribute('data-tip')).toBe('AI vocabulary');
    expect(mark.textContent).toBe('delve');
  });

  it('leaves clean notes unmarked', async () => {
    spyPendingExcept({ '/ideas?status=new,triaged': [idea({ id: 1, notes: 'a clean note about api surfaces' })] });
    const { container } = renderPage(<Backlog />);

    await waitFor(() => expect(screen.getByText('a clean note about api surfaces')).toBeInTheDocument());
    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });
});

describe('Backlog — a declined triage', () => {
  it('renders the decline reason and question on the idea row', async () => {
    spyPendingExcept({ '/ideas?status=new,triaged': [idea({ id: 1 })] });
    const declined = { outcome: 'declined', reason: 'the idea has no subject', question: 'what is it about?' };
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, runId: 7, failureKind: 'declined', error: declined.reason, declined });
    renderPage(<Backlog />);

    await userEvent.click(await screen.findByRole('button', { name: 'triage' }));
    expect(await screen.findByText(declined.question)).toBeInTheDocument();
    expect(screen.getByText(declined.reason)).toBeInTheDocument();
    expect(screen.getByText('declined')).toBeInTheDocument();
  });
});
