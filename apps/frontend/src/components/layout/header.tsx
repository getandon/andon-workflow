import { useAuthStore } from '~/stores/auth-store';
import { Button } from '~/components/ui';
import { SidebarTrigger } from '~/components/ui/sidebar';

export function Header() {
  const { apiKey, clearKey } = useAuthStore();

  return (
    <header className="flex h-12 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <div className="flex-1" />
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">API: {apiKey ? '••••' : 'none'}</span>
        {apiKey && (
          <Button variant="outline" size="sm" onClick={clearKey}>
            Logout
          </Button>
        )}
      </div>
    </header>
  );
}
