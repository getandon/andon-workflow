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

describe('GenerateMediaActivity', () => {
  let mockCollectionFns: Record<string, any>;
  let generateMediaActivity: any;
  let mockClose: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    mockCollectionFns = {};
    mockClose = jest.fn().mockResolvedValue(undefined);

    const mockDb = {
      collection: jest.fn((name: string) => {
        if (!mockCollectionFns[name]) {
          mockCollectionFns[name] = {
            find: jest.fn(),
            insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
            updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
            findOne: jest.fn().mockResolvedValue({ name: 'Test User', email: 'test@example.com' }),
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
          close: mockClose,
          db: jest.fn().mockReturnValue(mockDb),
        })),
      };
    });

    const mod = require('../GenerateMediaActivity.activity');
    generateMediaActivity = new mod.GenerateMediaActivity();
  });

  function setupMediaDocs(docs: any[]) {
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

    mockCollectionFns['media'] = {
      find: jest.fn(() => cursor),
    };
    mockCollectionFns['user'] = {
      findOne: jest.fn().mockResolvedValue({ name: 'Uploader', email: 'up@example.com' }),
    };
    mockCollectionFns['activity_event'] = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };
    mockCollectionFns['activity_summary'] = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
  }

  it('should group media by album, author, and day', async () => {
    const albumId = new ObjectId();
    const authorId = new ObjectId();
    const ts = 1700000000000;
    const docs = [
      { _id: new ObjectId(), album: albumId, author: authorId, uploadAt: ts },
      { _id: new ObjectId(), album: albumId, author: authorId, uploadAt: ts + 1000 },
      { _id: new ObjectId(), album: albumId, author: authorId, uploadAt: ts + 2000 },
    ];
    setupMediaDocs(docs);

    const result = await generateMediaActivity.generateMediaActivity({ database: 'test-db' });

    expect(result.completed).toBe(true);
    expect(result.totalMedia).toBe(3);
    expect(result.groupsCreated).toBe(1);
    expect(result.eventsCreated).toBe(1);

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.verb).toBe('UPLOADED');
    expect(insertCall.metadata.mediaIds).toHaveLength(3);
    expect(insertCall.metadata.photoCount).toBe(3);
    expect(insertCall.createdAt).toBe(ts);
    expect(insertCall.actorName).toBe('Uploader');
  });

  it('should create separate groups for different dates', async () => {
    const albumId = new ObjectId();
    const authorId = new ObjectId();
    const docs = [
      { _id: new ObjectId(), album: albumId, author: authorId, uploadAt: 1700000000000 },
      { _id: new ObjectId(), album: albumId, author: authorId, uploadAt: 1710000000000 },
    ];
    setupMediaDocs(docs);

    const result = await generateMediaActivity.generateMediaActivity({ database: 'test-db' });

    expect(result.groupsCreated).toBe(2);
    expect(result.eventsCreated).toBe(2);
  });

  it('should fall back to _id timestamp when uploadAt is null', async () => {
    const albumId = new ObjectId();
    const authorId = new ObjectId();
    const mediaId = new ObjectId();
    const expectedTs = mediaId.getTimestamp().getTime();
    const docs = [
      { _id: mediaId, album: albumId, author: authorId, uploadAt: null },
    ];
    setupMediaDocs(docs);

    const result = await generateMediaActivity.generateMediaActivity({ database: 'test-db' });

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.createdAt).toBe(expectedTs);
  });

  it('should fall back to _id timestamp when uploadAt is 0', async () => {
    const albumId = new ObjectId();
    const authorId = new ObjectId();
    const mediaId = new ObjectId();
    const expectedTs = mediaId.getTimestamp().getTime();
    const docs = [
      { _id: mediaId, album: albumId, author: authorId, uploadAt: 0 },
    ];
    setupMediaDocs(docs);

    const result = await generateMediaActivity.generateMediaActivity({ database: 'test-db' });

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.createdAt).toBe(expectedTs);
  });

  it('should handle string album/author IDs', async () => {
    const albumIdStr = '507f1f77bcf86cd799439011';
    const authorIdStr = '507f1f77bcf86cd799439022';
    const docs = [
      { _id: new ObjectId(), album: albumIdStr, author: authorIdStr, uploadAt: 1700000000000 },
    ];
    setupMediaDocs(docs);

    const result = await generateMediaActivity.generateMediaActivity({ database: 'test-db' });
    expect(result.eventsCreated).toBe(1);
  });

  it('should be idempotent on duplicate eventId', async () => {
    const albumId = new ObjectId();
    const authorId = new ObjectId();
    const docs = [
      { _id: new ObjectId(), album: albumId, author: authorId, uploadAt: 1700000000000 },
    ];
    setupMediaDocs(docs);

    mockCollectionFns['activity_event'].insertOne = jest.fn().mockImplementation(async (doc: any) => {
      throw { code: 11000 };
    });

    const result = await generateMediaActivity.generateMediaActivity({ database: 'test-db' });
    expect(result.eventsCreated).toBe(0);
  });
});