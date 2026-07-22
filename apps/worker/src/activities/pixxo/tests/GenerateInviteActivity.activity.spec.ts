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

function makeCursor(docs: any[]) {
  let callCount = 0;
  return {
    project: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockImplementation(async () => callCount++ === 0 ? docs : []),
  };
}

describe('GenerateInviteActivity', () => {
  let mockConnect: jest.Mock;
  let mockClose: jest.Mock;
  let mockCollectionFns: Record<string, any>;
  let generateInviteActivity: any;

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
            insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
            updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
            findOne: jest.fn().mockResolvedValue(null),
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

    const mod = require('../GenerateInviteActivity.activity');
    generateInviteActivity = new mod.GenerateInviteActivity();
  });

  function setupCollection(name: string, cursor: any, findOne?: any) {
    const obj: any = { find: jest.fn(() => cursor) };
    if (findOne !== undefined) obj.findOne = findOne;
    mockCollectionFns[name] = obj;
  }

  function setupActivityEvent() {
    mockCollectionFns['activity_event'] = { insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }) };
    mockCollectionFns['activity_summary'] = { updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
  }

  it('should create INVITED events for all invites (including removed)', async () => {
    const authorId = new ObjectId();
    const albumId = new ObjectId();
    const invites = [
      { _id: new ObjectId(), album: albumId, author: authorId, inviteKey: 'guest@example.com', createdAt: 1700000000000 },
      { _id: new ObjectId(), album: albumId, author: authorId, inviteKey: 'guest2@example.com', createdAt: 1700000000001 },
    ];

    setupCollection('album_invite', makeCursor(invites), jest.fn().mockResolvedValue(null));
    setupCollection('user', makeCursor([{ _id: authorId, name: 'Inviter', email: 'inviter@example.com' }]));
    setupActivityEvent();
    // Empty data for accepted phase
    setupCollection('album_role', makeCursor([]));
    setupCollection('album', makeCursor([]));

    const result = await generateInviteActivity.generateInviteActivity({ database: 'test-db' });

    expect(result.completed).toBe(true);
    expect(result.invitedCreated).toBe(2);
    expect(result.invitesProcessed).toBe(2);
    const firstInsert = mockCollectionFns['activity_event'].insertOne.mock.calls[0][0];
    expect(firstInsert.verb).toBe('INVITED');
    expect(firstInsert.metadata.invitees).toEqual(['guest@example.com']);
  });

  it('should use album_role as truth and create ACCEPTED for all non-author members', async () => {
    const albumAuthor = new ObjectId();
    const albumId = new ObjectId();
    const userId = new ObjectId();
    const roles = [{ _id: new ObjectId(), album: albumId, user: userId, userRole: 'GUEST', createdAt: 1700000000000 }];

    setupCollection('album_role', makeCursor(roles));
    setupCollection('album', makeCursor([{ _id: albumId, author: albumAuthor }]));
    setupCollection('user', makeCursor([{ _id: userId, name: 'Member', email: 'member@example.com' }, { _id: albumAuthor, name: 'Owner', email: 'owner@example.com' }]));
    setupCollection('album_invite', makeCursor([]), jest.fn().mockResolvedValue(null));
    setupActivityEvent();

    const result = await generateInviteActivity.generateInviteActivity({ database: 'test-db' });

    expect(result.completed).toBe(true);
    expect(result.acceptedCreated).toBe(1);
    expect(result.rolesProcessed).toBe(1);
    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls.find(
      (c: any) => c[0].verb === 'ACCEPTED'
    );
    expect(insertCall).toBeDefined();
    expect(insertCall[0].verb).toBe('ACCEPTED');
    expect(insertCall[0].createdAt).toBe(1700000000000);
    expect(insertCall[0].actorName).toBe('Member');
  });

  it('should skip album author in ACCEPTED phase', async () => {
    const albumAuthor = new ObjectId();
    const albumId = new ObjectId();
    const roles = [{ _id: new ObjectId(), album: albumId, user: albumAuthor, userRole: 'OWNER', createdAt: 1700000000000 }];

    setupCollection('album_role', makeCursor(roles));
    setupCollection('album', makeCursor([{ _id: albumId, author: albumAuthor }]));
    setupCollection('user', makeCursor([{ _id: albumAuthor, name: 'Owner', email: 'owner@example.com' }]));
    setupCollection('album_invite', makeCursor([{ _id: new ObjectId(), album: albumId, author: albumAuthor, inviteKey: 'owner@example.com', createdAt: 1700000000000 }]), jest.fn().mockResolvedValue(null));
    setupActivityEvent();

    const result = await generateInviteActivity.generateInviteActivity({ database: 'test-db' });
    expect(result.acceptedCreated).toBe(0);
  });

  it('should fall back to role._id timestamp when role.createdAt is 0', async () => {
    const albumAuthor = new ObjectId();
    const roleId = new ObjectId();
    const expectedTs = roleId.getTimestamp().getTime();
    const albumId = new ObjectId();
    const userId = new ObjectId();
    const roles = [{ _id: roleId, album: albumId, user: userId, userRole: 'GUEST', createdAt: 0 }];

    setupCollection('album_role', makeCursor(roles));
    setupCollection('album', makeCursor([{ _id: albumId, author: albumAuthor }]));
    setupCollection('user', makeCursor([{ _id: userId, name: 'Member', email: 'member@example.com' }, { _id: albumAuthor, name: 'Owner', email: 'owner@example.com' }]));
    setupCollection('album_invite', makeCursor([]), jest.fn().mockResolvedValue(null));
    setupActivityEvent();

    await generateInviteActivity.generateInviteActivity({ database: 'test-db' });
    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls.find(
      (c: any) => c[0].verb === 'ACCEPTED'
    );
    expect(insertCall[0].createdAt).toBe(expectedTs);
  });

  it('should fall back to role._id timestamp when role.createdAt is null', async () => {
    const albumAuthor = new ObjectId();
    const roleId = new ObjectId();
    const expectedTs = roleId.getTimestamp().getTime();
    const albumId = new ObjectId();
    const userId = new ObjectId();
    const roles = [{ _id: roleId, album: albumId, user: userId, userRole: 'GUEST', createdAt: null }];

    setupCollection('album_role', makeCursor(roles));
    setupCollection('album', makeCursor([{ _id: albumId, author: albumAuthor }]));
    setupCollection('user', makeCursor([{ _id: userId, name: 'Member', email: 'member@example.com' }, { _id: albumAuthor, name: 'Owner', email: 'owner@example.com' }]));
    setupCollection('album_invite', makeCursor([]), jest.fn().mockResolvedValue(null));
    setupActivityEvent();

    await generateInviteActivity.generateInviteActivity({ database: 'test-db' });
    const insertCall = mockCollectionFns['activity_event'].insertOne.mock.calls.find(
      (c: any) => c[0].verb === 'ACCEPTED'
    );
    expect(insertCall[0].createdAt).toBe(expectedTs);
  });

  it('should handle string IDs in album_role', async () => {
    const albumAuthor = new ObjectId();
    const albumIdStr = '507f1f77bcf86cd799439011';
    const userIdStr = '507f1f77bcf86cd799439022';
    const roles = [{ _id: new ObjectId(), album: albumIdStr, user: userIdStr, userRole: 'GUEST', createdAt: 1700000000000 }];

    setupCollection('album_role', makeCursor(roles));
    setupCollection('album', makeCursor([{ _id: new ObjectId(albumIdStr), author: albumAuthor }]));
    setupCollection('user', makeCursor([{ _id: new ObjectId(userIdStr), name: 'String Member', email: 'str@example.com' }, { _id: albumAuthor, name: 'Owner', email: 'owner@example.com' }]));
    setupCollection('album_invite', makeCursor([]), jest.fn().mockResolvedValue(null));
    setupActivityEvent();

    const result = await generateInviteActivity.generateInviteActivity({ database: 'test-db' });
    expect(result.acceptedCreated).toBe(1);
  });
});