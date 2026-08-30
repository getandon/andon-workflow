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
import { SetUserPackageItemsByIdentityActivity } from './activities/pixxo/SetUserPackageItemsByIdentity.activity';
import { GenerateAlbumActivity } from './activities/pixxo/GenerateAlbumActivity.activity';
import { GenerateMediaActivity } from './activities/pixxo/GenerateMediaActivity.activity';
import { GenerateInviteActivity } from './activities/pixxo/GenerateInviteActivity.activity';
import { GenerateOrderActivity } from './activities/pixxo/GenerateOrderActivity.activity';
import { GenerateUserActivity } from './activities/pixxo/GenerateUserActivity.activity';
import { ClearActivityDataActivity } from './activities/pixxo/ClearActivityData.activity';
import { SeedAdminActivity } from './activities/pixxo/SeedAdminActivity.activity';

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
    SetUserPackageItemsByIdentityActivity,
    GenerateAlbumActivity,
    GenerateMediaActivity,
    GenerateInviteActivity,
    GenerateOrderActivity,
    GenerateUserActivity,
    ClearActivityDataActivity,
    SeedAdminActivity,
  ],
})
export class WorkerModule {}
