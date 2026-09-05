jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn(() => ({
      heartbeat: jest.fn(),
      info: { workflowExecution: { workflowId: 'test' }, activityType: 'test' },
    })),
  },
}));

jest.mock('../../../job-log', () => ({
  jobLog: {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), success: jest.fn(), failure: jest.fn(),
  },
}));

jest.mock('@andon-workflow/lib', () => {
  const actual = jest.requireActual('@andon-workflow/lib');
  return { ...actual, requiredEnv: jest.fn().mockReturnValue('mongodb://localhost:27017') };
});

describe('DedupeAlbumRoleActivity', () => {
  let mockCollectionFns: Record<string, any>;
  let dedupeAlbumRole: any;

  beforeEach(() => {
    jest.resetModules();
    mockCollectionFns = {};

    const mockDb = {
      collection: jest.fn((name: string) => {
        if (!mockCollectionFns[name]) {
          mockCollectionFns[name] = {
            aggregate: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
            deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
            createIndex: jest.fn().mockResolvedValue('user_1_album_1'),
          };
        }
        return mockCollectionFns[name];
      }),
    };

    jest.doMock('mongodb', () => {
      const actual = jest.requireActual('mongodb');
      return {
        ...actual,
        MongoClient: jest.fn().mockImplementation(() => ({
          connect: jest.fn().mockResolvedValue(undefined),
          close: jest.fn().mockResolvedValue(undefined),
          db: jest.fn().mockReturnValue(mockDb),
        })),
      };
    });

    const mod = require('../DedupeAlbumRole.activity');
    dedupeAlbumRole = new mod.DedupeAlbumRoleActivity();
  });

  it('should delete duplicate rows keeping the highest-precedence role and create the index', async () => {
    mockCollectionFns['album_role'] = {
      aggregate: jest.fn(() => ({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: { user: 'u1', album: 'a1' },
            count: 2,
            docs: [
              { id: 'id1', userRole: 'GUEST', createdAt: 100 },
              { id: 'id2', userRole: 'GUEST', createdAt: 200 },
            ],
          },
        ]),
      })),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      createIndex: jest.fn().mockResolvedValue('user_1_album_1'),
    };

    const result = await dedupeAlbumRole.dedupeAlbumRole({ database: 'test-db' });

    expect(result.completed).toBe(true);
    expect(result.duplicatesFound).toBe(1);
    expect(result.duplicatesDeleted).toBe(1);
    expect(result.indexCreated).toBe(true);
    expect(mockCollectionFns['album_role'].deleteMany).toHaveBeenCalledWith({ _id: { $in: ['id2'] } });
    expect(mockCollectionFns['album_role'].createIndex).toHaveBeenCalledWith({ user: 1, album: 1 }, { unique: true });
  });

  it('should keep the higher-precedence role and delete the lower one', async () => {
    mockCollectionFns['album_role'] = {
      aggregate: jest.fn(() => ({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: { user: 'u1', album: 'a1' },
            count: 2,
            docs: [
              { id: 'id-owner', userRole: 'OWNER', createdAt: 999 },
              { id: 'id-guest', userRole: 'GUEST', createdAt: 100 },
            ],
          },
        ]),
      })),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      createIndex: jest.fn().mockResolvedValue('user_1_album_1'),
    };

    await dedupeAlbumRole.dedupeAlbumRole({ database: 'test-db' });

    expect(mockCollectionFns['album_role'].deleteMany).toHaveBeenCalledWith({ _id: { $in: ['id-guest'] } });
  });

  it('should not delete or create the index in dry run mode', async () => {
    mockCollectionFns['album_role'] = {
      aggregate: jest.fn(() => ({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: { user: 'u1', album: 'a1' },
            count: 2,
            docs: [
              { id: 'id1', userRole: 'GUEST', createdAt: 100 },
              { id: 'id2', userRole: 'GUEST', createdAt: 200 },
            ],
          },
        ]),
      })),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      createIndex: jest.fn().mockResolvedValue('user_1_album_1'),
    };

    const result = await dedupeAlbumRole.dedupeAlbumRole({ database: 'test-db', dryRun: true });

    expect(result.duplicatesFound).toBe(1);
    expect(result.duplicatesDeleted).toBe(0);
    expect(result.indexCreated).toBe(false);
    expect(mockCollectionFns['album_role'].deleteMany).not.toHaveBeenCalled();
    expect(mockCollectionFns['album_role'].createIndex).not.toHaveBeenCalled();
  });

  it('should close the client connection even on error', async () => {
    const mockClose = jest.fn().mockResolvedValue(undefined);

    jest.resetModules();
    jest.doMock('mongodb', () => {
      const actual = jest.requireActual('mongodb');
      return {
        ...actual,
        MongoClient: jest.fn().mockImplementation(() => ({
          connect: jest.fn().mockResolvedValue(undefined),
          close: mockClose,
          db: jest.fn().mockReturnValue({
            collection: (name: string) => ({
              aggregate: jest.fn(() => ({ toArray: jest.fn().mockRejectedValue(new Error('DB down')) })),
              deleteMany: jest.fn(),
              createIndex: jest.fn(),
            }),
          }),
        })),
      };
    });

    const mod = require('../DedupeAlbumRole.activity');
    const activity = new mod.DedupeAlbumRoleActivity();

    await expect(activity.dedupeAlbumRole({ database: 'test-db' })).rejects.toThrow('DB down');
    expect(mockClose).toHaveBeenCalled();
  });
});
