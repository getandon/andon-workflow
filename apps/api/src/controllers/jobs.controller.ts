import { Controller, Get, Post, Param, Body, Query, ParseIntPipe } from '@nestjs/common';
import { JobsService } from '../services/jobs.service';
import { AuditService } from '../services/audit.service';
import { JobLogsService, IncomingLogEntry } from '../services/job-logs.service';

@Controller('api/jobs')
export class JobsController {
  constructor(
    private jobs: JobsService,
    private audit: AuditService,
    private jobLogs: JobLogsService,
  ) {}

  @Get()
  list(@Query() filters?: { status?: string; limit?: string; offset?: string }) {
    return this.jobs.list(filters);
  }

  @Post()
  create(@Body() body: { workflowType: string; params?: Record<string, unknown> }) {
    return this.jobs.create(body);
  }

  @Post('logs')
  ingestLogs(@Body() body: { workflowId: string; entries: IncomingLogEntry[] }) {
    return this.jobLogs.ingest(body.workflowId, body.entries ?? []);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.jobs.findById(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.jobs.cancel(id);
  }

  @Post(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number) {
    return this.jobs.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Body() body?: { reason?: string }) {
    return this.jobs.reject(id, body?.reason);
  }

  @Post(':id/retry')
  retry(@Param('id', ParseIntPipe) id: number) {
    return this.jobs.retry(id);
  }

  @Post(':id/inputs/:gateId')
  submitInput(
    @Param('id', ParseIntPipe) id: number,
    @Param('gateId') gateId: string,
    @Body() body: { payload?: unknown },
  ) {
    return this.jobs.submitGateInput(id, gateId, body?.payload);
  }

  @Post(':id/gates/:gateId/approve')
  approveGate(
    @Param('id', ParseIntPipe) id: number,
    @Param('gateId') gateId: string,
    @Body() body?: { input?: unknown },
  ) {
    return this.jobs.approveGate(id, gateId, body?.input);
  }

  @Post(':id/gates/:gateId/reject')
  rejectGate(
    @Param('id', ParseIntPipe) id: number,
    @Param('gateId') gateId: string,
    @Body() body?: { reason?: string },
  ) {
    return this.jobs.rejectGate(id, gateId, body?.reason);
  }

  @Get(':id/history')
  history(@Param('id', ParseIntPipe) id: number) {
    return this.audit.findByJob(id);
  }

  @Get(':id/logs')
  logs(@Param('id', ParseIntPipe) id: number) {
    return this.jobLogs.findByJob(id);
  }
}
