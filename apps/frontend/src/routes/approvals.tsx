import { createFileRoute, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { AlertTriangle, Check, X } from 'lucide-react';

import { useJobs, useApproveJob, useRejectJob } from '~/hooks/use-jobs';
import { useJobUpdates } from '~/hooks/use-socket';
import { Card } from '~/components/ui/card';
import { relativeTime } from '~/lib/utils';

export const Route = createFileRoute('/approvals')({
  head: () => ({
    meta: [
      { title: 'Approvals — Andon' },
      { name: 'description', content: 'Review and approve sensitive workflow operations.' },
    ],
  }),
  component: Approvals,
});

function Approvals() {
  useJobUpdates();
  const { data: jobs, isLoading } = useJobs({ status: 'WAITING_APPROVAL' });
  const approve = useApproveJob();
  const reject = useRejectJob();
  const pending = jobs ?? [];

  const handleApprove = async (id: number) => {
    try {
      await approve.mutateAsync(id);
      toast.success(`Approved job ${id}`);
    } catch {
      toast.error('Failed to approve');
    }
  };

  const handleReject = async (id: number) => {
    try {
      await reject.mutateAsync({ id });
      toast.error(`Rejected job ${id}`);
    } catch {
      toast.error('Failed to reject');
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {pending.length} pending · sensitive production operations
        </p>
      </div>

      {isLoading ? (
        <p className="font-mono text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((j) => (
            <Card key={j.id} className="flex flex-col gap-3 rounded-md border-warning/40 bg-warning/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-warning font-mono">
                    <AlertTriangle className="h-3.5 w-3.5" /> pending approval
                  </div>
                  <Link
                    to="/jobs/$jobId"
                    params={{ jobId: String(j.id) }}
                    className="mt-1 block text-lg font-semibold text-foreground hover:underline"
                  >
                    {j.workflowType}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground font-mono">
                    <span>Requested by <span className="text-foreground">{j.createdBy}</span></span>
                    <span>·</span>
                    <span>{relativeTime(j.createdAt)}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(j.id)}
                    disabled={approve.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#4ade80] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#0d1f14] hover:bg-[#4ade80]/90 disabled:opacity-40 font-mono"
                  >
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                  <button
                    onClick={() => handleReject(j.id)}
                    disabled={reject.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/20 disabled:opacity-40 font-mono"
                  >
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                </div>
              </div>
            </Card>
          ))}
          {pending.length === 0 && (
            <Card className="rounded-md border-border bg-card p-8 text-center">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                No operations awaiting approval
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
