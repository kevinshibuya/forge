import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  boardQuery, dashboardQuery, ideasQuery, overviewAnalyticsQuery, plannerStreamQuery,
  postsQuery, retroEligibilityQuery, rulesQuery, runsQuery, settingsQuery,
} from '../api/hooks';
import { todayIso } from '../lib/format';
import { plannerWindow } from '../lib/planner-window';
import { RunWatcherProvider } from './run-console';
import {
  AnalyticsIcon,
  BacklogIcon,
  ChevronIcon,
  LogoMark,
  MoonIcon,
  OverviewIcon,
  PlannerIcon,
  PlaybookIcon,
  PostsIcon,
  RunsIcon,
  SettingsIcon,
  SunIcon,
  type IconProps,
} from './icons';

type NavItem = { to: string; label: string; Icon: (props: IconProps) => ReactElement };

const NAV: NavItem[] = [
  { to: '/', label: 'overview', Icon: OverviewIcon },
  { to: '/backlog', label: 'backlog', Icon: BacklogIcon },
  { to: '/planner', label: 'planner', Icon: PlannerIcon },
  { to: '/posts', label: 'posts', Icon: PostsIcon },
  { to: '/analytics', label: 'analytics', Icon: AnalyticsIcon },
  { to: '/playbook', label: 'playbook', Icon: PlaybookIcon },
  { to: '/runs', label: 'runs', Icon: RunsIcon },
  { to: '/settings', label: 'settings', Icon: SettingsIcon },
];

/**
 * The queries a nav target needs on ITS DEFAULT STATE — the exact keys each page builds on first
 * render, so a warmed entry is the one the page reads. Verified against the pages at execution
 * time: Overview window 28, Analytics range '28', Backlog 'new,triaged', Playbook retro runs,
 * RunsLog kind 'all' (no param).
 *
 * `prefetchQuery` is a no-op while an entry is fresh, so hovering after the idle warm-up costs
 * nothing and StrictMode's double effect deduplicates the same way.
 *
 * Each route prefetches through its OWN calls rather than handing back an array of options.
 * A shared element type would have to widen the options, and `staleTime` may be a function of
 * the query — which makes the options type contravariant in its data and key, so no widened type
 * accepts every factory's concrete one. Calling `prefetchQuery` per factory keeps each call
 * concretely typed and needs no cast.
 */
const PREFETCH: Record<string, (qc: QueryClient) => void> = {
  '/': (qc) => {
    void qc.prefetchQuery(overviewAnalyticsQuery(28));
    void qc.prefetchQuery(dashboardQuery());
  },
  '/backlog': (qc) => void qc.prefetchQuery(ideasQuery('new,triaged')),
  '/planner': (qc) => void qc.prefetchQuery(plannerStreamQuery(plannerWindow(todayIso()))),
  '/posts': (qc) => void qc.prefetchQuery(postsQuery()),
  '/analytics': (qc) => void qc.prefetchQuery(boardQuery('28')),
  '/playbook': (qc) => {
    void qc.prefetchQuery(rulesQuery());
    void qc.prefetchQuery(retroEligibilityQuery());
    void qc.prefetchQuery(runsQuery('retro'));
  },
  '/runs': (qc) => void qc.prefetchQuery(runsQuery()),
  '/settings': (qc) => void qc.prefetchQuery(settingsQuery()),
};

const THEME_KEY = 'forge:theme';
const SIDEBAR_KEY = 'forge:sidebar';

type Theme = 'light' | 'dark';

/** Stored preference, or `null` when the user has never chosen (= follow the system). */
function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'dark' || t === 'light' ? t : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Read synchronously at first render — the pre-paint script in index.html already
 *  applied `data-theme`, so this only mirrors it into React state. */
function initialTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

