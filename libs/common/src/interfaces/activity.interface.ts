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

export interface CalculateAlbumSummaryInput {
  database?: string;
  batchSize?: number;
  lastId?: string;
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
