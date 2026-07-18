import { useState, useEffect } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Card } from '~/components/ui/card';
import { useWorkers } from '~/hooks/use-workers';
import { useWorkerUpdates } from '~/hooks/use-worker-socket';

export const Route = createFileRoute('/workers')({
  head: () => ({
    meta: [
      { title: 'Workers — Andon' },
      { name: 'description', content: 'Worker health and task-queue coverage.' },
    ],
  }),
  component: WorkersPage,
});

function WorkersPage() {
  useWorkerUpdates();
  const { data: workers, isLoading } = useWorkers();

  const [liveHeartbeats, setLiveHeartbeats] = useState<Record<number, number | null>>({});

  useEffect(() => {
    if (!workers) return;
    const initial: Record<number, number | null> = {};
    for (const w of workers) initial[w.id] = w.lastHeartbeatSec;
    setLiveHeartbeats(initial);

    const interval = setInterval(() => {
      setLiveHeartbeats((prev) => {
        const next: Record<number, number | null> = {};
        for (const [id, sec] of Object.entries(prev)) {
          next[Number(id)] = sec !== null ? sec + 1 : null;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [workers]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workers</h1>
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {workers?.length ?? 0} registered · realtime heartbeat
        </p>
      </div>
      {isLoading ? (
        <p className="font-mono text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {workers?.map((w) => {
            const heartbeatSec = liveHeartbeats[w.id] ?? w.lastHeartbeatSec;
            const dotColor =
              w.status === 'ONLINE'
                ? 'bg-success'
                : w.status === 'DEGRADED'
                  ? 'bg-warning'
                  : 'bg-destructive';
            const borderColor =
              w.status === 'ONLINE'
                ? 'border-l-success'
                : w.status === 'DEGRADED'
                  ? 'border-l-warning'
                  : 'border-l-destructive';
            const badgeTone =
              w.status === 'ONLINE'
                ? 'text-success bg-success/15 border-success/30'
                : w.status === 'DEGRADED'
                  ? 'text-warning bg-warning/15 border-warning/30'
                  : 'text-destructive bg-destructive/15 border-destructive/30';
            return (
              <Card key={w.id} className={`flex flex-col gap-3 rounded-md border-border bg-card p-4 border-l-4 ${borderColor}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                      <h3 className="font-mono text-sm font-semibold">{w.name}</h3>
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {w.environment} · {w.taskQueue}
                    </div>
                  </div>
                  <span
                    className={`font-mono rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${badgeTone}`}
                  >
                    {w.status}
                  </span>
                </div>
                <div className="font-mono flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Last heartbeat</span>
                  <span className={heartbeatSec != null && heartbeatSec > 60 ? 'text-warning' : 'text-foreground'}>
                    {heartbeatSec != null ? `${heartbeatSec}s ago` : 'never'}
                  </span>
                </div>
                <div>
                  <div className="font-mono mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                    Activities
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {w.activities.map((a) => (
                      <span
                        key={a}
                        className="font-mono rounded-sm border border-border bg-background/60 px-1.5 py-0.5 text-[10px] text-foreground/80"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
