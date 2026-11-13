import { useRef } from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError, type RunDto } from '../api/client';
import { renderWithClient } from '../test/render';
import { RunWatcherProvider } from './run-console';
import { SelectionRefine } from './selection-refine';

// jsdom does no layout, so the mirror-div measurement can only ever return nothing here.
// One all-zero box, never `[]`: an empty array sends ±Infinity through the placement math.
vi.mock('../lib/textarea-caret', () => ({
  measureSelectionRects: () => [{ top: 0, left: 0, right: 0, bottom: 0 }],
  measureSelection: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
}));

const POST_ID = 4;
const RUN_ID = 55;
const BODY = 'nobody measures this properly';

const runRow = (over: Partial<RunDto> = {}): RunDto => ({
  id: RUN_ID, engine: 'claude', kind: 'refine_selection', model: 'opus-5',
  prompt: 'p', output: null, parsedOk: null, status: 'succeeded',
  failureKind: null, error: null, postId: POST_ID, declined: null,
  tokensInput: null, tokensCacheWrite: null, tokensCacheRead: null, tokensOutput: null, imagesGenerated: null, costUsd: null,
  startedAt: '2026-08-12T10:00:00.000Z', finishedAt: '2026-08-12T10:00:30.000Z',
  ...over,
});

/**
 * Both spies dispatch on path. `api.get` must answer the provider's always-on running poll with
 * `[]` — a non-empty list would mount FloatingRunConsole's stream block, which opens an
 * EventSource and needs router context. `api.post` must tell launch from body-save: a blanket
 * rejection would fail the launch and leave the accept branch unreachable.
 */
function stubGets(opts: { run?: RunDto; proposedBody?: string; proposalError?: Error } = {}) {
  return vi.spyOn(api, 'get').mockImplementation(((path: string) => {
    if (path === '/runs?status=running') return Promise.resolve([]);
    if (path.includes('/refine-selection/')) {
      return opts.proposalError
        ? Promise.reject(opts.proposalError)
        : Promise.resolve({ proposedBody: opts.proposedBody ?? BODY });
    }
    if (path.startsWith('/runs/')) return Promise.resolve(opts.run ?? runRow());
    return Promise.reject(new Error(`unexpected GET ${path}`));
  }) as typeof api.get);
}

function stubPosts(opts: { launch?: Error; save?: Error } = {}) {
  return vi.spyOn(api, 'post').mockImplementation(((path: string) => {
    if (path.endsWith('/refine-selection')) {
      return opts.launch ? Promise.reject(opts.launch) : Promise.resolve({ runId: RUN_ID });
    }
    if (path.endsWith('/body')) {
      return opts.save ? Promise.reject(opts.save) : Promise.resolve({});
    }
    return Promise.reject(new Error(`unexpected POST ${path}`));
  }) as typeof api.post);
}

function Harness({ blocked = false, onSaveEdits, saving = false }: {
  blocked?: boolean;
  onSaveEdits?: () => Promise<void>;
  saving?: boolean;
} = {}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  return (
    <RunWatcherProvider>
      <textarea ref={ref} data-testid="body" defaultValue={BODY} />
      <SelectionRefine
        postId={POST_ID} textareaRef={ref} blocked={blocked}
        onSaveEdits={onSaveEdits} saving={saving}
      />
    </RunWatcherProvider>
  );
}

/**
 * `read()` early-returns unless the textarea is the active element, so the focus and the range are
 * both load-bearing (drop either and all four cases fail). jsdom 29 fires `selectionchange` off
 * `setSelectionRange` on its own; the explicit dispatch is kept because that is a jsdom detail,
 * not a spec'd one, and the popover is unreachable without the event.
 */
async function openPopover(): Promise<HTMLElement> {
  const ta = screen.getByTestId<HTMLTextAreaElement>('body');
  act(() => {
    ta.focus();
    ta.setSelectionRange(0, 6);
    document.dispatchEvent(new Event('selectionchange'));
  });
  return screen.findByRole('dialog', { name: 'refine selection' });
}

