import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { api, ApiError, type RunDetailDto, type RunStepDto } from '../api/client';
import { renderWithClient } from '../test/render';
import { RunDetail, RunDetailModal } from './run-detail';

/**
 * `Metric` renders its label and value as siblings in one span (`label`, ` · `, value span), so
 * no single element holds the value alone — and `not recorded` shows up in up to three places on
 * one screen. Match the whole span, then slice the label off.
 *
 * Returns null when no Metric with that label is rendered at all, which is itself a case here.
 */
function metricValue(label: string): string | null {
  const el = screen.queryAllByText(
    (_, node) => node?.tagName === 'SPAN'
      && node.childElementCount === 1
      && (node.textContent ?? '').startsWith(`${label} · `),
  )[0];
  return el ? (el.textContent ?? '').slice(`${label} · `.length) : null;
}

const step = (over: Partial<RunStepDto> = {}): RunStepDto => ({
  seq: 1, kind: 'compose', engine: 'claude', model: 'opus-5',
  prompt: 'p', output: 'o',
  tokensInput: 10, tokensCacheWrite: null, tokensCacheRead: null, tokensOutput: 20, imagesGenerated: null,
  costUsd: null, failureKind: null,
  startedAt: '2026-08-12T10:00:00.000Z', finishedAt: '2026-08-12T10:00:30.000Z',
  ...over,
});

const run = (over: Partial<RunDetailDto> = {}): RunDetailDto => ({
  id: 7, engine: 'claude', kind: 'draft', model: 'opus-5',
  prompt: 'the prompt', output: 'the output',
  parsedOk: true, status: 'succeeded',
  failureKind: null, error: null, postId: 4, declined: null,
  tokensInput: 100, tokensCacheWrite: null, tokensCacheRead: null, tokensOutput: 200, imagesGenerated: null,
  startedAt: '2026-08-12T10:00:00.000Z', finishedAt: '2026-08-12T10:01:00.000Z',
  steps: [], costUsd: 0.01, tells: null,
  research: false, toolCalls: null, stagedManifest: null, stagedInputs: null, stagedDir: null,
  ...over,
});

describe('RunDetail — the steps metric', () => {
  it('renders no steps metric at all for an unmanaged kind with no steps', () => {
    // `steps · 0` is a fact about managed kinds and noise about the other nine.
    renderWithClient(<RunDetail run={run({ kind: 'draft', steps: [] })} />);
    expect(metricValue('steps')).toBeNull();
  });

  it('reads an empty managed succeeded run as not recorded, not as zero', () => {
    renderWithClient(<RunDetail run={run({ kind: 'image_hybrid', status: 'succeeded', steps: [] })} />);
    expect(metricValue('steps')).toBe('not recorded');
  });

  it('reads an empty managed running run as zero, because none have finished yet', () => {
    renderWithClient(<RunDetail run={run({ kind: 'image_hybrid', status: 'running', finishedAt: null, steps: [] })} />);
    expect(metricValue('steps')).toBe('0');
  });

  it('reads an empty managed aborted run as zero', () => {
    renderWithClient(<RunDetail run={run({ kind: 'image_refine', status: 'failed', steps: [] })} />);
    expect(metricValue('steps')).toBe('0');
  });

  it('counts the steps when there are any, managed or not', () => {
    renderWithClient(<RunDetail run={run({ kind: 'draft', steps: [step({ seq: 1 }), step({ seq: 2 })] })} />);
    expect(metricValue('steps')).toBe('2');
  });

  it('counts the steps of a managed run too', () => {
    renderWithClient(<RunDetail run={run({ kind: 'image_hybrid', steps: [step()] })} />);
    expect(metricValue('steps')).toBe('1');
  });
});

