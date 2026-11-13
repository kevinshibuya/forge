import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '../test/render';
import { spyPendingExcept } from '../test/pending';
import Planner from './Planner';

describe('Planner — pending', () => {
  it('shows the page header immediately with the skeleton below it, and no spinner', () => {
    spyPendingExcept();
    const { container } = renderPage(<Planner />);

    // The header is chrome: it must not wait on the stream.
    expect(screen.getByText('the planner')).toBeInTheDocument();
    expect(container.querySelector('[data-probe="skeleton-planner"]')).not.toBeNull();
    expect(container.querySelector('[data-probe="spinner"]')).toBeNull();
  });
});
