import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError } from '../api/client';
import { renderPage } from '../test/render';
import { spyPendingExcept } from '../test/pending';
import { RunWatcherProvider } from '../ui/run-console';
import type { IdeaDto, PostDetailDto, PostDto, RunDto } from '../api/client';
import type { Source } from '@forge/shared';
import Workspace from './Workspace';

// jsdom does no layout, so the mirror-div measurement can only ever return nothing here.
// One box per call, never `[]`: the overlay paints one rect per box and the refine layer's
// placement math sends \u00b1Infinity through an empty array.
vi.mock('../lib/textarea-caret', () => ({
  measureSelectionRects: () => [{ top: 0, left: 0, right: 0, bottom: 0 }],
  measureSelection: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
}));

const POST_ID = 5;

const post = (over: Partial<PostDto> = {}): PostDto => ({
  id: POST_ID, tier: 'T1', status: 'draft_ready', hook: 'the hook', bodyLinkedin: 'the body',
  bodyX: null, hashtags: [], topicTags: [],
  scheduledDate: null, scheduledTime: null,
  publishedAt: null, linkedinUrl: null, imagePrompt: null,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  referenceAssetId: null, ideaText: null, selectedAsset: null,
  sources: [],
  ...over,
});

const detail = (bodyLinkedin: string, over: Partial<PostDto> = {}): PostDetailDto =>
  ({ post: post({ bodyLinkedin, ...over }), revisions: [], latestDraft: null });

const idea = (rawText: string): IdeaDto => ({
  id: 7, rawText, source: 'work', status: 'promoted', suggestedTier: 'T1',
  newsExpiry: null, notes: null, promotedPostId: POST_ID, createdAt: '2026-09-01T00:00:00.000Z',
});

/** Every path the loaded workspace reads, so nothing is left hanging in its pending branch.
 *  `ideas` defaults to none, which is the shape most cases want. */
function loaded(bodyLinkedin: string, ideas: IdeaDto[] = [], over: Partial<PostDto> = {}): Record<string, unknown> {
  return {
    '/runs?status=running': [],
    [`/posts/${POST_ID}`]: detail(bodyLinkedin, over),
    [`/ideas?promotedPostId=${POST_ID}`]: ideas,
    [`/runs?postId=${POST_ID}`]: [],
    [`/posts/${POST_ID}/inputs`]: [],
  };
}

describe('Workspace — pending', () => {
  it('shows the page header immediately with the skeleton below it, and no spinner', () => {
    // The watcher polls exactly this path; leaving it hanging would hold the whole tree.
    spyPendingExcept({ '/runs?status=running': [] });
    const { container } = renderPage(
      <RunWatcherProvider><Workspace /></RunWatcherProvider>,
      { route: '/posts/5', path: '/posts/:id' },
    );

    expect(screen.getByText('post workspace')).toBeInTheDocument();
    expect(container.querySelector('[data-probe="skeleton-workspace"]')).not.toBeNull();
    expect(container.querySelector('[data-probe="spinner"]')).toBeNull();
  });
});

describe('Workspace — tell marks on the body', () => {
  it('paints a rect over an em dash in the loaded body', async () => {
    spyPendingExcept(loaded('the body \u2014 with a dash'));
    renderPage(
      <RunWatcherProvider><Workspace /></RunWatcherProvider>,
      { route: `/posts/${POST_ID}`, path: '/posts/:id' },
    );

    await waitFor(() => expect(screen.getByTitle('em dash')).toBeInTheDocument());
  });

  it('paints nothing over a clean body', async () => {
    spyPendingExcept(loaded('a clean body about api surfaces'));
    const { container } = renderPage(
      <RunWatcherProvider><Workspace /></RunWatcherProvider>,
      { route: `/posts/${POST_ID}`, path: '/posts/:id' },
    );

    await waitFor(() => expect(screen.getByText('post workspace')).toBeInTheDocument());
    expect(container.querySelector('[title="em dash"]')).toBeNull();
  });
});

