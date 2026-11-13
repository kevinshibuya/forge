import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderPage } from '../test/render';
import { spyPendingExcept } from '../test/pending';
import type { RuleDto } from '../api/client';
import Playbook from './Playbook';

const rule = (over: Partial<RuleDto> = {}): RuleDto => ({
  id: 1, category: 'voice', rule: 'a clean rule', rationale: 'because',
  provenance: 'seed', status: 'active', createdAt: '2026-09-01T10:00:00.000Z', retiredAt: null,
  ...over,
});

describe('Playbook — pending', () => {
  it('shows the rules skeleton, not a spinner, while the fetch is in flight', () => {
    spyPendingExcept();
    const { container } = renderPage(<Playbook />);

    expect(container.querySelector('[data-probe="skeleton-playbook"]')).not.toBeNull();
    expect(container.querySelector('[data-probe="spinner"]')).toBeNull();
  });
});

describe('Playbook — rule text is never marked', () => {
  it('leaves a rule that quotes an em dash unmarked', async () => {
    // A style rule names what it bans by construction, so marking it would flag the example
    // rather than a mistake. Same exemption the persona and the unslop doc have.
    spyPendingExcept({
      '/playbook/rules': [rule({
        rule: 'Never use em dashes (\u2014) in body text. Use commas instead.',
        rationale: 'em dashes read as ai-generated \u2014 not in kevin\'s voice.',
      })],
    });
    const { container } = renderPage(<Playbook />);

    await waitFor(() => expect(screen.getByText(/Never use em dashes/)).toBeInTheDocument());
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    expect(container.querySelectorAll('[data-tip]')).toHaveLength(0);
  });

  it('leaves slop in a rule unmarked too, since the run detail carries that count', async () => {
    spyPendingExcept({ '/playbook/rules': [rule({ rule: 'leverage the hook', rationale: 'a testament to reach' })] });
    const { container } = renderPage(<Playbook />);

    await waitFor(() => expect(screen.getByText('leverage the hook')).toBeInTheDocument());
    expect(container.querySelectorAll('mark')).toHaveLength(0);
  });
});
