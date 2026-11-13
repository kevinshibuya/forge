import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError, type PostDto } from '../api/client';
import { renderWithClient } from '../test/render';
import { HashtagEditor } from './hashtag-editor';

// A real fixture rather than a cast: `usePatchPost.onSuccess` discards this today, but the
// moment it does an optimistic `setQueryData` a partial object becomes a lie.
const patched: PostDto = {
  id: 4, tier: 'T2', status: 'draft_ready', hook: null, bodyLinkedin: null,
  bodyX: null, hashtags: [], topicTags: [],
  scheduledDate: null, scheduledTime: null,
  publishedAt: null, linkedinUrl: null, imagePrompt: null,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  referenceAssetId: null, ideaText: null, selectedAsset: null,
  sources: [],
};

describe('HashtagEditor', () => {
  it('PATCHes the normalized array, not the raw text typed', async () => {
    // The endpoint replaces the column wholesale, so what goes over the wire is the complete
    // next state — and it goes normalized. Route-smoke cannot reach this without writing to a
    // real post.
    const user = userEvent.setup();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(patched);
    renderWithClient(<HashtagEditor postId={4} hashtags={['#build']} />);

    await user.type(screen.getByPlaceholderText('+ hashtag'), 'In Public{Enter}');

    expect(patch).toHaveBeenCalledWith('/posts/4', { hashtags: ['#build', '#InPublic'] });
  });

  it('spends no write on an edit that normalizes to what is already stored', async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(patched);
    renderWithClient(<HashtagEditor postId={4} hashtags={['#build']} />);

    // A case variant of an existing tag dedupes away, leaving the array unchanged.
    await user.type(screen.getByPlaceholderText('+ hashtag'), '#BUILD{Enter}');

    expect(patch).not.toHaveBeenCalled();
  });

  it('surfaces a failed save in a note instead of silently dropping the tag', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(500, 'column hashtags is read only'));
    renderWithClient(<HashtagEditor postId={4} hashtags={['#build']} />);

    await user.type(screen.getByPlaceholderText('+ hashtag'), 'public{Enter}');

    const label = await screen.findByText('hashtags failed to save');
    expect(label.parentElement?.textContent).toBe('hashtags failed to save · column hashtags is read only');
  });
});

describe('HashtagEditor — tell marks', () => {
  it('marks a tell inside a chip and leaves the clean chips alone', () => {
    const { container } = renderWithClient(
      <HashtagEditor postId={4} hashtags={['#AIEngineering', '#seamless']} />,
    );

    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('seamless');
    expect(marks[0]!.getAttribute('data-tip')).toBe('AI vocabulary');
    expect(screen.getByText('#AIEngineering')).toBeInTheDocument();
  });
});