describe('RunDetail — the tokens metric never fabricates a split', () => {
  it('shows the reported split for a claude run', () => {
    renderWithClient(<RunDetail run={run({ engine: 'claude', tokensInput: 1200, tokensOutput: 3400 })} />);
    expect(metricValue('tokens')).toBe('1,200 in / 3,400 out');
  });

  it('shows the cached read beside input and output once the provider reports cache fields', () => {
    renderWithClient(<RunDetail run={run({ tokensInput: 1200, tokensCacheWrite: 0, tokensCacheRead: 30, tokensOutput: 340 })} />);
    expect(metricValue('tokens')).toBe('1,200 in · 30 cached · 340 out');
  });

  it('adds the cache write only when there was one', () => {
    renderWithClient(<RunDetail run={run({ tokensInput: 1200, tokensCacheWrite: 20, tokensCacheRead: 30, tokensOutput: 340 })} />);
    expect(metricValue('tokens')).toBe('1,200 in · 30 cached · +20 cache write · 340 out');
  });

  it('shows one total for codex, which reports no split to show', () => {
    // codex returns a single number that the runner parks in tokensOutput. Rendering that as
    // "0 in / N out" would invent an input count the engine never reported.
    renderWithClient(<RunDetail run={run({ engine: 'codex', tokensInput: null, tokensOutput: 4600 })} />);
    expect(metricValue('tokens')).toBe('4,600 total');
  });

  it('says not recorded when neither number was measured', () => {
    // A fabricated zero is indistinguishable from a measured one, which is the whole contract.
    renderWithClient(<RunDetail run={run({ tokensInput: null, tokensOutput: null })} />);
    expect(metricValue('tokens')).toBe('not recorded');
  });

  it('collapses to a total when a managed run mixes engines', () => {
    // The row totals are summed across steps, so a hybrid with a codex step has that engine's
    // grand total folded into tokensOutput — presenting it as an output count would fabricate a
    // split the data never had. Unreachable from the live server without staging such a run.
    renderWithClient(<RunDetail run={run({
      kind: 'image_hybrid', engine: 'claude', tokensInput: 1200, tokensOutput: 3400,
      tokensCacheWrite: 800, tokensCacheRead: 4000,
      steps: [step({ seq: 1, engine: 'claude' }), step({ seq: 2, engine: 'codex' })],
    })} />);
    // Every token the steps reported: 1,200 + 800 + 4,000 + 3,400.
    expect(metricValue('tokens')).toBe('9,400 total');
  });

  it('keeps the split when a managed run stayed on one engine', () => {
    renderWithClient(<RunDetail run={run({
      kind: 'image_hybrid', engine: 'claude', tokensInput: 1200, tokensOutput: 3400,
      steps: [step({ seq: 1, engine: 'claude' }), step({ seq: 2, engine: 'claude' })],
    })} />);
    expect(metricValue('tokens')).toBe('1,200 in / 3,400 out');
  });
});

describe('RunDetail — the error note', () => {
  it('shows an ErrorNote carrying the run error', () => {
    renderWithClient(<RunDetail run={run({ status: 'failed', error: 'engine exited 1' })} />);
    const label = screen.getByText('error');
    expect(label.parentElement?.textContent).toBe('error · engine exited 1');
  });

  it('shows no such note when the run recorded no error', () => {
    renderWithClient(<RunDetail run={run({ error: null })} />);
    expect(screen.queryByText('error')).toBeNull();
  });
});

describe('RunDetailModal', () => {
  it('surfaces a failed fetch as an ErrorNote naming the run', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'boom'));
    renderWithClient(<RunDetailModal runId={7} onClose={vi.fn()} />);

    const label = await screen.findByText('could not load run #7');
    expect(label.parentElement?.textContent).toBe('could not load run #7 · boom');
  });
});

describe('RunDetail — tell count', () => {
  it('shows the count and lists field and label in the title', () => {
    const { container } = renderWithClient(<RunDetail run={run({ tells: [
      { id: 'em-dash', label: 'em dash', start: 3, end: 4, field: 'body_linkedin' },
      { id: 'ai-vocab', label: 'AI vocabulary', start: 9, end: 14, field: 'hashtags[1]' },
    ] })} />);

    expect(metricValue('tells')).toBe('2');
    // Read the attribute directly: getByTitle normalizes the newline away.
    const titled = container.querySelector('span[title]');
    expect(titled?.getAttribute('title')).toBe('body_linkedin: em dash\nhashtags[1]: AI vocabulary');
  });

  it('omits the metric for a run that was never linted', () => {
    renderWithClient(<RunDetail run={run({ tells: null })} />);
    expect(metricValue('tells')).toBeNull();
  });

  it('omits the metric for a run that linted clean', () => {
    renderWithClient(<RunDetail run={run({ tells: [] })} />);
    expect(metricValue('tells')).toBeNull();
  });
});

describe('RunDetail — research runs', () => {
  it('marks only the read that left the staged root, and lists the snapshot', () => {
    renderWithClient(<RunDetail run={run({
      research: true,
      stagedDir: '/tmp/forge-research/k/harness',
      stagedManifest: [{ path: 'CLAUDE.md', bytes: 120 }, { path: 'agents/worker.md', bytes: 42 }],
      toolCalls: [
        { tool: 'Read', ref: '/tmp/forge-research/k/harness/agents/worker.md', ok: true },
        { tool: 'Read', ref: '/Users/someone/.claude/CLAUDE.md', ok: false, outsideRoot: true },
      ],
    })} />);

    expect(screen.getByText('research')).toBeInTheDocument();
    // Exactly one escape marker, on the row that escaped, and it carries the hue.
    const marks = screen.getAllByText('· outside root, blocked');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveClass('text-salmon');
    expect(marks[0]!.closest('li')).toHaveAttribute('title', 'read outside the staged root');
    expect(marks[0]!.closest('li')).toHaveTextContent('/Users/someone/.claude/CLAUDE.md');

    expect(screen.getByText('staged files · 2')).toBeInTheDocument();
    expect(screen.getByText('agents/worker.md')).toBeInTheDocument();
  });

  it('shows none of it for a run that never researched', () => {
    renderWithClient(<RunDetail run={run({ kind: 'draft' })} />);
    expect(screen.queryByText('research')).toBeNull();
    expect(screen.queryByText(/outside root/)).toBeNull();
    expect(screen.queryByText(/staged files/)).toBeNull();
  });
});

