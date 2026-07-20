import { Module, OnModuleInit } from '@nestjs/common';
import { TemporalWorkerService } from './temporal/temporal-worker.service';
import { BackupActivity } from './activities/backup.activity';
import { RestoreActivity } from './activities/restore.activity';
import { MigrateActivity } from './activities/migrate.activity';
import { VerifyActivity } from './activities/verify.activity';
import { MarkUserAsLegacyActivity } from './activities/pixxo/MarkUserAsLegacy.activity';
import { CalculateUserPackageUsageActivity } from './activities/pixxo/CalculateUserPackageUsage.activity';
import { CalculateAlbumSummaryActivity } from './activities/pixxo/CalculateAlbumSummary.activity';
import { HydrateUserNamesFromEmailActivity } from './activities/pixxo/HydrateUserNamesFromEmail.activity';
import { SetUserPackageItemsActivity } from './activities/pixxo/SetUserPackageItems.activity';

@Module({
  providers: [
    TemporalWorkerService,
    BackupActivity,
    RestoreActivity,
    MigrateActivity,
    VerifyActivity,
    MarkUserAsLegacyActivity,
    CalculateUserPackageUsageActivity,
    CalculateAlbumSummaryActivity,
    HydrateUserNamesFromEmailActivity,
    SetUserPackageItemsActivity,
  ],
})
export class WorkerModule {}
