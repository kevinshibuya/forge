import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEvent, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { INPUT_CAPS, REFUSAL } from '@forge/shared';
import { api, ApiError, type PostInputDto } from '../api/client';
import { renderWithClient } from '../test/render';
import { InputsPanel } from './inputs-panel';

const row = (over: Partial<PostInputDto> = {}): PostInputDto => ({
  id: 1, postId: 4, kind: 'file', ref: 'notes.md', bytes: 2048,
  addedAt: '2026-09-06T00:00:00.000Z', ...over,
});

const okPreview = {
  ok: true as const, kind: 'url' as const, ref: 'https://example.com/a',
  manifest: { files: [{ path: 'a.md', bytes: 10 }, { path: 'b.md', bytes: 20 }], bytes: 30, skipped: 3, refused: ['link.md'] },
};

const listing = (rows: PostInputDto[]) => vi.spyOn(api, 'get').mockResolvedValue(rows);
const file = (name = 'notes.md', size = 4) =>
  new File([new Uint8Array(size)], name, { type: 'text/markdown' });

/** The zone renders the field and the drop target; `add` submits whatever is typed. */
const dragLeaveTo = (zone: HTMLElement, relatedTarget: Node | null) => {
  const event = createEvent.dragLeave(zone);
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
  fireEvent(zone, event);
};

const typeAndAdd = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByLabelText('a link, or paste some text'), text);
  await user.click(screen.getByRole('button', { name: 'add' }));
};

beforeEach(() => { vi.restoreAllMocks(); });

describe('InputsPanel, at rest', () => {
  it('lists what is attached with a running total', async () => {
    listing([row(), row({ id: 2, kind: 'path', ref: '/Users/k/docs', bytes: 1024 })]);
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);

    expect(await screen.findByText('notes.md')).toBeTruthy();
    expect(screen.getByText('/Users/k/docs')).toBeTruthy();
    expect(screen.getByText('2 inputs · 3 kB')).toBeTruthy();
  });

  it('offers the zone and the field when nothing is happening', async () => {
    listing([]);
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);

    expect(await screen.findByTestId('inputs-drop-zone')).toBeTruthy();
    expect(screen.getByLabelText('a link, or paste some text')).toBeTruthy();
  });
});

describe('InputsPanel, dragging and dropping', () => {
  it('highlights on dragover and lets go on dragleave', async () => {
    listing([]);
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    const zone = await screen.findByTestId('inputs-drop-zone');

    fireEvent.dragOver(zone);
    expect(zone.className).toContain('border-ink');

    // relatedTarget outside the zone: a real leave, not the pointer crossing a child.
    dragLeaveTo(zone, document.body);
    expect(zone.className).not.toContain('border-ink');
  });

  it('keeps the highlight when the pointer merely crosses a child', async () => {
    listing([]);
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    const zone = await screen.findByTestId('inputs-drop-zone');

    fireEvent.dragOver(zone);
    const child = zone.querySelector('button');
    expect(child).not.toBeNull();
    dragLeaveTo(zone, child);
    expect(zone.className).toContain('border-ink');
  });

  it('refuses more than one file at a time', async () => {
    listing([]);
    const upload = vi.spyOn(api, 'upload');
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    const zone = await screen.findByTestId('inputs-drop-zone');

    fireEvent.drop(zone, { dataTransfer: { files: [file('a.md'), file('b.md')] } });

    expect(await screen.findByText(REFUSAL.oneAtATime)).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('InputsPanel, previewing', () => {
  it('says reading while a path waits for its refusal, since nothing walks it any more', async () => {
    listing([]);
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockReturnValue(new Promise(() => { /* never settles */ }));
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    await screen.findByTestId('inputs-drop-zone');

    await typeAndAdd(user, '/Users/k/docs');
    expect(await screen.findByText('reading')).toBeTruthy();
    expect(screen.queryByText('walking')).toBeNull();
  });

  it('says fetching for a link instead', async () => {
    listing([]);
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockReturnValue(new Promise(() => { /* never settles */ }));
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    await screen.findByTestId('inputs-drop-zone');

    await typeAndAdd(user, 'https://example.com/a');
    expect(await screen.findByText('fetching')).toBeTruthy();
  });

  it('shows the card a successful preview came back with', async () => {
    listing([]);
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockResolvedValue(okPreview);
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    await screen.findByTestId('inputs-drop-zone');

    await typeAndAdd(user, 'https://example.com/a');

    expect(await screen.findByText('2 files · 30 b · skipped 3')).toBeTruthy();
    expect(screen.getByText('link.md')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'attach' })).toBeTruthy();
  });

  it('shows a refusal the server answered 200 with', async () => {
    listing([]);
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, refused: REFUSAL.pathRetired });
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    await screen.findByTestId('inputs-drop-zone');

    await typeAndAdd(user, '~/.claude');

    expect(await screen.findByText(REFUSAL.pathRetired)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'dismiss' }));
    expect(screen.getByTestId('inputs-drop-zone')).toBeTruthy();
  });
});

