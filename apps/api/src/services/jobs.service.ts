import { Injectable, NotFoundException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { WorkflowUpdateFailedError } from '@temporalio/client';
import { PrismaService } from '../prisma/prisma.service';
import { TemporalService } from '../temporal/temporal.service';
import { JobsGateway } from '../gateways/jobs.gateway';
import { AuditService } from './audit.service';
import { JobLogsService } from './job-logs.service';
import { WORKFLOW_REGISTRY } from '../../../../libs/workflows/src';
import {
  SUBMIT_INPUT_UPDATE_NAME,
  PENDING_INPUT_REQUESTS_QUERY_NAME,
  type PendingInputRequest,
  type InputSubmission,
} from '../../../../libs/common/src';

const ACTOR = 'api-key';

function fmtDuration(from: Date | string | null | undefined, to: Date = new Date()): string {
  if (!from) return '0s';
  const sec = Math.max(0, Math.round((to.getTime() - new Date(from).getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

@Injectable()
export class JobsService {
  constructor(
    private prisma: PrismaService,
    private temporal: TemporalService,
    private gateway: JobsGateway,
    private audit: AuditService,
    private jobLogs: JobLogsService,
  ) {}

  async list(filters?: { status?: string; limit?: string; offset?: string }) {
    const where: Record<string, unknown> = {};
    if (filters?.status) where.status = filters.status;
    return this.prisma.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters?.limit ? parseInt(filters.limit, 10) : 50,
      skip: filters?.offset ? parseInt(filters.offset, 10) : 0,
      include: {
        steps: { orderBy: { id: 'asc' } },
        inputRequests: { where: { status: 'OPEN' }, orderBy: { id: 'asc' } },
      },
    });
  }

  async findById(id: number) {
    return this.prisma.job.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { id: 'asc' } },
        inputRequests: { orderBy: { id: 'asc' } },
      },
    });
  }

  async create(data: { workflowType: string; params?: Record<string, unknown> }) {
    const definition = WORKFLOW_REGISTRY.find((w) => w.type === data.workflowType);
    if (!definition) {
      throw new Error(`Unknown workflow type: ${data.workflowType}`);
    }
    const steps = definition.resolveSteps?.(data.params ?? {}) ?? definition.steps;

    const paramsStr = JSON.stringify(data.params ?? {});
    const workflowId = `${data.workflowType.toLowerCase()}-${Date.now()}`;

    const job = await this.prisma.job.create({
      data: {
        workflowId,
        workflowType: data.workflowType,
        status: 'WAITING_APPROVAL',
        createdBy: ACTOR,
        params: paramsStr,
        steps: {
          create: steps.map((name: string) => ({
            name,
            status: 'PENDING',
          })),
        },
      },
      include: { steps: { orderBy: { id: 'asc' } } },
    });

    await this.audit.log('JOB_CREATED', JSON.stringify({ workflowId, type: data.workflowType }), job.id);
    await this.jobLogs.write(
      job.id,
      'INFO',
      `Job created — ${definition.label ?? data.workflowType}`,
      null,
      ACTOR,
    );
    this.gateway.emitJobCreated(job as unknown as Record<string, unknown>);

    return this.findById(job.id);
  }

  async approve(id: number) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new Error('Job not found');
    if (job.status !== 'WAITING_APPROVAL') throw new Error('Job is not waiting for approval');

    const definition = WORKFLOW_REGISTRY.find((w) => w.type === job.workflowType);
    if (!definition) throw new Error(`Unknown workflow type: ${job.workflowType}`);

    const params = JSON.parse(job.params || '{}');
    const taskQueue: string | undefined =
      params.taskQueue ??
      (definition.taskQueueField ? params[definition.taskQueueField] : undefined) ??
      definition.defaultTaskQueue;
    if (!taskQueue) {
      throw new Error(
        `No task queue found for workflow "${job.workflowType}": expected "taskQueue"${definition.taskQueueField ? ` or "${definition.taskQueueField}"` : ''} in job params, or a defaultTaskQueue on the workflow definition`,
      );
    }

    await this.jobLogs.write(
      job.id,
      'SUCCESS',
      `Job approved — starting workflow on queue "${taskQueue}"`,
      null,
      ACTOR,
    );
    await this.startWorkflow(job.id, job.workflowId, job.workflowType, taskQueue, params);
    await this.audit.log('JOB_APPROVED', JSON.stringify({ workflowId: job.workflowId }), job.id);
    return this.findById(job.id);
  }

  async reject(id: number, reason?: string) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new Error('Job not found');
    if (job.status !== 'WAITING_APPROVAL') throw new Error('Job is not waiting for approval');

    const updated = await this.prisma.job.update({
      where: { id },
      data: { status: 'CANCELLED', finishedAt: new Date(), error: reason ?? 'Rejected' },
    });
    this.gateway.emitJobUpdate(id, { status: 'CANCELLED' });
    await this.audit.log('JOB_REJECTED', JSON.stringify({ workflowId: job.workflowId, reason }), job.id);
    await this.jobLogs.write(
      job.id,
      'ERROR',
      `Job rejected${reason ? ` — ${reason}` : ''}`,
      null,
      ACTOR,
    );
    return updated;
  }

  async cancel(id: number) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new Error('Job not found');
    if (job.status !== 'RUNNING') throw new Error('Job is not running');

    const handle = this.temporal.getClient().workflow.getHandle(job.workflowId);
    await handle.cancel();

    const updated = await this.prisma.job.update({
      where: { id },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    this.gateway.emitJobUpdate(id, { status: 'CANCELLED' });
    await this.audit.log('JOB_CANCELLED', JSON.stringify({ workflowId: job.workflowId }), job.id);
    await this.jobLogs.write(job.id, 'WARN', 'Job cancelled', null, ACTOR);
    return updated;
  }

  async retry(id: number) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new Error('Job not found');
    if (job.status !== 'FAILED') throw new Error('Only failed jobs can be retried');

    const newWorkflowId = `${job.workflowType.toLowerCase()}-${Date.now()}`;

    await this.prisma.jobInputRequest.deleteMany({ where: { jobId: job.id } });
    await this.prisma.job.update({
      where: { id },
      data: {
        workflowId: newWorkflowId,
        status: 'WAITING_APPROVAL',
        error: null,
        finishedAt: null,
        steps: {
          updateMany: { where: {}, data: { status: 'PENDING', startedAt: null, finishedAt: null, error: null } },
        },
      },
    });

    await this.audit.log('JOB_RETRIED', JSON.stringify({ workflowId: newWorkflowId }), job.id);
    await this.jobLogs.write(
      job.id,
      'WARN',
      'Retry requested — steps reset, starting new run',
      null,
      ACTOR,
    );
    return this.findById(job.id);
  }

  async submitGateInput(id: number, gateId: string, payload: unknown) {
    const { job } = await this.deliverSubmission(id, gateId, { gateId, payload, decidedBy: ACTOR });
    const step = await this.gateStep(job.id, gateId);
    await this.resolveGateRow(job.id, gateId, {
      status: 'RESOLVED',
      payload: JSON.stringify(payload ?? null),
      decidedBy: ACTOR,
    });
    await this.markWaitingStepResumed(job.id);
    this.gateway.emitJobUpdate(job.id, { status: 'RUNNING' });
    await this.audit.log(
      'INPUT_RECEIVED',
      JSON.stringify({ workflowId: job.workflowId, gateId, payload }),
      job.id,
    );
    await this.jobLogs.write(job.id, 'INFO', 'Input received', step, ACTOR);
    return this.findById(job.id);
  }

  async approveGate(id: number, gateId: string, input?: unknown) {
    const { job } = await this.deliverSubmission(id, gateId, {
      gateId,
      approved: true,
      payload: input,
      decidedBy: ACTOR,
    });
    await this.resolveGateRow(job.id, gateId, {
      status: 'RESOLVED',
      payload: input !== undefined ? JSON.stringify(input) : null,
      decidedBy: ACTOR,
    });
    await this.markWaitingStepResumed(job.id);
    this.gateway.emitJobUpdate(job.id, { status: 'RUNNING' });
    await this.audit.log(
      'STEP_APPROVED',
      JSON.stringify({ workflowId: job.workflowId, gateId, input }),
      job.id,
    );
    await this.jobLogs.write(
      job.id,
      'SUCCESS',
      'Approval granted',
      await this.gateStep(job.id, gateId),
      ACTOR,
    );
    return this.findById(job.id);
  }

  async rejectGate(id: number, gateId: string, reason?: string) {
    const { job } = await this.deliverSubmission(id, gateId, {
      gateId,
      approved: false,
      reason,
      decidedBy: ACTOR,
    });
    await this.resolveGateRow(job.id, gateId, {
      status: 'REJECTED',
      decidedBy: ACTOR,
      reason: reason ?? null,
    });
    const waitingStep = await this.prisma.jobStep.findFirst({
      where: { jobId: job.id, status: { in: ['WAITING_APPROVAL', 'WAITING_INPUT'] } },
    });
    if (waitingStep) {
      await this.prisma.jobStep.update({
        where: { id: waitingStep.id },
        data: { status: 'FAILED', finishedAt: new Date(), error: reason ?? 'Rejected' },
      });
    }
    this.gateway.emitJobUpdate(job.id, { status: 'RUNNING' });
    await this.audit.log(
      'STEP_REJECTED',
      JSON.stringify({ workflowId: job.workflowId, gateId, reason }),
      job.id,
    );
    await this.jobLogs.write(
      job.id,
      'ERROR',
      `Approval rejected${reason ? ` — ${reason}` : ''}`,
      await this.gateStep(job.id, gateId),
      ACTOR,
    );
    return this.findById(job.id);
  }

  private async gateStep(jobId: number, gateId: string): Promise<string | null> {
    const gate = await this.prisma.jobInputRequest.findUnique({
      where: { jobId_gateId: { jobId, gateId } },
    });
    return gate?.step ?? null;
  }

  private async stepExecutor(jobId: number, stepName: string): Promise<string> {
    const entry = await this.prisma.jobLogEntry.findFirst({
      where: { jobId, step: stepName, source: { notIn: ['api', 'system', ACTOR] } },
      orderBy: { id: 'desc' },
    });
    return entry?.source ?? 'system';
  }

  private async deliverSubmission(id: number, gateId: string, submission: InputSubmission) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== 'RUNNING') throw new ConflictException('Job is not running');

    const handle = this.temporal.getClient().workflow.getHandle(job.workflowId);
    try {
      await handle.executeUpdate<InputSubmission, [InputSubmission]>(SUBMIT_INPUT_UPDATE_NAME, {
        args: [submission],
      });
    } catch (err) {
      if (err instanceof WorkflowUpdateFailedError) {
        const cause = err.cause as { message?: string; details?: unknown[]; type?: string } | undefined;
        throw new UnprocessableEntityException({
          message: cause?.message ?? 'Input rejected by workflow',
          type: cause?.type,
          errors: cause?.details ?? [],
        });
      }
      throw err;
    }
    return { job };
  }

  private async resolveGateRow(
    jobId: number,
    gateId: string,
    data: { status: string; payload?: string | null; decidedBy?: string; reason?: string | null },
  ) {
    await this.prisma.jobInputRequest.updateMany({
      where: { jobId, gateId },
      data: { ...data, resolvedAt: new Date() },
    });
  }

  private async markWaitingStepResumed(jobId: number) {
    await this.prisma.jobStep.updateMany({
      where: { jobId, status: { in: ['WAITING_APPROVAL', 'WAITING_INPUT'] } },
      data: { status: 'RUNNING' },
    });
  }

  async getDashboard() {
    const [active, completedToday, failed, waiting] = await Promise.all([
      this.prisma.job.count({ where: { status: 'RUNNING' } }),
      this.prisma.job.count({ where: { status: 'COMPLETED', createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
      this.prisma.job.count({ where: { status: 'FAILED' } }),
      this.prisma.job.count({ where: { status: 'WAITING_APPROVAL' } }),
    ]);

    const recentActivity = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { job: { select: { id: true, workflowId: true, workflowType: true } } },
    });

    return { stats: { active, completedToday, failed, waiting }, recentActivity };
  }

  private async startWorkflow(
    jobId: number,
    workflowId: string,
    workflowType: string,
    taskQueue: string,
    params: Record<string, unknown>,
  ) {
    const client = this.temporal.getClient();

    await this.prisma.job.update({
      where: { id: jobId },
      data: { workflowId, status: 'RUNNING', startedAt: new Date() },
    });
    this.gateway.emitJobUpdate(jobId, { status: 'RUNNING' });

    const handle = await client.workflow.start(workflowType, {
      args: [params],
      taskQueue,
      workflowId,
    });

    this.watchWorkflow(jobId, handle);
  }

  private async watchWorkflow(
    jobId: number,
    handle: { result: () => Promise<unknown>; query: <T>(name: string) => Promise<T> },
  ) {
    let running = true;
    let lastStep: string | undefined;
    let lastGateFingerprint = '';

    const pollInterval = setInterval(async () => {
      if (!running) return;
      try {
        const [step, pendingInputs] = await Promise.all([
          handle.query<string | undefined>('currentStep'),
          handle.query<PendingInputRequest[]>(PENDING_INPUT_REQUESTS_QUERY_NAME).catch(() => [] as PendingInputRequest[]),
        ]);

        const fingerprint = JSON.stringify(pendingInputs.map((g) => g.gateId).sort());
        if (fingerprint !== lastGateFingerprint) {
          lastGateFingerprint = fingerprint;
          await this.syncInputRequests(jobId, pendingInputs);
        }

        if (step !== undefined && (step !== lastStep || fingerprint !== '[]')) {
          lastStep = step;
          await this.updateStepProgress(jobId, step, pendingInputs);
        }
      } catch {}
    }, 2000);

    try {
      await handle.result();
      running = false;
      clearInterval(pollInterval);
      await this.closeLeftoverGates(jobId);
      await this.prisma.jobStep.updateMany({
        where: { jobId, startedAt: null },
        data: { startedAt: new Date() },
      });
      const remainingSteps = await this.prisma.jobStep.findMany({
        where: { jobId, status: { not: 'COMPLETED' } },
        orderBy: { id: 'asc' },
      });
      await this.prisma.jobStep.updateMany({
        where: { jobId, status: { not: 'COMPLETED' } },
        data: { status: 'COMPLETED', finishedAt: new Date() },
      });
      for (const step of remainingSteps) {
        await this.jobLogs.write(
          jobId,
          'INFO',
          `Step completed in ${fmtDuration(step.startedAt)}`,
          step.name,
          await this.stepExecutor(jobId, step.name),
        );
      }
      const completedJob = await this.prisma.job.update({
        where: { id: jobId },
        data: { status: 'COMPLETED', finishedAt: new Date() },
      });
      this.gateway.emitJobUpdate(jobId, { status: 'COMPLETED' });
      await this.audit.log('JOB_COMPLETED', JSON.stringify({ jobId }), jobId);
      await this.jobLogs.write(
        jobId,
        'SUCCESS',
        `Job completed in ${fmtDuration(completedJob.startedAt, completedJob.finishedAt ?? new Date())}`,
      );
    } catch (err) {
      running = false;
      clearInterval(pollInterval);
      await this.closeLeftoverGates(jobId);
      const message = err instanceof Error ? err.message : 'Unknown error';
      await this.prisma.job.update({
        where: { id: jobId },
        data: { status: 'FAILED', finishedAt: new Date(), error: message },
      });
      this.gateway.emitJobUpdate(jobId, { status: 'FAILED', error: message });
      await this.audit.log('JOB_FAILED', JSON.stringify({ jobId, error: message }), jobId);
      await this.jobLogs.write(jobId, 'ERROR', `Job failed — ${message}`);
    }
  }

  private async syncInputRequests(jobId: number, pending: PendingInputRequest[]) {
    const pendingIds = new Set(pending.map((g) => g.gateId));

    for (const gate of pending) {
      const existing = await this.prisma.jobInputRequest.findUnique({
        where: { jobId_gateId: { jobId, gateId: gate.gateId } },
      });
      if (!existing) {
        await this.prisma.jobInputRequest.create({
          data: {
            jobId,
            gateId: gate.gateId,
            kind: gate.kind,
            step: gate.step,
            schema: gate.schema ? JSON.stringify(gate.schema) : null,
            expiresAt: gate.expiresAt ? new Date(gate.expiresAt) : null,
            status: 'OPEN',
          },
        });
        await this.audit.log(
          gate.kind === 'approval' ? 'STEP_APPROVAL_WAITING' : 'STEP_INPUT_WAITING',
          JSON.stringify({ gateId: gate.gateId, step: gate.step }),
          jobId,
        );
        await this.jobLogs.write(
          jobId,
          'WARN',
          gate.kind === 'approval' ? 'Waiting for approval' : 'Waiting for input',
          gate.step,
        );
      }
    }

    await this.prisma.jobInputRequest.updateMany({
      where: { jobId, status: 'OPEN', gateId: { notIn: [...pendingIds] } },
      data: { status: 'RESOLVED', decidedBy: 'external', resolvedAt: new Date() },
    });
  }

  private async closeLeftoverGates(jobId: number) {
    const now = new Date();
    const expiring = await this.prisma.jobInputRequest.findMany({
      where: { jobId, status: 'OPEN', expiresAt: { lte: now } },
    });
    await this.prisma.jobInputRequest.updateMany({
      where: { jobId, status: 'OPEN', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', resolvedAt: now },
    });
    for (const gate of expiring) {
      await this.jobLogs.write(
        jobId,
        'WARN',
        gate.kind === 'approval' ? 'Approval request expired' : 'Input request expired',
        gate.step,
      );
    }
    await this.prisma.jobInputRequest.updateMany({
      where: { jobId, status: 'OPEN' },
      data: { status: 'RESOLVED', decidedBy: 'external', resolvedAt: now },
    });
  }

  private async updateStepProgress(jobId: number, currentStepName: string, pendingInputs: PendingInputRequest[]) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return;

    const gatesByStep = new Map(pendingInputs.map((g) => [g.step, g]));
    const openGate = gatesByStep.get(currentStepName);
    const waitingStatus = openGate
      ? openGate.kind === 'approval'
        ? 'WAITING_APPROVAL'
        : 'WAITING_INPUT'
      : undefined;

    const steps = await this.prisma.jobStep.findMany({
      where: { jobId },
      orderBy: { id: 'asc' },
    });
    const currentIndex = steps.findIndex((s) => s.name === currentStepName);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const isBeforeCurrent = currentIndex !== -1 && i < currentIndex;
      const isCurrent = currentIndex !== -1 && i === currentIndex;

      if (isBeforeCurrent && step.status !== 'COMPLETED' && step.status !== 'FAILED') {
        await this.prisma.jobStep.update({
          where: { id: step.id },
          data: {
            status: 'COMPLETED',
            startedAt: step.startedAt ?? new Date(),
            finishedAt: new Date(),
          },
        });
        await this.jobLogs.write(
          jobId,
          'INFO',
          `Step completed in ${fmtDuration(step.startedAt)}`,
          step.name,
          await this.stepExecutor(jobId, step.name),
        );
      } else if (isCurrent && (step.status === 'PENDING' || (waitingStatus && step.status === 'RUNNING'))) {
        await this.prisma.jobStep.update({
          where: { id: step.id },
          data: { status: waitingStatus ?? 'RUNNING', startedAt: step.startedAt ?? new Date() },
        });
        if (step.status === 'PENDING' && !waitingStatus) {
          await this.jobLogs.write(jobId, 'INFO', 'Step started', step.name);
        }
      } else if (
        !isCurrent &&
        !isBeforeCurrent &&
        (step.status === 'RUNNING' || step.status === 'WAITING_APPROVAL' || step.status === 'WAITING_INPUT')
      ) {
        await this.prisma.jobStep.update({
          where: { id: step.id },
          data: { status: 'COMPLETED', finishedAt: new Date() },
        });
        await this.jobLogs.write(
          jobId,
          'INFO',
          `Step completed in ${fmtDuration(step.startedAt)}`,
          step.name,
          await this.stepExecutor(jobId, step.name),
        );
      }
    }

    this.gateway.emitJobUpdate(jobId, {
      status: 'RUNNING',
      waitingStep: waitingStatus ? currentStepName : undefined,
    });
  }
}