describe('Workspace — launching', () => {
  /** Renders a loaded workspace with api.post spied, ready for one launch. */
  const ready = async (post = vi.spyOn(api, 'post').mockResolvedValue({ runId: 9, degraded: false })) => {
    spyPendingExcept(loaded('the body'));
    renderPage(
      <RunWatcherProvider><Workspace /></RunWatcherProvider>,
      { route: `/posts/${POST_ID}`, path: '/posts/:id' },
    );
    return { post, draft: await screen.findByRole('button', { name: 're-draft' }) };
  };

  it('drafts with an empty body, and offers no research control', async () => {
    const { post, draft } = await ready();
    expect(screen.queryByRole('button', { name: /research/ })).toBeNull();
    await userEvent.click(draft);
    expect(post).toHaveBeenCalledWith(`/posts/${POST_ID}/draft`, {});
  });

  it('refines with the feedback alone', async () => {
    const { post } = await ready();
    await userEvent.type(screen.getByPlaceholderText(/tighten the middle/), 'shorter');
    await userEvent.click(screen.getByRole('button', { name: 'refine' }));
    expect(post).toHaveBeenCalledWith(`/posts/${POST_ID}/refine`, { feedback: 'shorter' });
  });

  it('shows the refusal a post with inputs gets, in the page error note', async () => {
    const refused = `post ${POST_ID} has 2 inputs; a draft that reads inputs returns with slice 9 (input and research delivery)`;
    const { draft } = await ready(vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, refused)));
    await userEvent.click(draft);
    expect(await screen.findByText(/returns with slice 9/)).toBeInTheDocument();
  });
});

/** A succeeded research draft, output shaped the way the engine actually stores it: the JSON
 *  sits inside a fence. Run 106 against the live api recorded exactly this shape. */
const researchRun = (output: string): RunDto => ({
  id: 106, engine: 'claude', kind: 'draft', model: 'opus', prompt: 'p', output,
  parsedOk: true, status: 'succeeded', failureKind: null, error: null, postId: POST_ID, declined: null,
  tokensInput: null, tokensCacheWrite: null, tokensCacheRead: null, tokensOutput: null, imagesGenerated: null, costUsd: null,
  startedAt: '2026-09-04T00:00:00.000Z', finishedAt: '2026-09-04T00:01:00.000Z',
});

describe('Workspace — sources under the body', () => {
  /** The post owns the list now: it comes off `post.sources`, not off re-parsing the last run. */
  function loadedWithSources(sources: Source[]): Record<string, unknown> {
    return {
      ...loaded('the body'),
      [`/posts/${POST_ID}`]: {
        post: post({ bodyLinkedin: 'the body', sources }), revisions: [], latestDraft: null,
      },
    };
  }

  it("lists the post's own sources", async () => {
    spyPendingExcept(loadedWithSources([
      { kind: 'file', ref: 'harness/CLAUDE.md', note: 'quoted its first line' },
    ]));
    renderPage(
      <RunWatcherProvider><Workspace /></RunWatcherProvider>,
      { route: `/posts/${POST_ID}`, path: '/posts/:id' },
    );

    expect(await screen.findByText('sources')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'edit source harness/CLAUDE.md' })).toBeInTheDocument();
    expect(screen.getByText('quoted its first line')).toBeInTheDocument();
  });

  it('still shows the heading and the add row when the post cites nothing', async () => {
    spyPendingExcept(loadedWithSources([]));
    renderPage(
      <RunWatcherProvider><Workspace /></RunWatcherProvider>,
      { route: `/posts/${POST_ID}`, path: '/posts/:id' },
    );

    expect(await screen.findByText('sources')).toBeInTheDocument();
    // Reachable with an empty list, which is the only way to add the first one.
    expect(screen.getByPlaceholderText('ref')).toBeInTheDocument();
  });

  it('renders read-only on a measured post', async () => {
    spyPendingExcept({
      ...loaded('the body'),
      [`/posts/${POST_ID}`]: {
        post: post({
          bodyLinkedin: 'the body', status: 'measured',
          sources: [{ kind: 'web', ref: 'https://a', note: 'cited' }],
        }),
        revisions: [], latestDraft: null,
      },
    });
    renderPage(
      <RunWatcherProvider><Workspace /></RunWatcherProvider>,
      { route: `/posts/${POST_ID}`, path: '/posts/:id' },
    );

    expect(await screen.findByText('https://a')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'edit source https://a' })).toBeNull();
    expect(screen.queryByPlaceholderText('ref')).toBeNull();
  });

  it('closes every editor on a measured post, not only the sources panel', async () => {
    spyPendingExcept({
      ...loaded('the body', [idea('the idea text')]),
      [`/posts/${POST_ID}`]: {
        post: post({ bodyLinkedin: 'the body', status: 'measured', hashtags: ['#one'] }),
        revisions: [], latestDraft: null,
      },
    });
    renderPage(
      <RunWatcherProvider><Workspace /></RunWatcherProvider>,
      { route: `/posts/${POST_ID}`, path: '/posts/:id' },
    );

    expect(await screen.findByText('the idea text')).toBeInTheDocument();
    // The idea is a paragraph, not a control.
    expect(screen.queryByRole('button', { name: 'edit the idea' })).toBeNull();
    // The hashtag keeps its pill and loses its remove control and the add field.
    expect(screen.getByText('#one')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'remove #one' })).toBeNull();
    expect(screen.queryByPlaceholderText('+ hashtag')).toBeNull();
    // The body cannot be typed into, and the save button cannot be clicked into a 409.
    expect(screen.getByPlaceholderText('no body yet — draft with claude or write by hand')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'saved' })).toBeDisabled();
    // The inputs panel is a list only.
    expect(screen.queryByTestId('inputs-drop-zone')).toBeNull();
  });

  it('leaves every editor open on a post that is still draft_ready', async () => {
    spyPendingExcept(loaded('the body', [idea('the idea text')]));
    renderPage(
      <RunWatcherProvider><Workspace /></RunWatcherProvider>,
      { route: `/posts/${POST_ID}`, path: '/posts/:id' },
    );

    expect(await screen.findByRole('button', { name: 'edit the idea' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('add a hashtag')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('no body yet — draft with claude or write by hand')).not.toBeDisabled();
    expect(screen.getByTestId('inputs-drop-zone')).toBeInTheDocument();
  });
});