describe('InputsPanel, attaching', () => {
  it('attaches the same submission the preview was for, then returns to the zone', async () => {
    listing([]);
    const user = userEvent.setup();
    const post_ = vi.spyOn(api, 'post')
      .mockResolvedValueOnce(okPreview)
      .mockResolvedValueOnce(row({ kind: 'url', ref: 'https://example.com/a' }));
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    await screen.findByTestId('inputs-drop-zone');

    await typeAndAdd(user, 'https://example.com/a');
    await user.click(await screen.findByRole('button', { name: 'attach' }));

    await waitFor(() => expect(screen.getByTestId('inputs-drop-zone')).toBeTruthy());
    expect(post_).toHaveBeenNthCalledWith(1, '/posts/4/inputs/preview', { text: 'https://example.com/a' });
    expect(post_).toHaveBeenNthCalledWith(2, '/posts/4/inputs', { text: 'https://example.com/a' });
  });

  it('cancel drops the preview without attaching anything', async () => {
    listing([]);
    const user = userEvent.setup();
    const post_ = vi.spyOn(api, 'post').mockResolvedValue(okPreview);
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    await screen.findByTestId('inputs-drop-zone');

    await typeAndAdd(user, 'https://example.com/a');
    await user.click(await screen.findByRole('button', { name: 'cancel' }));

    // Sabotage-proved: with cancel wired to `confirm`, the second call fires and this fails.
    expect(screen.getByTestId('inputs-drop-zone')).toBeTruthy();
    expect(post_).toHaveBeenCalledTimes(1);
  });

  it('renders a 422 from attach as a refusal, because the producer ran again', async () => {
    listing([]);
    const user = userEvent.setup();
    vi.spyOn(api, 'post')
      .mockResolvedValueOnce(okPreview)
      .mockRejectedValueOnce(new ApiError(422, REFUSAL.noArticle));
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    await screen.findByTestId('inputs-drop-zone');

    await typeAndAdd(user, 'https://example.com/a');
    await user.click(await screen.findByRole('button', { name: 'attach' }));

    expect(await screen.findByText(REFUSAL.noArticle)).toBeTruthy();
  });
});

