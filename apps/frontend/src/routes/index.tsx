import { useMemo } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  Activity,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  ArrowUpRight,
  Gauge,
  Timer,
} from 'lucide-react';

import { useJobs } from '~/hooks/use-jobs';
import { useJobUpdates } from '~/hooks/use-socket';
import { useWorkers } from '~/hooks/use-workers';
import { StatusBadge } from '~/components/status-badge';
import { Card } from '~/components/ui/card';
import { relativeTime, formatDuration, calcDurationSec } from '~/lib/utils';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

function Metric({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'info';
}) {
  const toneMap = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
    info: 'text-info',
  };
  return (
    <Card className="flex flex-col gap-2 rounded-md border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <Icon className={`h-4 w-4 ${toneMap[tone]}`} />
      </div>
      <div className={`font-mono text-3xl font-semibold ${toneMap[tone]}`}>{value}</div>
      {hint && (
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {hint}
        </div>
      )}
    </Card>
  );
}

function Dashboard() {
  useJobUpdates();
  const { data: jobs, isLoading: jobsLoading } = useJobs({ limit: '100' });

  const stats = useMemo(() => {
    if (!jobs) return null;
    const now = new Date();
    const todayStr = now.toDateString();
    const last24h = now.getTime() - 86_400_000;

    const running = jobs.filter((j) => j.status === 'RUNNING').length;
    const waiting = jobs.filter((j) => j.status === 'WAITING_APPROVAL').length;

    const todayJobs = jobs.filter((j) => new Date(j.createdAt).toDateString() === todayStr);
    const successfulToday = todayJobs.filter((j) => j.status === 'COMPLETED').length;
    const failedToday = todayJobs.filter((j) => j.status === 'FAILED').length;

    const recent = jobs.filter((j) => new Date(j.createdAt).getTime() > last24h);
    const completed24h = recent.filter((j) => j.status === 'COMPLETED').length;
    const failed24h = recent.filter((j) => j.status === 'FAILED').length;
    const total24h = completed24h + failed24h;
    const successRate = total24h > 0 ? Math.round((completed24h / total24h) * 100) : 100;

    const completedWithDuration = recent
      .filter((j) => j.status === 'COMPLETED' && j.startedAt && j.finishedAt)
      .map((j) => calcDurationSec(j.startedAt, j.finishedAt)!);
    const avgDur =
      completedWithDuration.length > 0
        ? completedWithDuration.reduce((a, b) => a + b, 0) / completedWithDuration.length / 60
        : 0;

    return { running, successfulToday, failedToday, waiting, successRate, avgDurationMin: Math.round(avgDur * 10) / 10 };
  }, [jobs]);

  const recentJobs = useMemo(() => {
    if (!jobs) return [];
    return [...jobs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);
  }, [jobs]);

  const { data: workerList } = useWorkers();

  const loading = jobsLoading;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            operational overview · live
          </p>
        </div>
        <Link
          to="/jobs/create"
          className="font-mono inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground transition hover:bg-primary/90"
        >
          Start Job <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading ? (
        <div className="font-mono text-sm text-muted-foreground">Loading...</div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <Metric label="Running" value={stats.running} icon={Activity} tone="info" hint="workflows" />
            <Metric label="Successful today" value={stats.successfulToday} icon={CheckCircle2} tone="success" />
            <Metric label="Failed today" value={stats.failedToday} icon={XCircle} tone="destructive" />
            <Metric label="Waiting approval" value={stats.waiting} icon={ShieldAlert} tone="warning" />
            <Metric label="Success rate" value={`${stats.successRate}%`} icon={Gauge} tone="success" hint="last 24h" />
            <Metric label="Avg duration" value={stats.avgDurationMin > 0 ? `${stats.avgDurationMin}m` : '—'} icon={Timer} hint="last 24h" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="col-span-2 flex flex-col gap-3 rounded-md border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm font-semibold uppercase tracking-wider">
                  Recent activity
                </h3>
                <Link
                  to="/jobs"
                  className="font-mono text-[11px] uppercase tracking-widest text-primary hover:underline"
                >
                  view all →
                </Link>
              </div>
              {recentJobs.length === 0 ? (
                <p className="font-mono text-xs text-muted-foreground">No jobs yet</p>
              ) : (
                <div className="divide-y divide-border">
                  {recentJobs.map((j) => (
                    <Link
                      key={j.id}
                      to="/jobs/$jobId"
                      params={{ jobId: String(j.id) }}
                      className="font-mono flex items-center gap-3 py-2 text-xs transition hover:bg-muted/40"
                    >
                      <StatusBadge status={j.status} />
                      <span className="min-w-0 flex-1 truncate font-medium normal-case tracking-normal text-foreground">
                        {j.workflowType}
                      </span>
                      <span className="hidden text-muted-foreground md:inline">{j.createdBy}</span>
                      <span className="w-16 text-right text-muted-foreground">
                        {formatDuration(calcDurationSec(j.startedAt, j.finishedAt))}
                      </span>
                      <span className="w-20 text-right text-muted-foreground">
                        {relativeTime(j.createdAt)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card className="flex flex-col gap-3 rounded-md border-border bg-card p-4">
              <h3 className="font-mono text-sm font-semibold uppercase tracking-wider">Workers</h3>
              <div className="flex flex-col gap-2">
                {(workerList ?? []).map((w) => {
                  const dot =
                    w.status === 'ONLINE'
                      ? 'bg-success'
                      : w.status === 'DEGRADED'
                        ? 'bg-warning'
                        : 'bg-destructive';
                  return (
                    <div
                      key={w.id}
                      className="font-mono flex items-center justify-between rounded-sm border border-border bg-background/40 px-2 py-1.5 text-[11px]"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                        <span className="truncate">{w.name}</span>
                      </div>
                      <span className="text-muted-foreground">{w.lastHeartbeatSec ?? '—'}s</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </>
      ) : (
        <p className="font-mono text-sm text-muted-foreground">No data available</p>
      )}
    </div>
  );
}
