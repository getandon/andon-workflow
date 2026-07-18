import { createRootRoute, Outlet, redirect } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { AppShell } from '../components/layout/app-shell';
import { useAuthStore } from '../stores/auth-store';

const publicRoutes = ['/login'];

export const Route = createRootRoute({
  beforeLoad: ({ location }) => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated && !publicRoutes.includes(location.pathname)) {
      throw redirect({ to: '/login' });
    }
  },
  component: RootComponent,
});

function RootComponent() {
  return (
    <AppShell>
      <Outlet />
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: 'font-mono text-xs',
          style: { background: '#12131a', color: '#f2f2f5', border: '1px solid #2a2d3a' },
        }}
      />
    </AppShell>
  );
}