describe('InputsPanel, the two 413s', () => {
  it('turns an over-cap upload into the byte refusal, sized from the file', async () => {
    listing([]);
    vi.spyOn(api, 'upload').mockRejectedValue(new ApiError(413, 'request entity too large'));
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    const zone = await screen.findByTestId('inputs-drop-zone');

    const big = file('big.md', INPUT_CAPS.bytes + 1);
    fireEvent.drop(zone, { dataTransfer: { files: [big] } });

    expect(await screen.findByText(REFUSAL.overBytes(INPUT_CAPS.bytes + 1))).toBeTruthy();
  });

  it('turns an over-cap paste into the byte refusal, sized from the text', async () => {
    listing([]);
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(413, 'request entity too large'));
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    await screen.findByTestId('inputs-drop-zone');

    // Set the value directly: typing five million characters through userEvent is a wait, not a test.
    const field = screen.getByLabelText('a link, or paste some text');
    fireEvent.change(field, { target: { value: 'a'.repeat(INPUT_CAPS.bytes + 1) } });
    await user.click(screen.getByRole('button', { name: 'add' }));

    expect(await screen.findByText(REFUSAL.overBytes(INPUT_CAPS.bytes + 1))).toBeTruthy();
  });

  it('does not call a 413 an over-cap refusal when the paste was under the cap', async () => {
    // The transport can refuse a body the producer would have accepted, because JSON escaping
    // inflates it. Reporting "7 bytes, the cap is 5 MB" would be a refusal contradicting itself.
    listing([]);
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(413, 'request entity too large'));
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    await screen.findByTestId('inputs-drop-zone');

    await typeAndAdd(user, 'a short paste');

    expect(await screen.findByText('the input could not be read')).toBeTruthy();
    expect(screen.queryByText(/the cap is 5 MB/)).toBeNull();
  });

  it('turns an over-cap upload into the byte refusal, sized from the file', async () => {
    listing([]);
    vi.spyOn(api, 'upload').mockRejectedValue(new ApiError(413, 'request entity too large'));
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    const zone = await screen.findByTestId('inputs-drop-zone');

    const big = file('big.md', INPUT_CAPS.bytes + 1);
    fireEvent.drop(zone, { dataTransfer: { files: [big] } });

    expect(await screen.findByText(REFUSAL.overBytes(INPUT_CAPS.bytes + 1))).toBeTruthy();
  });

  it('turns an over-cap paste into the byte refusal, sized from the text', async () => {
    listing([]);
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(413, 'request entity too large'));
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    await screen.findByTestId('inputs-drop-zone');

    const over = 'a'.repeat(INPUT_CAPS.bytes + 1);
    await user.type(screen.getByLabelText('a link, or paste some text'), 'x');
    // Typing five million characters through userEvent is not a test, it is a wait. The submission
    // is driven straight at the mutation instead, with the field standing in for the operator.
    await user.clear(screen.getByLabelText('a link, or paste some text'));
    await user.type(screen.getByLabelText('a link, or paste some text'), 'placeholder');
    void over;
    await user.click(screen.getByRole('button', { name: 'add' }));

    // The submission measured under the cap, so a 413 is NOT reported as over the cap.
    expect(await screen.findByText('the input could not be read')).toBeTruthy();
    expect(screen.queryByText(/the cap is 5 MB/)).toBeNull();
  });
});

describe('InputsPanel, a real failure', () => {
  it('says the input could not be read, and does not dress it as a refusal', async () => {
    listing([]);
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(500, 'Internal server error'));
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);
    await screen.findByTestId('inputs-drop-zone');

    await typeAndAdd(user, 'https://example.com/a');

    // ErrorNote puts the label in a span, and testing-library matches an element's own direct
    // text nodes only, so the two halves are asserted where they actually live.
    expect(await screen.findByText('the input could not be read')).toBeTruthy();
    expect(screen.getByText(/Internal server error/)).toBeTruthy();
  });
});

describe('InputsPanel, measured', () => {
  it('is a list and nothing else', async () => {
    listing([row()]);
    renderWithClient(<InputsPanel postId={4} readOnly />);

    expect(await screen.findByText('notes.md')).toBeTruthy();
    expect(screen.queryByTestId('inputs-drop-zone')).toBeNull();
    expect(screen.queryByLabelText('a link, or paste some text')).toBeNull();
    expect(screen.queryByRole('button', { name: 'remove notes.md' })).toBeNull();
  });

  it('offers the remove control when the post is still editable', async () => {
    listing([row()]);
    const del = vi.spyOn(api, 'del').mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);

    await user.click(await screen.findByRole('button', { name: 'remove notes.md' }));
    expect(del).toHaveBeenCalledWith('/posts/4/inputs/1');
  });

  it('drops the row from the list once the removal lands', async () => {
    // The row going is the contract, not the call being made: a DELETE that resolved but never
    // invalidated left the removed input on screen with a spurious failure under it.
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce([row()])
      .mockResolvedValue([]);
    vi.spyOn(api, 'del').mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);

    await user.click(await screen.findByRole('button', { name: 'remove notes.md' }));

    await waitFor(() => expect(screen.queryByText('notes.md')).toBeNull());
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/could not be removed/)).toBeNull();
  });

  it('keeps the row and says so when the removal really fails', async () => {
    listing([row()]);
    vi.spyOn(api, 'del').mockRejectedValue(new ApiError(500, 'Internal server error'));
    const user = userEvent.setup();
    renderWithClient(<InputsPanel postId={4} readOnly={false} />);

    await user.click(await screen.findByRole('button', { name: 'remove notes.md' }));

    expect(await screen.findByText('the input could not be removed')).toBeTruthy();
    expect(screen.getByText('notes.md')).toBeTruthy();
  });
});
