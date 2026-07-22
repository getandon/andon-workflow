export interface ActivitySchema {
  input: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  output: {
    type: 'object';
    properties: Record<string, unknown>;
  };
}

export interface ActivityDefinition {
  name: string;
  label: string;
  description: string;
  schema: ActivitySchema;
}

const COMMON_FIELDS = ['database', 'batchSize'] as const;

export const SHARED_PARAM_FIELDS: readonly string[] = COMMON_FIELDS;

export const ACTIVITY_REGISTRY: ActivityDefinition[] = [
  {
    name: 'backupDatabase',
    label: 'Backup Database',
    description: 'Dump a MongoDB database and upload to S3',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name' },
        },
        required: ['database'],
      },
      output: {
        type: 'object',
        properties: {
          location: { type: 'string', title: 'Backup Location', description: 'S3 URI of the backup' },
        },
      },
    },
  },
  {
    name: 'restoreDatabase',
    label: 'Restore Database',
    description: 'Download a backup from S3 and restore into MongoDB',
    schema: {
      input: {
        type: 'object',
        properties: {
          backupLocation: { type: 'string', title: 'Backup Location', description: 'S3 URI of the backup to restore' },
          database: { type: 'string', title: 'Target Database', description: 'MongoDB database to restore into' },
        },
        required: ['backupLocation', 'database'],
      },
      output: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    name: 'runMigration',
    label: 'Run Migration',
    description: 'Run database migrations via migrate-mongo',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name' },
        },
      },
      output: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    name: 'verifyDatabase',
    label: 'Verify Database',
    description: 'Count documents in collections to verify data integrity',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name' },
          collections: {
            type: 'array',
            items: { type: 'string' },
            title: 'Collections',
            description: 'List of collections to verify',
          },
        },
        required: ['database', 'collections'],
      },
      output: {
        type: 'object',
        properties: {
          verified: { type: 'boolean', title: 'Verified' },
          counts: { type: 'object', title: 'Document Counts', description: 'Collection name to document count map' },
        },
      },
    },
  },
  {
    name: 'markUserAsLegacy',
    label: 'Mark Users as Legacy',
    description: 'Mark all users as legacy in batch',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name (default: album-server-db)' },
          batchSize: { type: 'number', title: 'Batch Size', description: 'Users per batch (default: 500)' },
        },
      },
      output: {
        type: 'object',
        properties: {
          totalMatched: { type: 'number', title: 'Total Matched' },
          totalModified: { type: 'number', title: 'Total Modified' },
          batches: { type: 'number', title: 'Batches' },
          completed: { type: 'boolean', title: 'Completed' },
        },
      },
    },
  },
  {
    name: 'calculateUserPackageUsage',
    label: 'Calculate Package Usage',
    description: 'Recalculate user package usage across all users',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name (default: album-server-db)' },
          batchSize: { type: 'number', title: 'Batch Size', description: 'Users per batch (default: 10)' },
        },
      },
      output: {
        type: 'object',
        properties: {
          totalUsers: { type: 'number', title: 'Total Users' },
          totalAlbums: { type: 'number', title: 'Total Albums' },
          totalMediaCount: { type: 'number', title: 'Total Media' },
          totalSize: { type: 'number', title: 'Total Size' },
          batches: { type: 'number', title: 'Batches' },
          completed: { type: 'boolean', title: 'Completed' },
        },
      },
    },
  },
  {
    name: 'calculateAlbumSummary',
    label: 'Calculate Album Summary',
    description: 'Recalculate album summaries across all albums',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name (default: album-server-db)' },
          batchSize: { type: 'number', title: 'Batch Size', description: 'Albums per batch (default: 50)' },
        },
      },
      output: {
        type: 'object',
        properties: {
          totalAlbums: { type: 'number', title: 'Total Albums' },
          totalMedias: { type: 'number', title: 'Total Media' },
          totalSize: { type: 'number', title: 'Total Size' },
          totalImages: { type: 'number', title: 'Total Images' },
          totalVideos: { type: 'number', title: 'Total Videos' },
          totalUsers: { type: 'number', title: 'Total Users' },
          totalLikes: { type: 'number', title: 'Total Likes' },
          totalComments: { type: 'number', title: 'Total Comments' },
          batches: { type: 'number', title: 'Batches' },
          completed: { type: 'boolean', title: 'Completed' },
        },
      },
    },
  },
  {
    name: 'hydrateUserNamesFromEmail',
    label: 'Hydrate User Names from Email',
    description: 'Hydrate user names from their email prefixes',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name (default: album-server-db)' },
          batchSize: { type: 'number', title: 'Batch Size', description: 'Users per batch (default: 500)' },
        },
      },
      output: {
        type: 'object',
        properties: {
          totalProcessed: { type: 'number', title: 'Total Processed' },
          namesFixed: { type: 'number', title: 'Names Fixed' },
          batches: { type: 'number', title: 'Batches' },
          completed: { type: 'boolean', title: 'Completed' },
        },
      },
    },
  },
  {
    name: 'setUserPackageItems',
    label: 'Set User Package Items',
    description: 'Set package items for all users with quantity limits',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name (default: album-server-db)' },
          batchSize: { type: 'number', title: 'Batch Size', description: 'Users per batch (default: 500)' },
          limitQuantity: { type: 'number', title: 'Limit Quantity' },
          sizeQuantity: { type: 'number', title: 'Size Quantity' },
          trafficQuantity: { type: 'number', title: 'Traffic Quantity' },
          yearQuantity: { type: 'number', title: 'Year Quantity' },
        },
        required: ['limitQuantity', 'sizeQuantity', 'trafficQuantity', 'yearQuantity'],
      },
      output: {
        type: 'object',
        properties: {
          totalProcessed: { type: 'number', title: 'Total Processed' },
          totalModified: { type: 'number', title: 'Total Modified' },
          batches: { type: 'number', title: 'Batches' },
          completed: { type: 'boolean', title: 'Completed' },
        },
      },
    },
  },
  {
    name: 'setUserPackageItemsByIdentity',
    label: 'Set Package Items by Identity',
    description: 'Set package items for specific users by email',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name (default: album-server-db)' },
          batchSize: { type: 'number', title: 'Batch Size', description: 'Users per batch (default: 500)' },
          entries: {
            type: 'array',
            title: 'User Entries',
            description: 'JSON array of { email, packages } objects',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string' },
                packages: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string' },
                      quantity: { type: 'number' },
                      unit: { type: 'string' },
                      mode: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        required: ['entries'],
      },
      output: {
        type: 'object',
        properties: {
          totalProcessed: { type: 'number', title: 'Total Processed' },
          totalModified: { type: 'number', title: 'Total Modified' },
          notFound: { type: 'array', items: { type: 'string' }, title: 'Not Found' },
          batches: { type: 'number', title: 'Batches' },
          completed: { type: 'boolean', title: 'Completed' },
        },
      },
    },
  },
  {
    name: 'generateAlbumActivity',
    label: 'Generate Album Activity',
    description: 'Backfill activity feed events for album CREATED from the album collection',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name (default: album-server-db)' },
          batchSize: { type: 'number', title: 'Batch Size', description: 'Albums per batch (default: 50)' },
        },
      },
      output: {
        type: 'object',
        properties: {
          totalAlbums: { type: 'number', title: 'Total Albums' },
          eventsCreated: { type: 'number', title: 'Events Created' },
          batches: { type: 'number', title: 'Batches' },
          completed: { type: 'boolean', title: 'Completed' },
        },
      },
    },
  },
  {
    name: 'generateMediaActivity',
    label: 'Generate Media Activity',
    description: 'Backfill activity feed events for media UPLOADED from the media collection, batched per-user per-album per-day',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name (default: album-server-db)' },
          batchSize: { type: 'number', title: 'Batch Size', description: 'Media per batch (default: 100)' },
        },
      },
      output: {
        type: 'object',
        properties: {
          totalMedia: { type: 'number', title: 'Total Media' },
          groupsCreated: { type: 'number', title: 'Groups Created' },
          eventsCreated: { type: 'number', title: 'Events Created' },
          batches: { type: 'number', title: 'Batches' },
          completed: { type: 'boolean', title: 'Completed' },
        },
      },
    },
  },
  {
    name: 'generateInviteActivity',
    label: 'Generate Invite Activity',
    description: 'Backfill activity feed events for invite INVITED and ACCEPTED from album_invite and album_role collections',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name (default: album-server-db)' },
          inviteBatchSize: { type: 'number', title: 'Invite Batch Size', description: 'Invites per batch (default: 100)' },
          roleBatchSize: { type: 'number', title: 'Role Batch Size', description: 'Roles per batch (default: 100)' },
          phase: {
            type: 'string',
            title: 'Phase',
            description: 'Which phase to run: "invited", "accepted", or omit for both',
          },
        },
      },
      output: {
        type: 'object',
        properties: {
          invitedCreated: { type: 'number', title: 'Invited Created' },
          acceptedCreated: { type: 'number', title: 'Accepted Created' },
          invitesProcessed: { type: 'number', title: 'Invites Processed' },
          rolesProcessed: { type: 'number', title: 'Roles Processed' },
          batches: { type: 'number', title: 'Batches' },
          completed: { type: 'boolean', title: 'Completed' },
        },
      },
    },
  },
  {
    name: 'generateOrderActivity',
    label: 'Generate Order Activity',
    description: 'Backfill activity feed events for order PURCHASED from the order collection',
    schema: {
      input: {
        type: 'object',
        properties: {
          database: { type: 'string', title: 'Database', description: 'MongoDB database name (default: album-server-db)' },
          batchSize: { type: 'number', title: 'Batch Size', description: 'Orders per batch (default: 50)' },
        },
      },
      output: {
        type: 'object',
        properties: {
          totalOrders: { type: 'number', title: 'Total Orders' },
          eventsCreated: { type: 'number', title: 'Events Created' },
          batches: { type: 'number', title: 'Batches' },
          completed: { type: 'boolean', title: 'Completed' },
        },
      },
    },
  },
];
