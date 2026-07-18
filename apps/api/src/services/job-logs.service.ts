import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JobsGateway } from '../gateways/jobs.gateway';

export type JobLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

const LEVELS: JobLogLevel[] = ['INFO', 'WARN', 'ERROR', 'SUCCESS'];

export interface IncomingLogEntry {
  ts?: string;
  level?: string;
  step?: string | null;
  source?: string;
  message: string;
}

@Injectable()
export class JobLogsService {
  constructor(
    private prisma: PrismaService,
    private gateway: JobsGateway,
  ) {}

  async write(
    jobId: number,
    level: JobLogLevel,
    message: string,
    step?: string | null,
    source = 'system',
  ) {
    const entry = await this.prisma.jobLogEntry.create({
      data: { jobId, level, message, step: step ?? null, source },
    });
    this.gateway.emitJobLog(jobId, entry as unknown as Record<string, unknown>);
    return entry;
  }

  async ingest(workflowId: string, entries: IncomingLogEntry[]) {
    const job = await this.prisma.job.findUnique({ where: { workflowId } });
    if (!job) throw new NotFoundException(`Unknown workflowId: ${workflowId}`);

    let count = 0;
    for (const incoming of entries) {
      if (!incoming?.message) continue;
      const entry = await this.prisma.jobLogEntry.create({
        data: {
          jobId: job.id,
          ts: incoming.ts ? new Date(incoming.ts) : new Date(),
          level: this.normalizeLevel(incoming.level),
          source: incoming.source ?? 'worker',
          step: incoming.step ?? null,
          message: incoming.message,
        },
      });
      this.gateway.emitJobLog(job.id, entry as unknown as Record<string, unknown>);
      count++;
    }
    return { count };
  }

  async findByJob(jobId: number) {
    return this.prisma.jobLogEntry.findMany({
      where: { jobId },
      orderBy: { id: 'asc' },
    });
  }

  private normalizeLevel(level?: string): JobLogLevel {
    const upper = (level ?? 'INFO').toUpperCase() as JobLogLevel;
    return LEVELS.includes(upper) ? upper : 'INFO';
  }
}
