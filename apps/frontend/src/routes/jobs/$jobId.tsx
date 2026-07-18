import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Ban,
  RotateCw,
  FileText,
  Check,
  X,
  AlertTriangle,
} from 'lucide-react';

import { useJob, useCancelJob, useRetryJob, useApproveJob, useRejectJob } from '~/hooks/use-jobs';
import { useJobUpdates } from '~/hooks/use-socket';
import { StatusBadge } from '~/components/status-badge';
import { InputGateActions } from '~/components/approval/input-gate-dialog';
import { JobLogsDialog } from '~/components/jobs/job-logs-dialog';
import { Card } from '~/components/ui/card';
import { calcDurationSec, formatDuration, relativeTime } from '~/lib/utils';

export const Route = createFileRoute('/jobs/$jobId')({
  head: () => ({
    meta: [{ title: 'Job — Andon' }],
  }),
  notFoundComponent: () => (
    <div className="p-8 font-mono text-sm text-muted-foreground">Job not found.</div>
  ),
  component: JobDetail,
});

function JobDetail() {
  const { jobId } = Route.useParams();
  const id = parseInt(jobId, 10);
  useJobUpdates();
  const { data: job, isLoading } = useJob(id);
  const cancel = useCancelJob();
  const retry = useRetryJob();
  const approve = useApproveJob();
  const reject = useRejectJob();
  const [logsOpen, setLogsOpen] = useState(false);

  if (isLoading) return <div className="p-8 font-mono text-sm text-muted-foreground">Loading...</div>;
  if (!job) return <div className="p-8 font-mono text-sm text-destructive">Job not found.</div>;

  const running = job.status === 'RUNNING';
  const failed = job.status === 'FAILED';
  const awaitingApproval = job.status === 'WAITING_APPROVAL';

  let parsedParams: Record<string, unknown> = {};
  try { parsedParams = JSON.parse(job.params); } catch {}
  const taskQueue = ((parsedParams.taskQueue ?? parsedParams.sourceTaskQueue) as string) ?? '—';

  const handleApprove = async () => {
    try { await approve.mutateAsync(id); toast.success('Approval granted'); } catch { toast.error('Failed to approve'); }
  };
  const handleReject = async () => {
    try { await reject.mutateAsync({ id }); toast.error('Approval rejected'); } catch { toast.error('Failed to reject'); }
  };
  const handleCancel = async () => {
    try { await cancel.mutateAsync(id); toast.warning('Cancellation requested'); } catch { toast.error('Failed to cancel'); }
  };
  const handleRetry = async () => {
    try { await retry.mutateAsync(id); toast.info('Retry queued'); } catch { toast.error('Failed to retry'); }
  };

  const openGateForStep = (stepName: string) =>
    job.inputRequests?.find((g) => g.status === 'OPEN' && g.step === stepName);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div>
        <Link
          to="/jobs"
          className="inline-flex items-center gap-1 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground font-mono"
        >
          <ArrowLeft className="h-3 w-3" /> back to jobs
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{job.workflowType}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground font-mono">
              <span className="text-primary">{job.workflowId}</span>
              <span>·</span>
              <span>{job.workflowType}</span>
              <span>·</span>
              <StatusBadge status={job.status} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {awaitingApproval ? (
              <>
                <button
                  onClick={handleApprove}
                  disabled={approve.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#4ade80] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#0d1f14] hover:bg-[#4ade80]/90 disabled:opacity-40 font-mono"
                >
                  <Check className="h-3.5 w-3.5" /> Approve
                </button>
                <button
                  onClick={handleReject}
                  disabled={reject.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/20 disabled:opacity-40 font-mono"
                >
                  <X className="h-3.5 w-3.5" /> Reject
                </button>
              </>
            ) : (
              <>
                {running && (
                  <button
                    onClick={handleCancel}
                    disabled={cancel.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/20 disabled:opacity-40 font-mono"
                  >
                    <Ban className="h-3.5 w-3.5" /> Cancel Job
                  </button>
                )}
                {failed && (
                  <button
                    onClick={handleRetry}
                    disabled={retry.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:bg-primary/90 disabled:opacity-40 font-mono"
                  >
                    <RotateCw className="h-3.5 w-3.5" /> Retry Failed Step
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => setLogsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-foreground hover:bg-muted/70 font-mono"
            >
              <FileText className="h-3.5 w-3.5" /> View Logs
            </button>
          </div>
        </div>
      </div>

      {job.error && (
        <Card className="flex flex-col gap-2 rounded-md border-destructive/40 bg-destructive/10 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-destructive font-mono">
            <AlertTriangle className="h-4 w-4" /> Error
          </div>
          <p className="text-xs text-foreground/90 font-mono">{job.error}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        <MetaCard label="Started By" value={job.createdBy} />
        <MetaCard label="Task Queue" value={taskQueue} />
        <MetaCard
          label="Duration"
          value={formatDuration(calcDurationSec(job.startedAt, job.finishedAt))}
          hint={job.startedAt ? relativeTime(job.startedAt) : '—'}
        />
        <MetaCard
          label="Parameters"
          value={Object.keys(parsedParams).length > 0 ? `${Object.keys(parsedParams).length} fields` : '—'}
        />
      </div>

      <Card className="flex flex-col gap-4 rounded-md border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider font-mono">
            Workflow steps
          </h2>
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
            {job.workflowType}
          </span>
        </div>
        <ol className="relative ml-3 space-y-4 border-l border-border pl-6">
          {job.steps.map((step, i) => {
            const openGate = openGateForStep(step.name);
            const stepDot =
              step.status === 'COMPLETED'
                ? 'bg-[#4ade80] border-[#4ade80]'
                : step.status === 'RUNNING'
                  ? 'bg-[#60a5fa] border-[#60a5fa] animate-pulse'
                  : step.status === 'WAITING_APPROVAL' || step.status === 'WAITING_INPUT'
                    ? 'bg-[#fbbf24] border-[#fbbf24] animate-pulse'
                    : step.status === 'FAILED'
                      ? 'bg-destructive border-destructive'
                      : 'bg-background border-border';
            return (
              <li key={step.id} className="relative">
                <span
                  className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 ${stepDot}`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="text-sm font-medium">{step.name}</span>
                  <StatusBadge status={step.status} />
                  {openGate && (step.status === 'WAITING_APPROVAL' || step.status === 'WAITING_INPUT') && (
                    <InputGateActions jobId={id} gate={openGate} />
                  )}
                  {step.startedAt && step.status !== 'PENDING' && (
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {formatDuration(calcDurationSec(step.startedAt, step.finishedAt))}
                    </span>
                  )}
                </div>
                {step.error && (
                  <div className="mt-1 rounded-sm border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive font-mono">
                    {step.error}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </Card>

      <JobLogsDialog jobId={id} open={logsOpen} onOpenChange={setLogsOpen} />
    </div>
  );
}

function MetaCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="flex flex-col gap-1 rounded-md border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
        {label}
      </div>
      <div className="text-sm font-medium text-foreground font-mono">{value}</div>
      {hint && (
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
          {hint}
        </div>
      )}
    </Card>
  );
}