describe('RunDetail — a fence that failed reads differently from one that held', () => {
  it('shouts only for a read that escaped AND succeeded', () => {
    renderWithClient(<RunDetail run={run({
      research: true,
      stagedDir: '/tmp/forge-research/k/harness',
      toolCalls: [
        { tool: 'Read', ref: '/etc/hosts', ok: false, outsideRoot: true },
        { tool: 'Read', ref: '/Users/someone/.ssh/id_rsa', ok: true, outsideRoot: true },
      ],
    })} />);
    // The blocked one is the fence working; the successful one is a breach.
    expect(screen.getByText('· outside root, blocked')).toBeInTheDocument();
    expect(screen.getByText('· escaped the staged root')).toBeInTheDocument();
  });
});

describe('RunDetail — the sources the run itself returned', () => {
  const cited = [
    { kind: 'file', ref: 'harness/agents/worker.md', note: 'pinned to opus' },
    { kind: 'web', ref: 'https://nodejs.org', note: 'the current lts' },
  ];

  it('lists what a draft run cited', () => {
    renderWithClient(<RunDetail run={run({
      output: JSON.stringify({ body_linkedin: 'b', hashtags: [], sources: cited }),
    })} />);

    expect(screen.getByText('sources · 2')).toBeInTheDocument();
    expect(screen.getByText('harness/agents/worker.md')).toBeInTheDocument();
    expect(screen.getByText('https://nodejs.org')).toBeInTheDocument();
  });

  it('renders nothing when the output is prose the schema cannot read', () => {
    renderWithClient(<RunDetail run={run({ output: 'the model wrote a paragraph instead' })} />);

    expect(screen.queryByText(/^sources · /)).toBeNull();
  });});


describe('RunDetail — staged inputs', () => {
  const inputs = [
    {
      inputId: 3, kind: 'path' as const, ref: '/Users/k/keki/docs/adr', root: 'inputs/3',
      files: [{ path: '0001-a.md', bytes: 120 }, { path: 'sub/0002-b.md', bytes: 340 }],
      bytes: 460, skipped: 2, refused: ['settings.json'],
    },
    {
      inputId: 5, kind: 'url' as const, ref: 'https://example.com/a', root: 'inputs/5',
      files: [{ path: 'page.txt', bytes: 900 }],
      bytes: 900, skipped: 0, refused: [],
    },
  ];

  it('pills the count and lists every input with its files', () => {
    renderWithClient(<RunDetail run={run({ stagedInputs: inputs })} />);

    expect(screen.getByText('inputs · 2')).toBeInTheDocument();
    expect(screen.getByText('staged inputs · 2')).toBeInTheDocument();
    expect(screen.getByText('/Users/k/keki/docs/adr')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/a')).toBeInTheDocument();
    expect(screen.getByText('0001-a.md')).toBeInTheDocument();
    expect(screen.getByText('sub/0002-b.md')).toBeInTheDocument();
    expect(screen.getByText('page.txt')).toBeInTheDocument();
    expect(screen.getByText('skipped 2')).toBeInTheDocument();
    expect(screen.getByText('settings.json')).toBeInTheDocument();
  });

  it('shows neither the pill nor the section for a run that staged no inputs', () => {
    renderWithClient(<RunDetail run={run({ stagedInputs: null })} />);

    expect(screen.queryByText(/^inputs · /)).toBeNull();
    expect(screen.queryByText(/^staged inputs/)).toBeNull();
  });
});

describe('RunDetail — cost', () => {
  it('reads the cost recorded at call time', () => {
    renderWithClient(<RunDetail run={run({ costUsd: 0.0876 })} />);
    expect(metricValue('cost')).toBe('$0.0876');
    expect(metricValue('est. cost')).toBeNull();
  });

  it('says not recorded when the run carries no cost', () => {
    renderWithClient(<RunDetail run={run({ costUsd: null })} />);
    expect(metricValue('cost')).toBe('not recorded');
  });
});
