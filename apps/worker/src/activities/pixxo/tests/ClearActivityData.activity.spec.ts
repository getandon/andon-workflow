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

describe('ClearActivityDataActivity', () => {
  let mockCollectionFns: Record<string, any>;
  let clearActivityData: any;

  beforeEach(() => {
    jest.resetModules();
    mockCollectionFns = {};

    const mockDb = {
      collection: jest.fn((name: string) => {
        if (!mockCollectionFns[name]) {
          mockCollectionFns[name] = {
            deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
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

    const mod = require('../ClearActivityData.activity');
    clearActivityData = new mod.ClearActivityDataActivity();
  });

  it('should delete all documents from activity_event, activity_summary, and processed_bus_event', async () => {
    mockCollectionFns['activity_event'] = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 100 }) };
    mockCollectionFns['activity_summary'] = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 50 }) };
    mockCollectionFns['processed_bus_event'] = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 25 }) };

    const result = await clearActivityData.clearActivityData({ database: 'test-db' });

    expect(result.completed).toBe(true);
    expect(result.activityEventsDeleted).toBe(100);
    expect(result.activitySummariesDeleted).toBe(50);
    expect(result.processedBusEventsDeleted).toBe(25);
  });

  it('should call deleteMany with empty filter (all docs)', async () => {
    mockCollectionFns['activity_event'] = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) };
    mockCollectionFns['activity_summary'] = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) };
    mockCollectionFns['processed_bus_event'] = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) };

    await clearActivityData.clearActivityData({ database: 'test-db' });

    expect(mockCollectionFns['activity_event'].deleteMany).toHaveBeenCalledWith({});
    expect(mockCollectionFns['activity_summary'].deleteMany).toHaveBeenCalledWith({});
    expect(mockCollectionFns['processed_bus_event'].deleteMany).toHaveBeenCalledWith({});
  });

  it('should handle empty collections gracefully', async () => {
    mockCollectionFns['activity_event'] = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) };
    mockCollectionFns['activity_summary'] = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) };
    mockCollectionFns['processed_bus_event'] = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) };

    const result = await clearActivityData.clearActivityData({ database: 'test-db' });

    expect(result.completed).toBe(true);
    expect(result.activityEventsDeleted).toBe(0);
    expect(result.activitySummariesDeleted).toBe(0);
    expect(result.processedBusEventsDeleted).toBe(0);
  });

  it('should close the client connection even on error', async () => {
    const mockClose = jest.fn().mockResolvedValue(undefined);
    const errCollections: Record<string, any> = {
      activity_event: { deleteMany: jest.fn().mockRejectedValue(new Error('DB down')) },
      activity_summary: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) },
      processed_bus_event: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) },
    };

    jest.resetModules();
    jest.doMock('mongodb', () => {
      const actual = jest.requireActual('mongodb');
      return {
        ...actual,
        MongoClient: jest.fn().mockImplementation(() => ({
          connect: jest.fn().mockResolvedValue(undefined),
          close: mockClose,
          db: jest.fn().mockReturnValue({
            collection: (name: string) => errCollections[name] ?? { deleteMany: jest.fn() },
          }),
        })),
      };
    });

    const mod = require('../ClearActivityData.activity');
    const activity = new mod.ClearActivityDataActivity();

    await expect(activity.clearActivityData({ database: 'test-db' })).rejects.toThrow('DB down');
    expect(mockClose).toHaveBeenCalled();
  });
});