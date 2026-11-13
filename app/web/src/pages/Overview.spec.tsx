import { describe, it, expect } from 'vitest';
import { renderPage } from '../test/render';
import { spyPendingExcept } from '../test/pending';
import Overview from './Overview';

describe('Overview — pending', () => {
  it('shows both band skeletons, and no spinner, while the fetches are in flight', () => {
    // Two independent queries, two independently gated bands — both must be skeletons, since
    // either one resolving late must not leave the other showing a spinner.
    spyPendingExcept();
    const { container } = renderPage(<Overview />);

    expect(container.querySelector('[data-probe="skeleton-overview-hero"]')).not.toBeNull();
    expect(container.querySelector('[data-probe="skeleton-overview-lower"]')).not.toBeNull();
    expect(container.querySelector('[data-probe="spinner"]')).toBeNull();
  });
});