/** Fill the instruction and press refine — the only route from compose into launched. */
async function launch(user: ReturnType<typeof userEvent.setup>, popover: HTMLElement) {
  await user.type(
    screen.getByPlaceholderText('e.g. make this land harder, cut the hedging'),
    'cut the hedging',
  );
  await user.click(screen.getByRole('button', { name: 'refine' }));
  return popover;
}

/** ErrorNote splits label and message into siblings; read the whole note. */
function noteText(label: string): string {
  return screen.getByText(label).parentElement?.textContent ?? '';
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SelectionRefine', () => {
  it('opens on a selection — scaffolding for the branches below', async () => {
    stubGets();
    renderWithClient(<Harness />);
    const popover = await openPopover();
    expect(popover).toBeInTheDocument();
    expect(popover.textContent).toContain('6 chars');
  });

  it('surfaces a failed launch without leaving compose', async () => {
    const user = userEvent.setup();
    stubGets();
    stubPosts({ launch: new ApiError(503, 'engine pool exhausted') });
    renderWithClient(<Harness />);

    await launch(user, await openPopover());

    expect(await screen.findByText('launch failed')).toBeInTheDocument();
    expect(noteText('launch failed')).toBe('launch failed · engine pool exhausted');
  });

  it('reads a terminal non-success run row as the failure', async () => {
    // The middle arm of `failure`: the launch succeeded, so nothing rejected — the run row itself
    // is the bad news, and only the row's own words can say why.
    const user = userEvent.setup();
    stubGets({ run: runRow({ status: 'failed', failureKind: 'nonzero_exit', error: 'engine exited 1' }) });
    stubPosts();
    renderWithClient(<Harness />);

    await launch(user, await openPopover());

    expect(await screen.findByText('error')).toBeInTheDocument();
    expect(noteText('error')).toBe(`error · run #${RUN_ID} nonzero_exit: engine exited 1`);
  });

  it('surfaces a failed accept without discarding the proposal', async () => {
    const user = userEvent.setup();
    stubGets({ proposedBody: 'nobody prices this properly' });
    stubPosts({ save: new ApiError(500, 'revision write failed') });
    renderWithClient(<Harness />);

    await launch(user, await openPopover());

    await user.click(await screen.findByRole('button', { name: 'accept' }));

    expect(await screen.findByText('accept failed')).toBeInTheDocument();
    expect(noteText('accept failed')).toBe('accept failed · revision write failed');
    // The diff is still on screen — a failed write must not throw the proposal away.
    expect(screen.getByRole('button', { name: 'accept' })).toBeInTheDocument();
  });

describe('SelectionRefine — unsaved edits', () => {
  it('offers to save and refine rather than dead-ending on "save first"', async () => {
    const onSaveEdits = vi.fn(() => Promise.resolve());
    renderWithClient(<Harness blocked onSaveEdits={onSaveEdits} />);
    await openPopover();

    // The refine form is withheld, because the server would slice its own copy of the body.
    expect(screen.queryByPlaceholderText(/make this land harder/)).toBeNull();
    expect(screen.getByText(/this refine runs against the saved body/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'save and refine' }));
    expect(onSaveEdits).toHaveBeenCalledTimes(1);
  });

  it('sends the selection and the instruction, with no research key and no checkbox', async () => {
    const user = userEvent.setup();
    stubGets();
    const post = stubPosts();
    renderWithClient(<Harness />);
    const popover = await openPopover();

    expect(screen.queryByRole('checkbox', { name: 'research' })).toBeNull();
    await launch(user, popover);

    expect(post).toHaveBeenCalledWith(`/posts/${POST_ID}/refine-selection`, {
      selectionStart: 0, selectionEnd: 6, instruction: 'cut the hedging',
    });
  });

  it('shows the save in flight', async () => {
    renderWithClient(<Harness blocked saving onSaveEdits={() => Promise.resolve()} />);
    await openPopover();
    expect(screen.getByRole('button', { name: 'saving…' })).toBeDisabled();
  });

  it('still just warns when no save handler is wired', async () => {
    renderWithClient(<Harness blocked />);
    await openPopover();
    expect(screen.getByText(/this refine runs against the saved body/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'save and refine' })).toBeNull();
  });
});
});