describe('Workspace — failure strip', () => {
  const declined = { outcome: 'declined' as const, reason: 'the idea is a placeholder', question: 'is post 5 a smoke test?' };
  const failedDraft: RunDto = {
    ...researchRun(''), id: 113, output: null, parsedOk: true, status: 'failed', failureKind: 'declined',
    error: declined.reason, declined, startedAt: '2026-09-04T10:00:00.000Z', finishedAt: '2026-09-04T10:00:30.000Z',
  };
  const succeededLater: RunDto = { ...researchRun('{"body_linkedin":"the body","hashtags":[]}'), id: 114, startedAt: '2026-09-04T11:00:00.000Z' };

  it('shows the strip when the newest draft run failed', async () => {
    spyPendingExcept({ ...loaded('the body'), [`/runs?postId=${POST_ID}`]: [failedDraft] });
    renderPage(
      <RunWatcherProvider><Workspace /></RunWatcherProvider>,
      { route: `/posts/${POST_ID}`, path: '/posts/:id' },
    );
    expect(await screen.findByText(declined.question)).toBeInTheDocument();
    expect(screen.getByText(declined.reason)).toBeInTheDocument();
  });

  it('shows no strip when a succeeded draft is newer than the failure', async () => {
    spyPendingExcept({ ...loaded('the body'), [`/runs?postId=${POST_ID}`]: [failedDraft, succeededLater] });
    renderPage(
      <RunWatcherProvider><Workspace /></RunWatcherProvider>,
      { route: `/posts/${POST_ID}`, path: '/posts/:id' },
    );
    expect(await screen.findByRole('button', { name: 're-draft' })).toBeInTheDocument();
    expect(screen.queryByText(declined.question)).toBeNull();
  });
});

describe('Workspace — the idea', () => {
  it('renders the promoted idea in its editor, click to open', async () => {
    const user = userEvent.setup();
    spyPendingExcept(loaded('the body', [idea('the idea as promoted')]));
    renderPage(
      <RunWatcherProvider><Workspace /></RunWatcherProvider>,
      { route: `/posts/${POST_ID}`, path: '/posts/:id' },
    );

    const button = await screen.findByRole('button', { name: 'edit the idea' });
    expect(button).toHaveTextContent('the idea as promoted');
    await user.click(button);
    expect(screen.getByRole('textbox', { name: 'the idea' })).toBeInTheDocument();
  });
});

describe('Workspace — delete', () => {
  it('offers delete post on a post that is not measured', async () => {
    spyPendingExcept(loaded('the body'));
    renderPage(<RunWatcherProvider><Workspace /></RunWatcherProvider>, { route: '/posts/5', path: '/posts/:id' });
    expect(await screen.findByRole('button', { name: 'delete post' })).toBeInTheDocument();
  });

  it('offers nothing on a measured post', async () => {
    spyPendingExcept(loaded('the body', [], { status: 'measured', publishedAt: '2026-09-01T12:00:00.000Z' }));
    renderPage(<RunWatcherProvider><Workspace /></RunWatcherProvider>, { route: '/posts/5', path: '/posts/:id' });
    // The marker first: without it the absence below passes during the loading skeleton.
    await screen.findByRole('button', { name: 'copy to clipboard' });
    expect(screen.queryByRole('button', { name: 'delete post' })).toBeNull();
  });
});
