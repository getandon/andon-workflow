import { useEffect, useRef } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '~/components/ui/dialog';
import { useJobLogs } from '~/hooks/use-jobs';
import type { JobLogEntry } from '~/types';

const LEVEL_DOT: Record<JobLogEntry['level'], string> = {
  SUCCESS: 'bg-[#4ade80]',
  INFO: 'bg-[#60a5fa]',
  WARN: 'bg-[#fbbf24]',
  ERROR: 'bg-destructive',
};

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false });
}

function toPlainText(entries: JobLogEntry[]): string {
  return entries
    .map((e) => {
      const step = e.step ? ` [${e.step}]` : '';
      return `${new Date(e.ts).toISOString()} [${e.level}]${step} ${e.message} (${e.source})`;
    })
    .join('\n');
}

export function JobLogsDialog({
  jobId,
  open,
  onOpenChange,
}: {
  jobId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: entries, isLoading } = useJobLogs(jobId, open);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const count = entries?.length ?? 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [count, open]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(toPlainText(entries ?? []));
      toast.success('Log copied to clipboard');
    } catch {
      toast.error('Failed to copy log');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] max-w-3xl flex-col gap-3">
        <div className="flex items-center justify-between pr-8">
          <div className="flex flex-col gap-0.5">
            <DialogTitle>Job log</DialogTitle>
            <DialogDescription>
              {count} {count === 1 ? 'entry' : 'entries'} · live
            </DialogDescription>
          </div>
          <button
            onClick={handleCopy}
            disabled={count === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground hover:bg-muted/70 disabled:opacity-40 font-mono"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto rounded-md border border-border bg-background"
        >
          {isLoading ? (
            <p className="p-4 font-mono text-xs text-muted-foreground">Loading...</p>
          ) : count === 0 ? (
            <p className="p-4 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
              No log entries for this job
            </p>
          ) : (
            <table className="w-full table-fixed text-left">
              <thead className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
                <tr>
                  <th className="sticky top-0 z-10 w-20 border-b border-border bg-background px-3 py-2 font-medium">
                    Time
                  </th>
                  <th className="sticky top-0 z-10 w-10 border-b border-border bg-background px-2 py-2 font-medium">
                    Lvl
                  </th>
                  <th className="sticky top-0 z-10 w-36 border-b border-border bg-background px-3 py-2 font-medium">
                    Step
                  </th>
                  <th className="sticky top-0 z-10 border-b border-border bg-background px-3 py-2 font-medium">
                    Message
                  </th>
                  <th className="sticky top-0 z-10 w-32 border-b border-border bg-background px-3 py-2 font-medium">
                    Executor
                  </th>
                </tr>
              </thead>
              <tbody>
                {(entries ?? []).map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-border/40 align-top font-mono text-xs last:border-b-0"
                  >
                    <td className="px-3 py-1.5 text-muted-foreground">{formatTime(entry.ts)}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`mt-1 block h-2 w-2 rounded-full ${LEVEL_DOT[entry.level] ?? LEVEL_DOT.INFO}`}
                        title={entry.level}
                      />
                    </td>
                    <td className="truncate px-3 py-1.5 text-muted-foreground" title={entry.step ?? undefined}>
                      {entry.step ?? '—'}
                    </td>
                    <td
                      className={`whitespace-pre-wrap break-words px-3 py-1.5 ${
                        entry.level === 'ERROR' ? 'text-destructive' : 'text-foreground/90'
                      }`}
                    >
                      {entry.message}
                    </td>
                    <td className="truncate px-3 py-1.5 text-muted-foreground" title={entry.source}>
                      {entry.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
