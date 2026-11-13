import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsSchema } from './settings';
import { RunKindSchema } from './runs';
import { DraftOutputSchema, RefineSelectionOutputSchema, SourceSchema } from './outputs';
import { AssetOriginSchema } from './images';
import {
  INPUT_CAPS, INPUT_JSON_LIMIT, INPUT_TEXT_EXTENSIONS, URL_FETCH,
} from './inputs';

describe('contracts', () => {
  it('default settings validate', () => {
    expect(() => SettingsSchema.parse(DEFAULT_SETTINGS)).not.toThrow();
    expect(DEFAULT_SETTINGS.embeddingModel).toBe('text-embedding-3-small');
  });

  it('image_variate, refine_selection and image_refine are run kinds', () => {
    expect(RunKindSchema.parse('image_variate')).toBe('image_variate');
    expect(RunKindSchema.options).toContain('refine_selection');
    expect(RunKindSchema.options).toContain('image_refine');
  });

  it('asset origin + refine-selection output contracts exist', () => {
    expect(AssetOriginSchema.options).toEqual(['generated', 'bg_refined', 'canvas_edited']);
    expect(RefineSelectionOutputSchema.parse({ body_linkedin: 'x' }).body_linkedin).toBe('x');
    expect(() => RefineSelectionOutputSchema.parse({})).toThrow();
  });

  it('draft output needs only body + hashtags; hooks are gone', () => {
    const good = { body_linkedin: 'b', hashtags: ['#x'] };
    expect(DraftOutputSchema.safeParse(good).success).toBe(true);
    const withConcept = { body_linkedin: 'b', hashtags: [], image_concept: 'gate vs drift' };
    expect(DraftOutputSchema.safeParse(withConcept).success).toBe(true);
    expect('hooks' in DraftOutputSchema.shape).toBe(false);
  });
});

describe('source contracts', () => {
  it('a draft output parses with sources and without them', () => {
    const withSources = {
      body_linkedin: 'b',
      hashtags: ['#x'],
      sources: [
        { kind: 'file', ref: 'harness/agents/worker.md', note: 'the worker agent is pinned to opus' },
        { kind: 'web', ref: 'https://nodejs.org/en/blog/release/v24.20.0', note: 'current LTS version' },
      ],
    };
    expect(DraftOutputSchema.safeParse(withSources).success).toBe(true);
    expect(DraftOutputSchema.safeParse({ body_linkedin: 'b', hashtags: [] }).success).toBe(true);
    expect(RefineSelectionOutputSchema.safeParse({ body_linkedin: 'b', sources: [] }).success).toBe(true);
    expect(RefineSelectionOutputSchema.safeParse({ body_linkedin: 'b' }).success).toBe(true);
  });

  it('a source needs a kind of file or web, a non-empty ref, and a note', () => {
    expect(SourceSchema.safeParse({ kind: 'file', ref: 'a.md', note: '' }).success).toBe(true);
    expect(SourceSchema.safeParse({ kind: 'shell', ref: 'a.md', note: 'x' }).success).toBe(false);
    expect(SourceSchema.safeParse({ kind: 'file', ref: '', note: 'x' }).success).toBe(false);
    expect(SourceSchema.safeParse({ kind: 'file', ref: 'a.md' }).success).toBe(false);
  });
});

describe('input contracts', () => {
  it('pins the input caps, which the api enforces and the web prints', () => {
    expect(INPUT_CAPS).toEqual({ files: 200, bytes: 5 * 1024 * 1024 });
  });

  it('gives a url fetch a bounded wait, so a slow page fails the preview and not the request', () => {
    expect(URL_FETCH.timeoutMs).toBe(15_000);
    expect(URL_FETCH.maxBytes).toBe(INPUT_CAPS.bytes);
    expect(URL_FETCH.maxRedirects).toBe(5);
  });

  it('leaves the json parser room for the worst escaping a real paste can carry', () => {
    expect(INPUT_JSON_LIMIT).toBe('12mb');
    // More than twice the cap: a text of quotes or newlines alone doubles under JSON encoding, and
    // a paste under the cap must always reach the producer to be judged by sentence.
    expect(12 * 1024 * 1024).toBeGreaterThan(2 * INPUT_CAPS.bytes);
  });

  it('keeps the text-like allowlist to what a model can read as prose or code', () => {
    for (const ext of ['md', 'txt', 'json', 'yaml', 'ts', 'tsx', 'py', 'sql', 'conf']) {
      expect(INPUT_TEXT_EXTENSIONS).toContain(ext);
    }
    for (const ext of ['pdf', 'png', 'env', 'pem', 'key']) {
      expect(INPUT_TEXT_EXTENSIONS).not.toContain(ext);
    }
  });
});
