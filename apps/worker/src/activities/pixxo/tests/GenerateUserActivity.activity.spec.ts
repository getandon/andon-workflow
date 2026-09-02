import { ObjectId } from 'mongodb';

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

describe('GenerateUserActivity', () => {
  let mockCollectionFns: Record<string, any>;
  let generateUserActivity: any;
  let progressData: any[];

  beforeEach(() => {
    jest.resetModules();
    mockCollectionFns = {};
    progressData = [];

    const mockDb = {
      collection: jest.fn((name: string) => {
        if (!mockCollectionFns[name]) {
          mockCollectionFns[name] = {
            find: jest.fn(),
            insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
            updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
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

    const mod = require('../GenerateUserActivity.activity');
    generateUserActivity = new mod.GenerateUserActivity();
  });

  function setupUserDocs(docs: any[]) {
    let callCount = 0;
    const cursor = {
      project: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockImplementation(async () => {
        const result = callCount === 0 ? docs : [];
        callCount++;
        return result;
      }),
    };

    mockCollectionFns['user'] = {
      find: jest.fn(() => cursor),
    };

    mockCollectionFns['backfill_progress'] = {
      find: jest.fn(() => ({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(progressData),
      })),
      insertMany: jest.fn().mockResolvedValue({ insertedCount: 0 }),
    };

    mockCollectionFns['activity_event'] = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };
    mockCollectionFns['activity_summary'] = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
  }

  it('should create SIGNED_UP events for all users', async () => {
    const userId = new ObjectId();
    const docs = [
      { _id: userId, name: 'Anas', email: 'anas@example.com' },
      { _id: new ObjectId(), name: 'Sara', email: 'sara@example.com' },
    ];
    setupUserDocs(docs);

    const result = await generateUserActivity.generateUserActivity({ database: 'test-db' });

    expect(result.completed).toBe(true);
    expect(result.totalUsers).toBe(2);
    expect(result.eventsCreated).toBe(2);

    const firstInsert = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(firstInsert.verb).toBe('SIGNED_UP');
    expect(firstInsert.targetType).toBe('ACCOUNT');
    expect(firstInsert.visibleToUserIds).toHaveLength(1);
    expect(firstInsert.actorName).toBe('Anas');
    expect(firstInsert.metadata).toEqual({ email: 'anas@example.com' });

    expect(mockCollectionFns['backfill_progress'].insertMany).toHaveBeenCalled();
  });

  it('should not set albumId (user-scoped event)', async () => {
    const userId = new ObjectId();
    setupUserDocs([
      { _id: userId, name: 'Anas', email: 'anas@example.com' },
    ]);

    await generateUserActivity.generateUserActivity({ database: 'test-db' });

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.albumId).toBeUndefined();
    expect(insertCall.userId).toBeDefined();
  });

  it('should fall back to _id timestamp when createdAt is null', async () => {
    const userId = new ObjectId();
    const expectedTs = userId.getTimestamp().getTime();
    setupUserDocs([
      { _id: userId, name: 'Anas', email: 'anas@example.com', createdAt: null },
    ]);

    await generateUserActivity.generateUserActivity({ database: 'test-db' });

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.createdAt).toBe(expectedTs);
  });

  it('should fall back to _id timestamp when createdAt is 0', async () => {
    const userId = new ObjectId();
    const expectedTs = userId.getTimestamp().getTime();
    setupUserDocs([
      { _id: userId, name: 'Anas', email: 'anas@example.com', createdAt: 0 },
    ]);

    await generateUserActivity.generateUserActivity({ database: 'test-db' });

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.createdAt).toBe(expectedTs);
  });

  it('should derive actorName from email prefix when name is missing', async () => {
    const userId = new ObjectId();
    setupUserDocs([
      { _id: userId, email: 'anas@example.com' },
    ]);

    await generateUserActivity.generateUserActivity({ database: 'test-db' });

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.actorName).toBe('anas');
  });

  it('should be idempotent on duplicate eventId', async () => {
    setupUserDocs([
      { _id: new ObjectId(), name: 'Anas', email: 'anas@example.com' },
    ]);

    mockCollectionFns['activity_event'].insertOne = jest.fn().mockImplementation(async () => {
      throw { code: 11000 };
    });

    const result = await generateUserActivity.generateUserActivity({ database: 'test-db' });
    expect(result.eventsCreated).toBe(0);
  });
});
