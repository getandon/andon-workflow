import { useState, useEffect, type ReactNode } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Trash2, ShieldCheck, ShieldAlert, FileKey } from 'lucide-react';
import { Card } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from '~/components/ui/dialog';
import { useWorkers, useDeleteWorker, type ApiWorker } from '~/hooks/use-workers';
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
  const deleteWorker = useDeleteWorker();

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
                {w.tlsEnabled && (
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <div className="flex items-center gap-1.5">
                      {w.temporalTls && w.apiTls ? (
                        <ShieldCheck className="h-3 w-3 text-success" />
                      ) : (
                        <ShieldAlert className="h-3 w-3 text-warning" />
                      )}
                      <span className="text-muted-foreground">TLS</span>
                      {w.certNotAfter && (
                        <CertExpiry date={w.certNotAfter} />
                      )}
                    </div>
                    <CertDetailsDialog worker={w} />
                  </div>
                )}
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
                    {w.activities.map((a) => {
                      const name = typeof a === 'string' ? a : a.name;
                      const label = typeof a === 'string' ? a : a.label;
                      return (
                        <span
                          key={name}
                          className="font-mono rounded-sm border border-border bg-background/60 px-1.5 py-0.5 text-[10px] text-foreground/80"
                        >
                          {label}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="flex justify-end">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogTitle>Delete worker</DialogTitle>
                      <DialogDescription>
                        Are you sure you want to delete <span className="font-semibold text-foreground">{w.name}</span>? This cannot be undone.
                      </DialogDescription>
                      <div className="mt-4 flex justify-end gap-2">
                        <DialogClose asChild>
                          <Button variant="outline" size="sm">Cancel</Button>
                        </DialogClose>
                        <DialogClose asChild>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={deleteWorker.isPending}
                            onClick={() => deleteWorker.mutate(w.id)}
                          >
                            {deleteWorker.isPending ? 'Deleting…' : 'Delete'}
                          </Button>
                        </DialogClose>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CertExpiry({ date }: { date: string }) {
  const ms = new Date(date).getTime() - Date.now();
  const days = Math.ceil(ms / 86_400_000);
  const isExpiring = days < 30;
  const isExpired = days < 0;

  let label: string;
  if (isExpired) label = `Expired ${Math.abs(days)}d ago`;
  else if (days > 365) label = `${Math.floor(days / 365)}y`;
  else if (days > 30) label = `${Math.floor(days / 30)}mo`;
  else label = `${days}d`;

  return (
    <span className={isExpired ? 'text-destructive' : isExpiring ? 'text-warning' : 'text-muted-foreground'}>
      {label}
    </span>
  );
}

function CertDetailsDialog({ worker }: { worker: ApiWorker }) {
  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '—';

  const bothTls = worker.temporalTls && worker.apiTls;
  const partialTls = worker.temporalTls !== worker.apiTls;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
          <FileKey className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Certificate Details</DialogTitle>
        <DialogDescription>{worker.name}</DialogDescription>
        <div className="mt-3 flex flex-col gap-3 font-mono text-[11px]">
          <Section label="Connections">
            <Row label="Temporal" value={worker.temporalTls ? 'mTLS (client cert)' : 'plain (in-cluster)'} />
            <Row label="API" value={worker.apiTls ? 'mTLS (client cert)' : 'plain (in-cluster)'} />
            <Row
              label="Status"
              value={bothTls ? 'Fully secured' : partialTls ? 'Partially secured' : 'No TLS'}
              valueClass={bothTls ? 'text-success' : partialTls ? 'text-warning' : 'text-muted-foreground'}
            />
          </Section>

          {worker.certSubject && (
            <Section label="Client Certificate">
              <Row label="Subject" value={worker.certSubject} />
              <Row label="Issuer" value={worker.certIssuer ?? '—'} />
              <Row label="Not Before" value={fmt(worker.certNotBefore)} />
              <Row label="Not After" value={fmt(worker.certNotAfter)} />
              <Row label="Serial" value={worker.certSerial ?? '—'} />
              <Row label="Key Usage" value={worker.certKeyUsage?.join(', ') ?? '—'} />
              <Row label="Fingerprint (SHA-256)" value={worker.certFingerprint ?? '—'} />
            </Section>
          )}

          {worker.caSubject && (
            <Section label="Root CA">
              <Row label="Subject" value={worker.caSubject} />
              <Row label="Not After" value={fmt(worker.caNotAfter)} />
            </Section>
          )}

          {!worker.certSubject && !worker.caSubject && (
            <p className="text-muted-foreground">No certificate metadata available.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">{label}</h4>
      <div className="flex flex-col gap-0.5 rounded-sm border border-border bg-background/40 p-2">
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`truncate text-right ${valueClass ?? 'text-foreground'}`}>{value}</span>
    </div>
  );
}
