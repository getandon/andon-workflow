import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Copy, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useAuditLog } from '~/hooks/use-audit';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '~/components/ui/dialog';
import { relativeTime } from '~/lib/utils';
import type { AuditLog } from '~/types';

export const Route = createFileRoute('/audit')({
  head: () => ({
    meta: [
      { title: 'Audit — Andon' },
      { name: 'description', content: 'Immutable record of who executed what, when, and where.' },
    ],
  }),
  component: AuditPage,
});

function deriveResult(action: string): 'success' | 'failure' | 'cancelled' {
  const upper = action.toUpperCase();
  if (upper.includes('FAILED') || upper.includes('ERROR') || upper.includes('REJECTED')) return 'failure';
  if (upper.includes('CANCELLED') || upper.includes('CANCEL')) return 'cancelled';
  return 'success';
}

function prettyDetails(details: string): string {
  try {
    return JSON.stringify(JSON.parse(details), null, 2);
  } catch {
    return details;
  }
}

async function copyDetails(details: string) {
  try {
    await navigator.clipboard.writeText(prettyDetails(details));
    toast.success('Details copied to clipboard');
  } catch {
    toast.error('Failed to copy details');
  }
}

function AuditPage() {
  const { data: logs, isLoading } = useAuditLog({ limit: 100 });
  const [selected, setSelected] = useState<AuditLog | null>(null);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {logs?.length ?? 0} events · immutable
        </p>
      </div>
      {isLoading ? (
        <p className="font-mono text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <table className="w-full table-fixed text-left">
            <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
              <tr>
                <th className="w-24 px-3 py-2 font-medium">When</th>
                <th className="w-16 px-3 py-2 font-medium">User</th>
                <th className="w-44 px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Details</th>
                <th className="w-40 px-3 py-2 font-medium">Workflow</th>
                <th className="w-24 px-3 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {(logs ?? []).map((a) => {
                const result = deriveResult(a.action);
                const resultTone =
                  result === 'success'
                    ? 'text-success'
                    : result === 'failure'
                      ? 'text-destructive'
                      : 'text-warning';
                return (
                  <tr key={a.id} className="border-b border-border/50 text-xs last:border-b-0 hover:bg-muted/30">
                    <td className="truncate px-3 py-2 font-mono text-muted-foreground">{relativeTime(a.createdAt)}</td>
                    <td className="truncate px-3 py-2 font-mono">API</td>
                    <td className="truncate px-3 py-2" title={a.action}>{a.action}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate" title={a.details}>
                          {a.details}
                        </span>
                        <button
                          onClick={() => copyDetails(a.details)}
                          title="Copy details JSON"
                          className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => setSelected(a)}
                          title="View details"
                          className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Eye className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="truncate px-3 py-2 font-mono">
                      {a.job ? (
                        <Link to="/jobs/$jobId" params={{ jobId: String(a.job.id) }} className="text-primary hover:underline">
                          {a.job.workflowType}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className={`truncate px-3 py-2 font-mono uppercase tracking-wider ${resultTone}`}>
                      {result}
                    </td>
                  </tr>
                );
              })}
              {logs?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
                    No audit entries
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-xl">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 pr-8">
              <DialogTitle>Audit details</DialogTitle>
              <DialogDescription>
                {selected?.action}
                {selected ? ` · ${relativeTime(selected.createdAt)}` : ''}
                {selected?.job ? ` · ${selected.job.workflowType}` : ''}
              </DialogDescription>
            </div>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-xs text-foreground/90">
              {selected ? prettyDetails(selected.details) : ''}
            </pre>
            <div className="flex justify-end">
              <button
                onClick={() => selected && copyDetails(selected.details)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground hover:bg-muted/70 font-mono"
              >
                <Copy className="h-3 w-3" /> Copy JSON
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
