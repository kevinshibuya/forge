import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

// A fresh client per render keeps one case's cached data and one case's
// injected failure from leaking into the next. `retry: false` is load-bearing:
// with react-query's default retries an injected rejection reads as a hang
// instead of an error branch.
function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/**
 * The client is handed back so a test can drive a SECOND fetch of the same query — swap the spy
 * to reject, then `client.refetchQueries()`. That is the only way to reach the state where data
 * from a successful load is still cached while `isError` is true.
 */
export interface Rendered extends RenderResult { client: QueryClient }

export function renderWithClient(ui: ReactElement): Rendered {
  const client = freshClient();
  return { ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>), client };
}

/**
 * Pages read router context, so they need the extra MemoryRouter wrapper.
 *
 * Pass `opts` for a page that reads route params (`useParams`): it mounts `ui` under a matching
 * `Route`, so `/analytics/1` against `/analytics/:postId` resolves `postId` to `'1'`. Without
 * `opts` the behaviour is unchanged.
 */
export function renderPage(ui: ReactElement, opts?: { route: string; path: string }): Rendered {
  const client = freshClient();
  const inner = <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
  return {
    ...render(
      opts
        ? (
          <MemoryRouter initialEntries={[opts.route]}>
            <Routes><Route path={opts.path} element={inner} /></Routes>
          </MemoryRouter>
        )
        : <MemoryRouter>{inner}</MemoryRouter>,
    ),
    client,
  };
}
