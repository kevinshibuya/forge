import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Source } from '@forge/shared';
import { api, ApiError, type PostDetailDto, type PostDto } from '../api/client';
import { renderWithClient } from '../test/render';
import { SourcesEditor, inferKind } from './sources-editor';

const A: Source = { kind: 'web', ref: 'https://a', note: 'the first' };
const B: Source = { kind: 'file', ref: 'notes.md', note: 'the second' };

const post: PostDto = {
  id: 4, tier: 'T2', status: 'draft_ready', hook: null, bodyLinkedin: null,
  bodyX: null, hashtags: [], topicTags: [],
  scheduledDate: null, scheduledTime: null,
  publishedAt: null, linkedinUrl: null, imagePrompt: null,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  referenceAssetId: null, ideaText: null, selectedAsset: null, sources: [],
};
const saved: PostDetailDto = { post, revisions: [], latestDraft: null };

describe('inferKind', () => {
  it('calls a http or https ref web and everything else file', () => {
    expect(inferKind('https://a.b')).toBe('web');
    expect(inferKind('http://a')).toBe('web');
    expect(inferKind('ftp://a')).toBe('file');
    expect(inferKind('~/x.md')).toBe('file');
    expect(inferKind('x')).toBe('file');
  });
});

describe('SourcesEditor', () => {
  it('renders a row per source', () => {
    renderWithClient(<SourcesEditor postId={4} sources={[A, B]} />);

    expect(screen.getByRole('button', { name: 'edit source https://a' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'edit source notes.md' })).toBeTruthy();
    expect(screen.getByText('the second')).toBeTruthy();
  });

  it('adds a source with the whole next list, kind inferred', async () => {
    const user = userEvent.setup();
    const post_ = vi.spyOn(api, 'post').mockResolvedValue(saved);
    renderWithClient(<SourcesEditor postId={4} sources={[A]} />);

    await user.type(screen.getByPlaceholderText('ref'), 'https://x');
    await user.type(screen.getByPlaceholderText('note'), 'n{Enter}');

    expect(post_).toHaveBeenCalledWith('/posts/4/body', {
      sources: [A, { kind: 'web', ref: 'https://x', note: 'n' }],
    });
  });

  it('trims a ref typed with surrounding spaces', async () => {
    const user = userEvent.setup();
    const post_ = vi.spyOn(api, 'post').mockResolvedValue(saved);
    renderWithClient(<SourcesEditor postId={4} sources={[]} />);

    await user.type(screen.getByPlaceholderText('ref'), '   https://x   {Enter}');

    expect(post_).toHaveBeenCalledWith('/posts/4/body', {
      sources: [{ kind: 'web', ref: 'https://x', note: '' }],
    });
  });

  it('re-infers the kind when an edited ref stops being a url', async () => {
    const user = userEvent.setup();
    const post_ = vi.spyOn(api, 'post').mockResolvedValue(saved);
    renderWithClient(<SourcesEditor postId={4} sources={[A]} />);

    await user.click(screen.getByRole('button', { name: 'edit source https://a' }));
    const box = screen.getByDisplayValue('https://a');
    await user.clear(box);
    await user.type(box, 'notes.md{Enter}');

    expect(post_).toHaveBeenCalledWith('/posts/4/body', {
      sources: [{ kind: 'file', ref: 'notes.md', note: 'the first' }],
    });
  });

  it('removes a source by sending the list without it', async () => {
    const user = userEvent.setup();
    const post_ = vi.spyOn(api, 'post').mockResolvedValue(saved);
    renderWithClient(<SourcesEditor postId={4} sources={[A, B]} />);

    await user.click(screen.getByRole('button', { name: 'remove https://a' }));

    expect(post_).toHaveBeenCalledWith('/posts/4/body', { sources: [B] });
  });

  it('spends no write on an edit that changes nothing', async () => {
    const user = userEvent.setup();
    const post_ = vi.spyOn(api, 'post').mockResolvedValue(saved);
    renderWithClient(<SourcesEditor postId={4} sources={[A]} />);

    await user.click(screen.getByRole('button', { name: 'edit source https://a' }));
    await user.keyboard('{Enter}');

    expect(post_).not.toHaveBeenCalled();
  });

  it('escape clears the add row so the blur that follows adds nothing', async () => {
    const user = userEvent.setup();
    const post_ = vi.spyOn(api, 'post').mockResolvedValue(saved);
    renderWithClient(<SourcesEditor postId={4} sources={[]} />);

    const ref = screen.getByPlaceholderText('ref');
    await user.type(ref, 'https://x');
    await user.keyboard('{Escape}');

    // Assert the clear itself. Tabbing from ref lands on note, which is INSIDE the blur guard's
    // container, so a commit would not fire there either way and the old assertion passed even
    // with the Escape handler deleted.
    expect((ref as HTMLInputElement).value).toBe('');
    await user.tab();
    await user.tab();
    expect(post_).not.toHaveBeenCalled();
  });

  it('renders read-only rows with no controls and no add row', () => {
    renderWithClient(<SourcesEditor postId={4} sources={[A]} readOnly />);

    expect(screen.getByText('https://a')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByPlaceholderText('ref')).toBeNull();
  });

  it('surfaces a failed save in a note', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, 'post is measured; its body is final'));
    renderWithClient(<SourcesEditor postId={4} sources={[]} />);

    await user.type(screen.getByPlaceholderText('ref'), 'https://x{Enter}');

    const label = await screen.findByText('sources failed to save');
    expect(label.parentElement?.textContent).toBe('sources failed to save · post is measured; its body is final');
  });
});