/** Read synchronously at first render so the rail never paints wide then snaps. */
function initialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  // While no explicit preference is stored the CSS follows `prefers-color-scheme`;
  // keep the glyph honest if the OS flips underneath us.
  useEffect(() => {
    if (storedTheme() !== null) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setTheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* private mode — the toggle still applies for this session */
      }
      return next;
    });
  }, []);

  const label = theme === 'dark' ? 'switch to light theme' : 'switch to dark theme';
  return (
    <button
      type="button"
      data-probe="theme-toggle"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline-soft text-soft transition-colors hover:border-hairline hover:text-ink"
    >
      {theme === 'dark' ? <SunIcon className="size-[18px]" /> : <MoonIcon className="size-[18px]" />}
    </button>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        if (next) localStorage.setItem(SIDEBAR_KEY, 'collapsed');
        else localStorage.removeItem(SIDEBAR_KEY);
      } catch {
        /* private mode — collapse still applies for this session */
      }
      return next;
    });
  }, []);

  const collapseLabel = collapsed ? 'expand sidebar' : 'collapse sidebar';

  const qc = useQueryClient();
  const warm = useCallback(
    (to: string) => {
      PREFETCH[to]?.(qc);
    },
    [qc],
  );

  // One idle warm-up after the shell mounts, so the FIRST navigation of a session is warm too —
  // hover prefetch alone only helps the second visit. requestIdleCallback is feature-detected:
  // Safari shipped it late enough that a bare call would throw.
  useEffect(() => {
    const run = () => Object.keys(PREFETCH).forEach(warm);
    // `typeof …`, not `'requestIdleCallback' in window`: the lib types declare it unconditionally,
    // so an `in` check narrows the else branch to `never` and window.setTimeout stops resolving.
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run);
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(run, 1_000);
    return () => window.clearTimeout(id);
  }, [warm]);

  return (
    <RunWatcherProvider>
      <div className="flex min-h-screen bg-bone">
        {/* The rail animates its own width; `overflow-hidden` is what makes that read as a wipe
            rather than a squeeze — the labels keep their natural width and are clipped by the
            rail as it narrows, instead of reflowing on every frame of the transition. */}
        <aside
          className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden border-r border-hairline py-6 transition-[width,padding] duration-[var(--dur-standard)] ease-standard ${
            collapsed ? 'w-[72px] items-center px-3' : 'w-[230px] px-5'
          }`}
        >
          <div className={`mb-9 flex items-center ${collapsed ? 'justify-center' : 'gap-2.5 px-2'}`}>
            <LogoMark className="size-7 shrink-0 text-ink" />
            {!collapsed && (
              <span className="text-[19px] font-bold lowercase tracking-[-0.035em] text-ink">forge</span>
            )}
          </div>

          <nav className={`flex flex-col gap-1 ${collapsed ? 'w-full items-center' : ''}`}>
            {NAV.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                title={collapsed ? label : undefined}
                onPointerEnter={() => warm(to)}
                onFocus={() => warm(to)}
                className={({ isActive }) =>
                  `flex items-center rounded-full text-[14px] lowercase transition-colors ${
                    collapsed ? 'size-11 justify-center' : 'gap-3 px-3 py-2.5'
                  } ${isActive ? 'bg-paper font-medium text-ink' : 'text-soft hover:text-ink'}`
                }
              >
                <Icon className="size-5 shrink-0" />
                {/* Clipped, never ellipsised: mid-transition the rail is narrower than the label,
                    and `truncate` would flash an ellipsis on the way open. */}
                {!collapsed && <span className="overflow-hidden whitespace-nowrap">{label}</span>}
              </NavLink>
            ))}
          </nav>

          <div
            className={`mt-auto flex w-full items-center gap-2 border-t border-hairline-soft pt-5 ${
              collapsed ? 'flex-col' : 'justify-between px-1'
            }`}
          >
            <ThemeToggle />
            <button
              type="button"
              data-probe="sidebar-collapse"
              onClick={toggleCollapsed}
              title={collapseLabel}
              aria-label={collapseLabel}
              aria-expanded={!collapsed}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline-soft text-soft transition-colors hover:border-hairline hover:text-ink"
            >
              {/* Same duration and curve as the rail: the chevron is the rail's own state, so the
                  two must land together — a faster flip would read as a second, unrelated event. */}
              <ChevronIcon
                className={`size-[18px] transition-transform duration-[var(--dur-standard)] ease-standard ${
                  collapsed ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-bone px-10 py-10">
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>
    </RunWatcherProvider>
  );
}
