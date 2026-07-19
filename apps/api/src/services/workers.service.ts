import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemporalService } from '../temporal/temporal.service';
import { WorkersGateway } from '../gateways/workers.gateway';

@Injectable()
export class WorkersService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private temporal: TemporalService,
    private gateway: WorkersGateway,
  ) {}

  async onModuleInit() {
    setInterval(() => this.markStale(), 15_000);
  }

  private async markStale() {
    const cutoff = new Date(Date.now() - 60_000);
    const stale = await this.prisma.worker.findMany({
      where: { lastHeartbeat: { lt: cutoff }, status: { not: 'OFFLINE' } },
    });
    for (const w of stale) {
      await this.prisma.worker.update({
        where: { id: w.id },
        data: { status: 'OFFLINE' },
      });
      this.gateway.emitWorkerUpdate({ name: w.name, status: 'OFFLINE', lastHeartbeatSec: null });
    }
  }

  async register(data: {
    name: string;
    taskQueue: string;
    environment: string;
    activities: string[];
    identity?: string;
    tlsEnabled?: boolean;
    temporalTls?: boolean;
    apiTls?: boolean;
    certNotAfter?: string | null;
    certNotBefore?: string | null;
    certSubject?: string | null;
    certIssuer?: string | null;
    certSerial?: string | null;
    certKeyUsage?: string | null;
    certFingerprint?: string | null;
    caNotAfter?: string | null;
    caSubject?: string | null;
  }) {
    const certFields = {
      tlsEnabled: data.tlsEnabled ?? false,
      temporalTls: data.temporalTls ?? false,
      apiTls: data.apiTls ?? false,
      certNotAfter: data.certNotAfter ? new Date(data.certNotAfter) : null,
      certNotBefore: data.certNotBefore ? new Date(data.certNotBefore) : null,
      certSubject: data.certSubject ?? null,
      certIssuer: data.certIssuer ?? null,
      certSerial: data.certSerial ?? null,
      certKeyUsage: data.certKeyUsage ?? null,
      certFingerprint: data.certFingerprint ?? null,
      caNotAfter: data.caNotAfter ? new Date(data.caNotAfter) : null,
      caSubject: data.caSubject ?? null,
    };

    const worker = await this.prisma.worker.upsert({
      where: { name: data.name },
      create: {
        name: data.name,
        taskQueue: data.taskQueue,
        environment: data.environment,
        activities: JSON.stringify(data.activities),
        status: 'ONLINE',
        lastHeartbeat: new Date(),
        ...certFields,
      },
      update: {
        taskQueue: data.taskQueue,
        environment: data.environment,
        activities: JSON.stringify(data.activities),
        status: 'ONLINE',
        lastHeartbeat: new Date(),
        ...certFields,
      },
    });
    return worker;
  }

  async heartbeatByName(name: string) {
    const result = await this.prisma.worker.updateMany({
      where: { name },
      data: { lastHeartbeat: new Date(), status: 'ONLINE' },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Unknown worker: ${name} — re-register required`);
    }
    return this.prisma.worker.findUnique({ where: { name } });
  }

  async deleteById(id: number) {
    const worker = await this.prisma.worker.findUnique({ where: { id } });
    if (!worker) {
      throw new NotFoundException(`Worker ${id} not found`);
    }
    await this.prisma.worker.delete({ where: { id } });
    this.gateway.emitWorkerDelete(id);
    return { deleted: true };
  }

  async findAll() {
    const workers = await this.prisma.worker.findMany({ orderBy: { name: 'asc' } });

    const taskQueues = [...new Set(workers.map((w) => w.taskQueue))];

    const pollerMap = new Map<string, { identities: Set<string>; lastAccessTimes: Map<string, number> }>();
    for (const tq of taskQueues) {
      try {
        const resp = await this.temporal.describeTaskQueue(tq);
        const identities = new Set<string>();
        const lastAccessTimes = new Map<string, number>();
        for (const p of resp.pollers ?? []) {
          if (p.identity) {
            identities.add(p.identity);
            if (p.lastAccessTime) {
              lastAccessTimes.set(p.identity, new Date(p.lastAccessTime as unknown as string).getTime());
            }
          }
        }
        pollerMap.set(tq, { identities, lastAccessTimes });
      } catch {
        pollerMap.set(tq, { identities: new Set(), lastAccessTimes: new Map() });
      }
    }

    return workers.map((w) => {
      const pollerInfo = pollerMap.get(w.taskQueue);
      const pollers = pollerInfo?.identities ?? new Set();
      const hasPollers = pollers.size > 0;

      const isExactMatch = pollers.has(w.name);
      const STALE_HEARTBEAT_MS = 60_000;
      const heartbeatFresh = w.lastHeartbeat
        && Date.now() - new Date(w.lastHeartbeat).getTime() < STALE_HEARTBEAT_MS;
      let status: string;
      if (!heartbeatFresh) {
        status = isExactMatch ? 'DEGRADED' : 'OFFLINE';
      } else if (isExactMatch) {
        status = 'ONLINE';
      } else if (hasPollers) {
        status = 'DEGRADED';
      } else {
        status = 'OFFLINE';
      }

      let lastHeartbeatSec: number | null = null;
      if (isExactMatch) {
        const ts = pollerInfo?.lastAccessTimes.get(w.name);
        if (ts) lastHeartbeatSec = Math.round((Date.now() - ts) / 1000);
      }
      if (lastHeartbeatSec === null && w.lastHeartbeat) {
        lastHeartbeatSec = Math.round((Date.now() - new Date(w.lastHeartbeat).getTime()) / 1000);
      }

      return {
        ...w,
        activities: JSON.parse(w.activities),
        certKeyUsage: w.certKeyUsage ? w.certKeyUsage.split(', ') : null,
        status,
        lastHeartbeatSec,
      };
    });
  }
}
