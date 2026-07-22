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

describe('GenerateOrderActivity', () => {
  let mockCollectionFns: Record<string, any>;
  let generateOrderActivity: any;

  beforeEach(() => {
    jest.resetModules();
    mockCollectionFns = {};

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

    const mod = require('../GenerateOrderActivity.activity');
    generateOrderActivity = new mod.GenerateOrderActivity();
  });

  function setupOrderDocs(docs: any[]) {
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

    mockCollectionFns['order'] = {
      find: jest.fn(() => cursor),
    };

    const userIds = [...new Set(docs.filter(o => o.user).map(o => {
      if (typeof o.user === 'string') return o.user;
      return o.user?.toHexString?.() || String(o.user);
    }))];

    mockCollectionFns['user'] = {
      find: jest.fn(() => ({
        project: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(
          userIds.map(id => ({
            _id: new ObjectId(id),
            name: 'Buyer',
            email: 'buyer@example.com',
          })),
        ),
      })),
    };

    mockCollectionFns['activity_event'] = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };
    mockCollectionFns['activity_summary'] = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
  }

  it('should create PURCHASED events for all orders (including NEW status)', async () => {
    const userId = new ObjectId();
    const orderId = new ObjectId();
    const docs = [
      { _id: orderId, user: userId, createdAt: 1700000000000, status: 'CAPTURED' },
      { _id: new ObjectId(), user: userId, createdAt: 1700000000001, status: 'NEW' },
    ];
    setupOrderDocs(docs);

    const result = await generateOrderActivity.generateOrderActivity({ database: 'test-db' });

    expect(result.completed).toBe(true);
    expect(result.totalOrders).toBe(2);
    expect(result.eventsCreated).toBe(2);

    const firstInsert = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(firstInsert.verb).toBe('PURCHASED');
    expect(firstInsert.targetType).toBe('PACKAGE');
    expect(firstInsert.visibleToUserIds).toHaveLength(1);
    expect(firstInsert.actorName).toBe('Buyer');
  });

  it('should not set albumId (user-scoped event)', async () => {
    const userId = new ObjectId();
    const orderId = new ObjectId();
    setupOrderDocs([
      { _id: orderId, user: userId, createdAt: 1700000000000 },
    ]);

    await generateOrderActivity.generateOrderActivity({ database: 'test-db' });

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.albumId).toBeUndefined();
    expect(insertCall.userId).toBeDefined();
  });

  it('should fall back to _id timestamp when createdAt is null', async () => {
    const userId = new ObjectId();
    const orderId = new ObjectId();
    const expectedTs = orderId.getTimestamp().getTime();
    setupOrderDocs([
      { _id: orderId, user: userId, createdAt: null },
    ]);

    await generateOrderActivity.generateOrderActivity({ database: 'test-db' });

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.createdAt).toBe(expectedTs);
  });

  it('should fall back to _id timestamp when createdAt is 0', async () => {
    const userId = new ObjectId();
    const orderId = new ObjectId();
    const expectedTs = orderId.getTimestamp().getTime();
    setupOrderDocs([
      { _id: orderId, user: userId, createdAt: 0 },
    ]);

    await generateOrderActivity.generateOrderActivity({ database: 'test-db' });

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.createdAt).toBe(expectedTs);
  });

  it('should handle string user IDs', async () => {
    const userIdStr = '507f1f77bcf86cd799439011';
    const orderId = new ObjectId();
    setupOrderDocs([
      { _id: orderId, user: userIdStr, createdAt: 1700000000000 },
    ]);

    const result = await generateOrderActivity.generateOrderActivity({ database: 'test-db' });
    expect(result.eventsCreated).toBe(1);
  });

  it('should skip orders without user', async () => {
    const orderId = new ObjectId();
    setupOrderDocs([
      { _id: orderId, user: null, createdAt: 1700000000000 },
    ]);

    const result = await generateOrderActivity.generateOrderActivity({ database: 'test-db' });
    expect(result.eventsCreated).toBe(0);
  });

  it('should be idempotent on duplicate eventId', async () => {
    const userId = new ObjectId();
    setupOrderDocs([
      { _id: new ObjectId(), user: userId, createdAt: 1700000000000 },
    ]);

    mockCollectionFns['activity_event'].insertOne = jest.fn().mockImplementation(async (doc: any) => {
      throw { code: 11000 };
    });

    const result = await generateOrderActivity.generateOrderActivity({ database: 'test-db' });
    expect(result.eventsCreated).toBe(0);
  });
});