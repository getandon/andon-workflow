import { useMemo, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { PlayCircle, Search } from 'lucide-react';

import { useJobs } from '~/hooks/use-jobs';
import { useJobUpdates } from '~/hooks/use-socket';
import { StatusBadge } from '~/components/status-badge';
import { Input } from '~/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { calcDurationSec, formatDuration, relativeTime } from '~/lib/utils';
import type { Job } from '~/types';

export const Route = createFileRoute('/jobs/')({
  head: () => ({
    meta: [
      { title: 'Jobs — Andon' },
      { name: 'description', content: 'All Temporal workflow executions.' },
    ],
  }),
  component: JobsPage,
});

const STATUSES: (Job['status'] | 'ALL')[] = [
  'ALL',
  'RUNNING',
  'WAITING_APPROVAL',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMEOUT',
];

function JobsPage() {
  useJobUpdates();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('ALL');

  const statusForApi = status !== 'ALL' ? status : undefined;
  const { data: jobs, isLoading } = useJobs({ status: statusForApi });

  const filtered = useMemo(() => {
    return (jobs ?? []).filter((j) => {
      if (q) {
        const search = `${j.id} ${j.workflowType} ${j.createdBy} ${j.params}`.toLowerCase();
        if (!search.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [jobs, q]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            {filtered.length} of {jobs?.length ?? 0} workflows
          </p>
        </div>
        <Link
          to="/jobs/create"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground transition hover:bg-primary/90 font-mono"
        >
          <PlayCircle className="h-3.5 w-3.5" /> New Job
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search job id, title, user…"
            className="pl-8 text-xs font-mono"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[190px] text-xs uppercase tracking-wider font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="text-xs uppercase tracking-wider font-mono">
                {s.replace('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="font-mono text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <table className="w-full text-left">
            <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
              <tr>
                <th className="px-3 py-2 font-medium">Job ID</th>
                <th className="px-3 py-2 font-medium">Workflow</th>
                <th className="px-3 py-2 font-medium">Queue</th>
                <th className="px-3 py-2 font-medium">Started By</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Duration</th>
                <th className="px-3 py-2 text-right font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((j) => {
                let parsedParams: Record<string, unknown> = {};
                try { parsedParams = JSON.parse(j.params); } catch {}
                const taskQueue = ((parsedParams.taskQueue ?? parsedParams.sourceTaskQueue) as string) ?? '-';
                return (
                  <tr
                    key={j.id}
                    onClick={() => navigate({ to: '/jobs/$jobId', params: { jobId: String(j.id) } })}
                    className="cursor-pointer border-b border-border/50 text-xs transition last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-3 py-2">
                      <Link
                        to="/jobs/$jobId"
                        params={{ jobId: String(j.id) }}
                        className="font-mono text-primary hover:underline"
                      >
                        {j.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{j.workflowType}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{taskQueue}</td>
                    <td className="px-3 py-2 font-mono">{j.createdBy}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={j.status} />
                    </td>
                    <td className="px-3 py-2 font-mono text-right text-muted-foreground">
                      {formatDuration(calcDurationSec(j.startedAt, j.finishedAt))}
                    </td>
                    <td className="px-3 py-2 font-mono text-right text-muted-foreground">
                      {relativeTime(j.createdAt)}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs uppercase tracking-widest text-muted-foreground font-mono">
                    No jobs match these filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
