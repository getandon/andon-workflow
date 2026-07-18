import { SidebarProvider, SidebarInset } from '~/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { Header } from './header';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Header />
        <main className="flex-1 overflow-auto p-6 min-h-0">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
