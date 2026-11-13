import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError, type PostDto } from '../../api/client';
import { renderWithClient } from '../../test/render';
import { AttachPicker } from './attach-picker';

const post = (over: Partial<PostDto> & { id: number }): PostDto => ({
  tier: 'T2', status: 'published', hook: null, bodyLinkedin: null,
  bodyX: null, hashtags: [], topicTags: [],
  scheduledDate: null, scheduledTime: null,
  publishedAt: null, linkedinUrl: null, imagePrompt: null,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  referenceAssetId: null, ideaText: null, selectedAsset: null,
  sources: [],
  ...over,
});

const POSTS = [
  post({ id: 1, hook: 'the first hook' }),
  post({ id: 2, hook: 'the second hook' }),
  post({ id: 3, hook: 'the third hook' }),
];

function open(linked: readonly number[], posts: PostDto[] = POSTS) {
  vi.spyOn(api, 'get').mockResolvedValue(posts);
  renderWithClient(
    <AttachPicker postUrn="urn:li:share:123" linkedPostIds={new Set(linked)} onClose={vi.fn()} />,
  );
}

describe('AttachPicker candidates', () => {
  it('offers only the posts the board does not already show as attached', async () => {
    open([2]);
    expect(await screen.findByText('the first hook')).toBeInTheDocument();
    expect(screen.getByText('the third hook')).toBeInTheDocument();
    expect(screen.queryByText('the second hook')).toBeNull();
  });

  it('says so plainly when every post is already attached', async () => {
    open([1, 2, 3]);
    expect(await screen.findByText('every post is already attached to an import')).toBeInTheDocument();
  });
});

describe('AttachPicker load failure', () => {
  it('shows an error instead of claiming every post is already attached', async () => {
    // The lying empty state, this component's version: a failed `usePosts()` leaves isLoading
    // false and data undefined, so `candidates` is [] and the zero-candidates copy renders — a
    // false statement about the user's posts, with no note anywhere saying the load failed.
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'posts table is gone'));
    renderWithClient(
      <AttachPicker postUrn="urn:li:share:123" linkedPostIds={new Set()} onClose={vi.fn()} />,
    );

    const label = await screen.findByText('posts failed to load');
    expect(label.parentElement?.textContent).toBe('posts failed to load · posts table is gone');
    expect(screen.queryByText('every post is already attached to an import')).toBeNull();
  });
});

describe('AttachPicker link failure', () => {
  it("shows the server's 409 wording rather than a generic failure", async () => {
    // The server rejects a post that another urn already owns. The picker cannot know that
    // ahead of time — deriving candidates from the board is deliberately not eligibility — so
    // this note is the only place the reason ever reaches the user.
    const user = userEvent.setup();
    const message = 'post 1 is already linked to urn:li:share:999';
    open([]);
    const post1 = await screen.findByText('the first hook');
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, message));

    await user.click(post1);

    const label = await screen.findByText('could not attach');
    expect(label.parentElement?.textContent).toBe(`could not attach · ${message}`);
  });
});
