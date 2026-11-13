import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { api, type PostDto } from '../api/client';
import { fmtDateTime } from '../lib/format';
import { renderWithClient } from '../test/render';
import { DeletePost } from './delete-post';

const post = (over: Partial<PostDto> = {}): PostDto => ({
  id: 5, tier: 'T2', status: 'draft_ready', hook: 'the hook', bodyLinkedin: 'the body',
  bodyX: null, hashtags: [], topicTags: [],
  scheduledDate: null, scheduledTime: null,
  publishedAt: null, linkedinUrl: null, imagePrompt: null,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  referenceAssetId: null, ideaText: null, selectedAsset: null,
  sources: [],
  ...over,
});

// D3's copy, typed out here rather than imported, so a sentence that loses half of itself in the
// component cannot pass by comparing against itself.
const UNPUBLISHED = 'Deleting removes this post, its revisions, inputs and images. Its runs stay in the log, '
  + 'and the idea it came from goes back to the backlog.';
const published = (date: string) => `This post was published on ${date}. Deleting removes its record here, `
  + 'not on LinkedIn: a later export of it will land unlinked, and the goal and streak for that week are '
  + 'recounted without it. Its runs stay in the log, and the idea goes back to the backlog.';

function tree(p: PostDto, busy = false) {
  return (
    <MemoryRouter initialEntries={['/posts/5']}>
      <Routes>
        <Route path="/posts/:id" element={<DeletePost post={p} busy={busy} />} />
        <Route path="/posts" element={<div>posts index</div>} />
      </Routes>
    </MemoryRouter>
  );
}
function mount(p: PostDto, busy = false) { return renderWithClient(tree(p, busy)); }

const sentence = (lead: RegExp) => (screen.getByText(lead).textContent ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => { vi.restoreAllMocks(); });

describe('DeletePost', () => {
  it('says the whole published sentence after the first click', async () => {
    const at = '2026-09-01T12:00:00.000Z';
    mount(post({ status: 'published', publishedAt: at }));
    await userEvent.click(screen.getByRole('button', { name: 'delete post' }));
    expect(sentence(/^This post was published on/)).toBe(published(fmtDateTime(at)));
  });

  it('says the whole unpublished sentence after the first click', async () => {
    mount(post());
    await userEvent.click(screen.getByRole('button', { name: 'delete post' }));
    expect(sentence(/^Deleting removes this post/)).toBe(UNPUBLISHED);
  });

  it('is disabled while a run is in flight, and says why', () => {
    mount(post(), true);
    const trigger = screen.getByRole('button', { name: 'delete post' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('title', 'a run is in flight');
  });

  it('keep sends nothing and puts the button back', async () => {
    const del = vi.spyOn(api, 'del').mockResolvedValue(undefined);
    mount(post());
    await userEvent.click(screen.getByRole('button', { name: 'delete post' }));
    await userEvent.click(screen.getByRole('button', { name: 'keep' }));
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'delete post' })).toBeInTheDocument();
  });

  it('delete for good sends one DELETE and lands on the posts index', async () => {
    const del = vi.spyOn(api, 'del').mockResolvedValue(undefined);
    mount(post());
    await userEvent.click(screen.getByRole('button', { name: 'delete post' }));
    await userEvent.click(screen.getByRole('button', { name: 'delete for good' }));
    expect(await screen.findByText('posts index')).toBeInTheDocument();
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('/posts/5');
  });

  it('evicts the cached post, so Back cannot repaint it as editable', async () => {
    vi.spyOn(api, 'del').mockResolvedValue(undefined);
    const { client } = mount(post());
    client.setQueryData(['post', 5], { post: post(), revisions: [], latestDraft: null });
    await userEvent.click(screen.getByRole('button', { name: 'delete post' }));
    await userEvent.click(screen.getByRole('button', { name: 'delete for good' }));
    await screen.findByText('posts index');
    expect(client.getQueryData(['post', 5])).toBeUndefined();
  });

  it("evicts the deleted post's run list, so the runs invalidation cannot refetch it under the leaving Workspace", async () => {
    vi.spyOn(api, 'del').mockResolvedValue(undefined);
    const { client } = mount(post());
    client.setQueryData(['runs', 'post', 5], []);
    await userEvent.click(screen.getByRole('button', { name: 'delete post' }));
    await userEvent.click(screen.getByRole('button', { name: 'delete for good' }));
    await screen.findByText('posts index');
    expect(client.getQueryData(['runs', 'post', 5])).toBeUndefined();
  });

  it('drops the post from every cached list before the refetch lands', async () => {
    vi.spyOn(api, 'del').mockResolvedValue(undefined);
    const { client } = mount(post());
    client.setQueryData(['posts', 'all'], [post(), post({ id: 6 })]);
    client.setQueryData(['posts', 'draft_ready'], [post()]);
    await userEvent.click(screen.getByRole('button', { name: 'delete post' }));
    await userEvent.click(screen.getByRole('button', { name: 'delete for good' }));
    await screen.findByText('posts index');
    expect(client.getQueryData<PostDto[]>(['posts', 'all'])?.map((p) => p.id)).toEqual([6]);
    expect(client.getQueryData<PostDto[]>(['posts', 'draft_ready'])).toEqual([]);
  });

  it('delete for good goes quiet when a run launches after the block opened, and keep does not', async () => {
    const { client, rerender } = mount(post());
    await userEvent.click(screen.getByRole('button', { name: 'delete post' }));
    rerender(<QueryClientProvider client={client}>{tree(post(), true)}</QueryClientProvider>);
    const destroy = screen.getByRole('button', { name: 'delete for good' });
    expect(destroy).toBeDisabled();
    expect(destroy).toHaveAttribute('title', 'a run is in flight');
    expect(screen.getByRole('button', { name: 'keep' })).toBeEnabled();
  });

  it("shows the server's refusal and keeps the block open", async () => {
    vi.spyOn(api, 'del').mockRejectedValue(new Error('post 5 has run 9 in flight'));
    mount(post());
    await userEvent.click(screen.getByRole('button', { name: 'delete post' }));
    await userEvent.click(screen.getByRole('button', { name: 'delete for good' }));
    expect(await screen.findByText(/post 5 has run 9 in flight/)).toBeInTheDocument();
    expect(screen.getByText('delete failed')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'delete for good' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'keep' })).toBeInTheDocument();
  });
});
