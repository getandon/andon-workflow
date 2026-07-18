import { Module, OnModuleInit } from '@nestjs/common';
import { TemporalWorkerService } from './temporal/temporal-worker.service';
import { BackupActivity } from './activities/backup.activity';
import { RestoreActivity } from './activities/restore.activity';
import { MigrateActivity } from './activities/migrate.activity';
import { VerifyActivity } from './activities/verify.activity';

@Module({
  providers: [
    TemporalWorkerService,
    BackupActivity,
    RestoreActivity,
    MigrateActivity,
    VerifyActivity,
  ],
})
export class WorkerModule {}
