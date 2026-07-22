import type { PackageMode, PackageType } from '../package-types';

export interface BackupInput {
  database: string;
}

export interface BackupResult {
  location: string;
}

export interface RestoreInput {
  backupLocation: string;
  database: string;
}

export interface MigrateInput {
  database: string;
}

export interface VerifyInput {
  database: string;
  collections: string[];
}

export interface VerifyResult {
  verified: boolean;
  counts: Record<string, number>;
}

export interface MarkUserAsLegacyInput {
  database?: string;
  batchSize?: number;
  lastId?: string;
}

export interface MarkUserAsLegacyOutput {
  totalMatched: number;
  totalModified: number;
  batches: number;
  completed: boolean;
}

export interface CalculateUserPackageUsageInput {
  database?: string;
  batchSize?: number;
  lastId?: string;
}

export interface CalculateUserPackageUsageOutput {
  totalUsers: number;
  totalAlbums: number;
  totalMediaCount: number;
  totalSize: number;
  batches: number;
  completed: boolean;
}

export interface SetUserPackageItemsInput {
  database?: string;
  batchSize?: number;
  lastId?: string;
  limitQuantity: number;
  sizeQuantity: number;
  trafficQuantity: number;
  yearQuantity: number;
}

export interface SetUserPackageItemsOutput {
  totalProcessed: number;
  totalModified: number;
  batches: number;
  completed: boolean;
}

export interface PackageItemConfig {
  type: PackageType;
  quantity: number;
  unit: string;
  mode: PackageMode;
}

export interface UserPackageEntry {
  email: string;
  packages: PackageItemConfig[];
}

export interface SetUserPackageItemsByIdentityInput {
  database?: string;
  batchSize?: number;
  entries: UserPackageEntry[];
}

export interface SetUserPackageItemsByIdentityOutput {
  totalProcessed: number;
  totalModified: number;
  notFound: string[];
  batches: number;
  completed: boolean;
}

export interface CalculateAlbumSummaryInput {
  database?: string;
  batchSize?: number;
  lastId?: string;
}

export interface HydrateUserNamesFromEmailInput {
  database?: string;
  batchSize?: number;
  lastId?: string;
}

export interface HydrateUserNamesFromEmailOutput {
  totalProcessed: number;
  namesFixed: number;
  batches: number;
  completed: boolean;
}

export interface CalculateAlbumSummaryOutput {
  totalAlbums: number;
  totalMedias: number;
  totalSize: number;
  totalImages: number;
  totalVideos: number;
  totalUsers: number;
  totalLikes: number;
  totalComments: number;
  batches: number;
  completed: boolean;
}

export interface GenerateAlbumActivityInput {
  database?: string;
  batchSize?: number;
  lastId?: string;
}

export interface GenerateAlbumActivityOutput {
  totalAlbums: number;
  eventsCreated: number;
  batches: number;
  completed: boolean;
}

export interface GenerateMediaActivityInput {
  database?: string;
  batchSize?: number;
  lastId?: string;
}

export interface GenerateMediaActivityOutput {
  totalMedia: number;
  groupsCreated: number;
  eventsCreated: number;
  batches: number;
  completed: boolean;
}

export interface GenerateInviteActivityInput {
  database?: string;
  inviteBatchSize?: number;
  roleBatchSize?: number;
  lastInviteId?: string;
  lastRoleId?: string;
  phase?: 'invited' | 'accepted';
}

export interface GenerateInviteActivityOutput {
  invitedCreated: number;
  acceptedCreated: number;
  invitesProcessed: number;
  rolesProcessed: number;
  batches: number;
  completed: boolean;
}

export interface GenerateOrderActivityInput {
  database?: string;
  batchSize?: number;
  lastId?: string;
}

export interface GenerateOrderActivityOutput {
  totalOrders: number;
  eventsCreated: number;
  batches: number;
  completed: boolean;
}

export interface ClearActivityDataInput {
  database?: string;
}

export interface ClearActivityDataOutput {
  activityEventsDeleted: number;
  activitySummariesDeleted: number;
  processedBusEventsDeleted: number;
  completed: boolean;
}
