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
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    failure: jest.fn(),
  },
}));

jest.mock('@andon-workflow/lib', () => {
  const actual = jest.requireActual('@andon-workflow/lib');
  return {
    ...actual,
    requiredEnv: jest.fn().mockReturnValue('mongodb://localhost:27017'),
  };
});

describe('GenerateAlbumActivity', () => {
  let mockConnect: jest.Mock;
  let mockClose: jest.Mock;
  let mockCollectionFns: Record<string, any>;
  let generateAlbumActivity: any;

  beforeEach(() => {
    jest.resetModules();
    mockCollectionFns = {};
    mockConnect = jest.fn().mockResolvedValue(undefined);
    mockClose = jest.fn().mockResolvedValue(undefined);

    const mockDb = {
      collection: jest.fn((name: string) => {
        if (!mockCollectionFns[name]) {
          mockCollectionFns[name] = {
            find: jest.fn(),
            findOne: jest.fn().mockResolvedValue(null),
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
          connect: mockConnect,
          close: mockClose,
          db: jest.fn().mockReturnValue(mockDb),
        })),
      };
    });

    const mod = require('../GenerateAlbumActivity.activity');
    generateAlbumActivity = new mod.GenerateAlbumActivity();
  });

  function setupAlbumDocs(docs: any[]) {
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

    const userCursor = {
      project: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([
        { _id: new ObjectId(docs[0]?.author || '507f1f77bcf86cd799439011'), name: 'Test User', email: 'test@example.com' },
      ]),
    };

    mockCollectionFns['album'] = {
      find: jest.fn(() => cursor),
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    mockCollectionFns['user'] = {
      find: jest.fn(() => userCursor),
    };
    mockCollectionFns['activity_event'] = {
      insertOne: jest.fn().mockImplementation(async (doc: any) => {
        if (mockCollectionFns['activity_event']._existing?.has(doc.eventId)) {
          throw { code: 11000 };
        }
        mockCollectionFns['activity_event']._existing?.add(doc.eventId);
        return { insertedId: doc._id };
      }),
      _existing: new Set<string>(),
    };
    mockCollectionFns['activity_summary'] = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
  }

  it('should create activity events for all albums', async () => {
    const authorId = new ObjectId();
    const albumId = new ObjectId();
    const albums = [
      { _id: albumId, author: authorId, name: 'Wedding Album', type: 'WEDDING', date: 1700000000000, createdAt: 1700000000000 },
    ];
    setupAlbumDocs(albums);

    const result = await generateAlbumActivity.generateAlbumActivity({ database: 'test-db' });

    expect(result.completed).toBe(true);
    expect(result.totalAlbums).toBe(1);
    expect(result.eventsCreated).toBe(1);

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.verb).toBe('CREATED');
    expect(insertCall.targetType).toBe('ALBUM');
    expect(insertCall.eventId).toBe(`Backfill_AlbumCreated_${albumId.toHexString()}`);
    expect(insertCall.createdAt).toBe(1700000000000);
    expect(insertCall.actorName).toBe('Test User');
  });

  it('should find owner from album_role when album has no author', async () => {
    const ownerId = new ObjectId();
    const albumId = new ObjectId();
    const albums = [
      { _id: albumId, author: null, name: 'Orphan Album', type: 'WEDDING', date: 1700000000000, createdAt: 1700000000000 },
    ];
    setupAlbumDocs(albums);

    const ownerRole = { user: ownerId };
    const ownerUser = { _id: ownerId, name: 'Owner From Role', email: 'owner@example.com' };
    mockCollectionFns['album_role'] = {
      findOne: jest.fn().mockResolvedValue(ownerRole),
    };
    mockCollectionFns['user'] = {
      find: jest.fn(() => { throw new Error('should not be called'); }),
      findOne: jest.fn().mockResolvedValue(ownerUser),
    };

    const result = await generateAlbumActivity.generateAlbumActivity({ database: 'test-db' });

    expect(result.eventsCreated).toBe(1);
    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.actorId.toHexString()).toBe(ownerId.toHexString());
    expect(insertCall.actorName).toBe('Owner From Role');
  });

  it('should use placeholder actor for albums without author', async () => {
    const albumId = new ObjectId();
    const albums = [
      { _id: albumId, author: null, name: 'Orphan Album', type: 'WEDDING', date: 1700000000000, createdAt: 1700000000000 },
    ];
    setupAlbumDocs(albums);

    const result = await generateAlbumActivity.generateAlbumActivity({ database: 'test-db' });

    expect(result.totalAlbums).toBe(1);
    expect(result.eventsCreated).toBe(1);
    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.actorId.toHexString()).toBe('000000000000000000000000');
  });

  it('should fall back to _id timestamp when createdAt is null', async () => {
    const authorId = new ObjectId();
    const albumId = new ObjectId();
    const ts = albumId.getTimestamp().getTime();
    const albums = [
      { _id: albumId, author: authorId, name: 'Null CreatedAt', type: 'WEDDING', date: 1700000000000, createdAt: null },
    ];
    setupAlbumDocs(albums);

    await generateAlbumActivity.generateAlbumActivity({ database: 'test-db' });

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.createdAt).toBe(ts);
  });

  it('should fall back to _id timestamp when createdAt is missing', async () => {
    const authorId = new ObjectId();
    const albumId = new ObjectId();
    const ts = albumId.getTimestamp().getTime();
    const albums = [
      { _id: albumId, author: authorId, name: 'No CreatedAt', type: 'WEDDING', date: 1700000000000, createdAt: 0 },
    ];
    setupAlbumDocs(albums);

    await generateAlbumActivity.generateAlbumActivity({ database: 'test-db' });

    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(insertCall.createdAt).toBe(ts);
  });

  it('should be idempotent on re-run (duplicate eventId)', async () => {
    const authorId = new ObjectId();
    const albumId = new ObjectId();
    const albums = [
      { _id: albumId, author: authorId, name: 'Album 1', type: 'WEDDING', date: 1700000000000, createdAt: 1700000000000 },
    ];
    setupAlbumDocs(albums);

    const result1 = await generateAlbumActivity.generateAlbumActivity({ database: 'test-db' });
    expect(result1.eventsCreated).toBe(1);

    jest.resetModules();
    const callCount2 = 0;
    setupAlbumDocs(albums);
    mockCollectionFns['activity_event']._existing = new Set([`Backfill_AlbumCreated_${albumId.toHexString()}`]);

    const result2 = await generateAlbumActivity.generateAlbumActivity({ database: 'test-db' });
    expect(result2.eventsCreated).toBe(0);
  });

  it('should handle string author IDs (not ObjectId)', async () => {
    const authorIdStr = '507f1f77bcf86cd799439011';
    const albumId = new ObjectId();
    const albums = [
      { _id: albumId, author: authorIdStr, name: 'String Author', type: 'WEDDING', date: 1700000000000, createdAt: 1700000000000 },
    ];
    setupAlbumDocs(albums);

    const result = await generateAlbumActivity.generateAlbumActivity({ database: 'test-db' });
    expect(result.eventsCreated).toBe(1);
  });
});