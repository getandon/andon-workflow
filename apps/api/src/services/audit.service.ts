import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(action: string, details: string, jobId?: number) {
    return this.prisma.auditLog.create({
      data: { action, details, jobId: jobId ?? null },
    });
  }

  async findAll(filters?: { action?: string; limit?: number; offset?: number }) {
    const where: Record<string, unknown> = {};
    if (filters?.action) where.action = filters.action;
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
      include: { job: { select: { id: true, workflowId: true, workflowType: true } } },
    });
  }

  async findByJob(jobId: number) {
    return this.prisma.auditLog.findMany({
      where: { jobId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
