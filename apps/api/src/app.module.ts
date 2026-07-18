import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from './guards/api-key.guard';
import { PrismaService } from './prisma/prisma.service';
import { JobsService } from './services/jobs.service';
import { AuditService } from './services/audit.service';
import { JobLogsService } from './services/job-logs.service';
import { JobsController } from './controllers/jobs.controller';
import { AuditController } from './controllers/audit.controller';
import { WorkflowsController } from './controllers/workflows.controller';
import { WorkersController } from './controllers/workers.controller';
import { WorkersService } from './services/workers.service';
import { TemporalService } from './temporal/temporal.service';
import { JobsGateway } from './gateways/jobs.gateway';
import { WorkersGateway } from './gateways/workers.gateway';

@Module({
  controllers: [JobsController, AuditController, WorkflowsController, WorkersController],
  providers: [
    PrismaService,
    TemporalService,
    JobsService,
    AuditService,
    JobLogsService,
    WorkersService,
    JobsGateway,
    WorkersGateway,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
