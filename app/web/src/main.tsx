import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { MotionConfig } from 'motion/react';
import './index.css';
import { AppShell } from './ui/shell';
import Analytics from './pages/Analytics';
import Backlog from './pages/Backlog';
import Overview from './pages/Overview';
import Planner from './pages/Planner';
import PostAnalytics from './pages/PostAnalytics';
import Playbook from './pages/Playbook';
import PostsIndex from './pages/PostsIndex';
import RunsLog from './pages/RunsLog';
import SettingsPage from './pages/SettingsPage';
import Workspace from './pages/Workspace';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'backlog', element: <Backlog /> },
      { path: 'planner', element: <Planner /> },
      { path: 'posts', element: <PostsIndex /> },
      { path: 'posts/:id', element: <Workspace /> },
      { path: 'analytics', element: <Analytics /> },
      { path: 'analytics/:postId', element: <PostAnalytics /> },
      { path: 'playbook', element: <Playbook /> },
      { path: 'runs', element: <RunsLog /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);

const queryClient = new QueryClient({
  // gcTime 30min: cached pages survive a session's worth of navigation, so a
  // return trip paints from cache instead of re-showing a skeleton (ADR 0014).
  defaultOptions: {
    queries: { staleTime: 5_000, gcTime: 30 * 60_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
