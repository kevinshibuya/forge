import { describe, it, expect, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { api, ApiError, type PostDto } from '../api/client';
import { renderPage } from '../test/render';
import { spyPendingExcept } from '../test/pending';
import PostsIndex from './PostsIndex';

const EMPTY_COPY = 'no posts yet — promote an idea from the backlog to start one';
const ERROR_LABEL = 'posts failed to load';

const post = (over: Partial<PostDto> & { id: number }): PostDto => ({
  tier: 'T2', status: 'queued', hook: 'a hook', bodyLinkedin: null,
  bodyX: null, hashtags: [], topicTags: [],
  scheduledDate: null, scheduledTime: null,
  publishedAt: null, linkedinUrl: null, imagePrompt: null,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  referenceAssetId: null, ideaText: null, selectedAsset: null,
  sources: [],
  ...over,
});

describe('PostsIndex — error vs empty', () => {
  it('shows the error and NOT the empty state when the fetch fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'posts table is gone'));
    renderPage(<PostsIndex />);

    const label = await screen.findByText(ERROR_LABEL);
    expect(label.parentElement?.textContent).toBe(`${ERROR_LABEL} · posts table is gone`);
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it('shows the empty state and no error when there are genuinely no posts', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([]);
    renderPage(<PostsIndex />);

    expect(await screen.findByText(EMPTY_COPY)).toBeInTheDocument();
    expect(screen.queryByText(ERROR_LABEL)).toBeNull();
  });

  it('shows neither once there are posts', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([post({ id: 1, hook: 'the one hook' })]);
    renderPage(<PostsIndex />);

    // A settle point, not a rendering assertion: both queries below are null while the page is
    // still loading, so asserting absence before the data lands would pass for the wrong reason.
    await screen.findByText('the one hook');
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryByText(ERROR_LABEL)).toBeNull();
  });

  it('does not add an empty state to the error when a refetch fails after an empty load', async () => {
    // The shape the `!isError` guard actually exists for. A first-load rejection leaves `data`
    // undefined, so the empty branch is already unreachable — but here the successful `[]` stays
    // cached while `isError` flips true, and without the guard the page would claim both at once.
    const get = vi.spyOn(api, 'get').mockResolvedValue([]);
    const { client } = renderPage(<PostsIndex />);
    await screen.findByText(EMPTY_COPY);

    get.mockRejectedValue(new ApiError(503, 'upstream went away'));
    await act(() => client.refetchQueries());

    expect(await screen.findByText(ERROR_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });
});

describe('PostsIndex — pending', () => {
  it('shows the skeleton, not a spinner, while the fetch is in flight', () => {
    spyPendingExcept();
    const { container } = renderPage(<PostsIndex />);

    expect(container.querySelector('[data-probe="skeleton-posts"]')).not.toBeNull();
    expect(container.querySelector('[data-probe="spinner"]')).toBeNull();
  });
});

describe('PostsIndex — title and miniature', () => {
  it('titles the row by the idea and shows the hook beneath it', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([post({ id: 1, ideaText: 'the idea text', hook: 'the hook line' })]);
    renderPage(<PostsIndex />);
    expect(await screen.findByText('the idea text')).toBeInTheDocument();
    expect(screen.getByText('the hook line')).toHaveClass('text-soft');
  });

  it('falls back to the hook as the title, with no second line, when there is no idea', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([post({ id: 1, ideaText: null, hook: 'only the hook' })]);
    renderPage(<PostsIndex />);
    const title = await screen.findByText('only the hook');
    expect(title).toHaveClass('text-ink');
    expect(screen.getAllByText('only the hook')).toHaveLength(1);
  });

  it('shows the tier code in the placeholder frame when no asset is selected', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([post({ id: 1, tier: 'T3', selectedAsset: null })]);
    renderPage(<PostsIndex />);
    const row = (await screen.findByText('a hook')).closest('a')!;
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('[data-probe="thumb-placeholder"]')?.textContent).toBe('T3');
  });

  it('shows the selected asset as a miniature', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([post({ id: 1, selectedAsset: { id: 42, width: 1200, height: 1200 } })]);
    renderPage(<PostsIndex />);
    const row = (await screen.findByText('a hook')).closest('a')!;
    const img = row.querySelector('img')!;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('/api/images/42/file');
    expect(img).toHaveClass('h-11', 'w-11');
    expect(row.querySelector('[data-probe="thumb-placeholder"]')).toBeNull();
  });
});
