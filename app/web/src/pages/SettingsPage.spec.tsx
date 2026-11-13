import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, type ModelRowDto, type SettingsDto } from '../api/client';
import { renderPage } from '../test/render';
import { spyPendingExcept } from '../test/pending';
import SettingsPage from './SettingsPage';

const settings = (over: Partial<SettingsDto> = {}): SettingsDto => ({
  scheduling: { timezone: 'America/Sao_Paulo', weeklyGoal: null },
  runTimeoutMs: 600_000, retrievalK: 5, imageCandidateBatch: 4,
  embeddingModel: 'text-embedding-3-small',
  personaDoc: 'the persona', goalDoc: 'the goal', designLanguageDoc: 'the design language',
  retroEveryMeasured: 3,
  styleDocs: [{ id: 'unslop', name: 'unslop', body: 'no hype.', enabled: true, excludedKinds: [] }],
  ...over,
});

const LIST = { inputPerMtok: 2, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.2, outputPerMtok: 10, imagePerUnit: 0 };
const row = (id: number, task: string, backend: 'cli' | 'api', engine: ModelRowDto['engine'], model: string, over: Partial<ModelRowDto> = {}): ModelRowDto => ({
  id, task, backend, engine, model, effort: null, maxOutputTokens: 8192, prices: LIST,
  updatedAt: '2026-09-25T00:00:00.000Z', ...over,
});
/** The live shape: five api rows, eight cli rows, as GET /registry orders them (backend, task). */
const REGISTRY: ModelRowDto[] = [
  row(9, 'draft_t1', 'api', 'anthropic', 'claude-sonnet-5', { effort: 'high', maxOutputTokens: 16384 }),
  row(10, 'draft_t2', 'api', 'anthropic', 'claude-sonnet-5', { effort: 'high', maxOutputTokens: 16384 }),
  row(11, 'draft_t3', 'api', 'anthropic', 'claude-sonnet-5', { effort: 'medium', maxOutputTokens: 16384 }),
  row(13, 'retro', 'api', 'anthropic', 'claude-sonnet-5', { effort: 'high', maxOutputTokens: 16384 }),
  row(12, 'triage', 'api', 'anthropic', 'claude-haiku-4-5', { maxOutputTokens: 2048 }),
  row(1, 'draft_t1', 'cli', 'claude', 'claude-opus-4-8', { maxOutputTokens: 16384 }),
  row(2, 'draft_t2', 'cli', 'claude', 'claude-opus-4-8', { maxOutputTokens: 16384 }),
  row(3, 'draft_t3', 'cli', 'claude', 'claude-sonnet-5', { maxOutputTokens: 16384 }),
  row(6, 'image_gen', 'cli', 'codex', 'gpt-image-2', { prices: { ...LIST, inputPerMtok: 0, cacheWritePerMtok: 0, cacheReadPerMtok: 0, outputPerMtok: 0, imagePerUnit: 0.25 } }),
  row(5, 'image_html', 'cli', 'claude', 'claude-opus-4-8'),
  row(7, 'image_review', 'cli', 'claude', 'claude-opus-4-8'),
  row(8, 'retro', 'cli', 'claude', 'claude-opus-4-8'),
  row(4, 'triage', 'cli', 'claude', 'claude-sonnet-5'),
];
const loaded = () => ({ '/settings': settings(), '/registry': REGISTRY });

