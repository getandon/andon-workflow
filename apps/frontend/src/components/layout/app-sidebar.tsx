import { Link, useRouterState } from '@tanstack/react-router';
import {
  Activity,
  ListChecks,
  PlayCircle,
  ShieldCheck,
  Cpu,
  ScrollText,
  Terminal,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '~/components/ui/sidebar';
import { useWorkers } from '~/hooks/use-workers';

const nav = [
  { title: 'Dashboard', url: '/', icon: Activity },
  { title: 'Jobs', url: '/jobs', icon: ListChecks, match: '/jobs' as const },
  { title: 'New Job', url: '/jobs/create', icon: PlayCircle },
  { title: 'Approvals', url: '/approvals', icon: ShieldCheck },
];

const platform = [
  { title: 'Workers', url: '/workers', icon: Cpu },
  { title: 'Audit Log', url: '/audit', icon: ScrollText },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { data: workers } = useWorkers();
  const totalWorkers = workers?.length ?? 0;
  const onlineWorkers = workers?.filter((w) => w.status === 'ONLINE').length ?? 0;
  const allOnline = totalWorkers > 0 && onlineWorkers === totalWorkers;
  const anyDegraded = workers?.some((w) => w.status === 'DEGRADED') ?? false;
  const anyOffline = workers?.some((w) => w.status === 'OFFLINE') ?? false;
  const dotColor = totalWorkers === 0 ? 'bg-muted' : allOnline ? 'bg-success' : anyDegraded ? 'bg-warning' : 'bg-destructive';
  const statusText = totalWorkers === 0
    ? 'no workers'
    : allOnline
      ? `${onlineWorkers}/${totalWorkers} online`
      : anyDegraded && anyOffline
        ? `${onlineWorkers} online · degraded · offline`
        : anyDegraded
          ? `${onlineWorkers} online · degraded`
          : `${onlineWorkers} online · offline`;

  const isActive = (url: string, match?: string) => {
    if (url === '/') return pathname === '/';
    if (match) return pathname === match || pathname.startsWith(match + '/');
    return pathname === url;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/" className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <Terminal className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[13px] font-semibold tracking-wide" style={{ fontFamily: 'var(--font-mono)' }}>
              ANDON
            </span>
            <span
              className="text-[10px] uppercase tracking-widest text-muted-foreground"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              ops console
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel
            className="text-[10px] uppercase tracking-widest"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            Operations
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url, item.match)}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel
            className="text-[10px] uppercase tracking-widest"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            Platform
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {platform.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div
          className="flex items-center gap-2 px-2 py-2 text-[10px] uppercase tracking-widest text-muted-foreground"
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
          {statusText}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
