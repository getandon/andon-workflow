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