describe('SettingsPage — the model registry', () => {
  it('lists every registry row, the cli backend first', async () => {
    spyPendingExcept(loaded());
    renderPage(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText('model for draft_t1 on cli')).toBeInTheDocument());
    expect(screen.getAllByLabelText(/^model for .+ on (cli|api)$/)).toHaveLength(13);
    const models = screen.getAllByLabelText(/^model for /).map((el) => el.getAttribute('aria-label'));
    expect(models.indexOf('model for triage on cli')).toBeLessThan(models.indexOf('model for draft_t1 on api'));
  });

  it('saves one row with numbers, not the strings it was typed as', async () => {
    spyPendingExcept(loaded());
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(REGISTRY[5]);
    renderPage(<SettingsPage />);

    const input = await screen.findByLabelText('input price for draft_t1 on cli');
    await userEvent.clear(input);
    await userEvent.type(input, '4.5');
    await userEvent.click(screen.getByRole('button', { name: 'save draft_t1 on cli' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const [path, body] = patch.mock.calls[0]!;
    expect(path).toBe('/registry/1');
    expect(body).toEqual({
      engine: 'claude', model: 'claude-opus-4-8', effort: null, maxOutputTokens: 16384,
      inputPerMtok: 4.5, cacheWritePerMtok: 2.5, cacheReadPerMtok: 0.2, outputPerMtok: 10, imagePerUnit: 0,
    });
    await waitFor(() => expect(screen.getByText('saved ✓')).toBeInTheDocument());
  });

  it('blocks a negative price on the row that carries it', async () => {
    spyPendingExcept(loaded());
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(REGISTRY[0]);
    renderPage(<SettingsPage />);

    const output = await screen.findByLabelText('output price for triage on api');
    await userEvent.clear(output);
    await userEvent.type(output, '-1');

    expect(screen.getByText('triage · api')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'save triage on api' })).toBeDisabled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('offers a cli row only the cli engines', async () => {
    spyPendingExcept(loaded());
    renderPage(<SettingsPage />);

    const select = await screen.findByLabelText('engine for draft_t1 on cli');
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual(['claude', 'codex']);
    const api = screen.getByLabelText('engine for draft_t1 on api') as HTMLSelectElement;
    expect([...api.options].map((o) => o.value)).toEqual(['anthropic', 'openai']);
  });
});

describe('SettingsPage — pending', () => {
  it('shows the form skeleton, not a spinner, while the fetch is in flight', () => {
    spyPendingExcept();
    const { container } = renderPage(<SettingsPage />);

    expect(container.querySelector('[data-probe="skeleton-settings"]')).not.toBeNull();
    expect(container.querySelector('[data-probe="spinner"]')).toBeNull();
  });
});

describe('SettingsPage — style docs', () => {
  it('unticking a kind saves it into excludedKinds', async () => {
    spyPendingExcept(loaded());
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(settings());
    renderPage(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText('unslop applies to triage')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('unslop applies to triage'));
    await userEvent.click(screen.getByRole('button', { name: 'save style docs' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const [path, body] = patch.mock.calls[0]!;
    expect(path).toBe('/settings');
    expect((body as { styleDocs: { excludedKinds: string[] }[] }).styleDocs[0]!.excludedKinds).toEqual(['triage']);
  });

  it('every kind starts ticked and the doc reads enabled', async () => {
    spyPendingExcept(loaded());
    renderPage(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText('unslop enabled')).toBeChecked());
    for (const kind of ['draft', 'refine_selection', 'image_plan', 'retro', 'triage', 'image_review', 'image_variate']) {
      expect(screen.getByLabelText(`unslop applies to ${kind}`)).toBeChecked();
    }
  });

  it('blocks the save while two docs share an id', async () => {
    spyPendingExcept(loaded());
    renderPage(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText('name of unslop')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '+ add doc' }));
    await userEvent.clear(screen.getByLabelText('name of doc-2'));
    await userEvent.type(screen.getByLabelText('name of doc-2'), 'unslop');

    expect(screen.getByText(/two docs share the id/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'save style docs' })).toBeDisabled();
  });

  it('blocks the save on a blank name rather than letting the server reject it', async () => {
    spyPendingExcept(loaded());
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(settings());
    renderPage(<SettingsPage />);

    await waitFor(() => expect(screen.getByLabelText('name of unslop')).toBeInTheDocument());
    await userEvent.clear(screen.getByLabelText('name of unslop'));

    expect(screen.getByText(/every doc needs a name/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'save style docs' })).toBeDisabled();
    expect(patch).not.toHaveBeenCalled();
  });
});
