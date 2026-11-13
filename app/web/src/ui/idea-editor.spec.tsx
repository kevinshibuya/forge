import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, ApiError, type IdeaDto } from '../api/client';
import { renderWithClient } from '../test/render';
import { IdeaEditor } from './idea-editor';

const idea: IdeaDto = {
  id: 7, rawText: 'the idea as promoted', source: 'work', status: 'promoted', suggestedTier: 'T2',
  newsExpiry: null, notes: null, promotedPostId: 4, createdAt: '2026-08-01T00:00:00.000Z',
};

/** The patched row the api hands back. `usePatchIdea` refetches rather than reading it, but a
 *  partial object here would be a lie the moment it stops refetching. */
const patched = (rawText: string): IdeaDto => ({ ...idea, rawText });

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'edit the idea' }));
  return screen.getByRole('textbox', { name: 'the idea' });
}

describe('IdeaEditor', () => {
  it('shows the text at rest and opens a textarea on click', async () => {
    const user = userEvent.setup();
    renderWithClient(<IdeaEditor idea={idea} />);

    expect(screen.getByText('the idea as promoted')).toBeTruthy();
    const box = await openEditor(user);
    expect((box as HTMLTextAreaElement).value).toBe('the idea as promoted');
  });

  it('sends one trimmed PATCH on cmd+enter', async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(patched('sharper'));
    renderWithClient(<IdeaEditor idea={idea} />);

    const box = await openEditor(user);
    await user.clear(box);
    await user.type(box, '  sharper  ');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/ideas/7', { rawText: 'sharper' });
  });

  it('saves on blur when the text changed', async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(patched('reworded'));
    renderWithClient(<IdeaEditor idea={idea} />);

    const box = await openEditor(user);
    await user.clear(box);
    await user.type(box, 'reworded');
    await user.tab();

    expect(patch).toHaveBeenCalledWith('/ideas/7', { rawText: 'reworded' });
  });

  it('sends nothing when a blur follows no change', async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(patched('x'));
    renderWithClient(<IdeaEditor idea={idea} />);

    await openEditor(user);
    await user.tab();

    expect(patch).not.toHaveBeenCalled();
  });

  it('escape reverts the draft and the blur that follows sends nothing', async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(patched('x'));
    renderWithClient(<IdeaEditor idea={idea} />);

    const box = await openEditor(user);
    await user.clear(box);
    await user.type(box, 'thrown away');
    await user.keyboard('{Escape}');

    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByText('the idea as promoted')).toBeTruthy();
  });

  it('refuses an empty save, keeps the editor open and sends nothing', async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(patched('x'));
    renderWithClient(<IdeaEditor idea={idea} />);

    const box = await openEditor(user);
    await user.clear(box);
    await user.type(box, '   ');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByText('the idea cannot be empty')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'the idea' })).toBeTruthy();
  });

  it('surfaces a failed save in a note', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(409, "a promoted idea's status is frozen"));
    renderWithClient(<IdeaEditor idea={idea} />);

    const box = await openEditor(user);
    await user.clear(box);
    await user.type(box, 'sharper');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    const label = await screen.findByText('idea failed to save');
    expect(label.parentElement?.textContent).toBe("idea failed to save · a promoted idea's status is frozen");
  });
});
