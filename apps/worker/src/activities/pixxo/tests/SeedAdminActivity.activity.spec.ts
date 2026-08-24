import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { SeedAdminActivity } from '../SeedAdminActivity.activity';

jest.mock('@temporalio/activity', () => ({
  Context: {
    current: jest.fn(() => ({
      heartbeat: jest.fn(),
      info: { workflowExecution: { workflowId: 'test-wf' }, activityType: 'seedAdminActivity' },
    })),
  },
}));

jest.mock('../../../job-log', () => ({
  jobLog: {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), success: jest.fn(), failure: jest.fn(),
  },
}));

jest.setTimeout(20000);

const U1 = new ObjectId('0000000000000000000000a1');
const U2 = new ObjectId('0000000000000000000000a2');
const U3 = new ObjectId('0000000000000000000000a3');
const AL1 = new ObjectId('0000000000000000000000b1');
const AL2 = new ObjectId('0000000000000000000000b2');
const M1 = new ObjectId('0000000000000000000000c1');
const M2 = new ObjectId('0000000000000000000000c2');
const M3 = new ObjectId('0000000000000000000000c3');
const IN1 = new ObjectId('0000000000000000000000d1');
const IN2 = new ObjectId('0000000000000000000000d2');
const O1 = new ObjectId('0000000000000000000000e1');
const O2 = new ObjectId('0000000000000000000000e2');
const O3 = new ObjectId('0000000000000000000000e3');
const O4 = new ObjectId('0000000000000000000000e4');

async function seedSource(src: ReturnType<MongoClient['db']>) {
  await src.collection('user').insertMany([
    { _id: U1, email: 'u1@test.dev', createdAt: 1700000000000 },
    { _id: U2, email: 'u2@test.dev', createdAt: 1700100000000 },
    { _id: U3, email: 'u3@test.dev', createdAt: 1700200000000 },
  ]);
  await src.collection('album').insertMany([
    { _id: AL1, name: 'Album One', type: 'STANDARD', date: 1700050000000, author: U1 },
    { _id: AL2, name: 'Album Two', type: 'PREMIUM', date: 1700150000000 },
  ]);
  await src.collection('media').insertMany([
    { _id: M1, album: AL1, author: U1, uploadAt: 1700060000000, formats: [{ size: 100 }] },
    { _id: M2, album: AL1, author: U2, uploadAt: 1700070000000, formats: [{ size: 200 }] },
    { _id: M3, album: AL2, author: U3, uploadAt: 1700080000000, formats: [{ size: 300 }] },
  ]);
  await src.collection('album_invite').insertMany([
    { _id: IN1, album: AL1, author: U1, inviteKey: 'inv1@key', createdAt: 1700030000000 },
    { _id: IN2, album: AL2, author: U3, email: 'inv2@test.dev', createdAt: 1700130000000 },
  ]);
  await src.collection('album_role').insertMany([
    { _id: new ObjectId('0000000000000000000000f1'), album: AL2, user: U3, userRole: 'OWNER', createdAt: 1700160000000 },
    { _id: new ObjectId('0000000000000000000000f2'), album: AL1, user: U2, userRole: 'EDITOR', createdAt: 1700090000000 },
  ]);
  await src.collection('packages').insertOne({
    _id: new ObjectId('0000000000000000000000f9'),
    name: 'Basic',
    items: [{ type: 'STORAGE', quantity: 10 }, { type: 'TRAFFIC', quantity: 20 }],
  });
  await src.collection('order').insertMany([
    {
      _id: O1, user: U1, createdAt: 1700040000000, status: 'COMPLETED', category: '',
      packageName: 'Basic', subtotal: 42, packageId: 'basic-1',
    },
    {
      _id: O2, user: U2, createdAt: 1700140000000, status: 'COMPLETED', category: 'ADDON',
      subtotal: 7, items: [{ type: 'YEAR', quantity: 1 }],
    },
    { _id: O3, user: U1, createdAt: 1700240000000, status: 'CANCELED', category: '', subtotal: 99 },
    { _id: O4, user: U2, createdAt: 1700340000000, status: 'COMPLETED', category: 'TRYON', subtotal: 5 },
  ]);
}

describe('SeedAdminActivity', () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let activity: SeedAdminActivity;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await client.db('album-server-db').dropDatabase();
    await client.db('pixo-admin-db').dropDatabase();
    await seedSource(client.db('album-server-db'));
    activity = new SeedAdminActivity();
  });

  it('completes even when the source contains skipped orders (CANCELED / TRYON)', async () => {
    const result = await activity.seedAdminActivity({ clearFirst: true, batchSize: 2 });

    expect(result.completed).toBe(true);
    expect(result.users).toBe(3);
    expect(result.albums).toBe(2);
    expect(result.media).toBe(3);
    expect(result.invites).toBe(2);
    expect(result.accepted).toBe(1);
    expect(result.ordersTotal).toBe(4);
    expect(result.ordersCompleted).toBe(3);
    expect(result.ordersSkippedStatus).toBe(1);
    expect(result.ordersSkippedCategory).toBe(1);
    expect(result.orders).toBe(2);
    expect(result.sells).toBe(2);
    expect(result.baseActivities).toBe(13);

    const dst = client.db('pixo-admin-db');
    await expect(dst.collection('base_activities').countDocuments()).resolves.toBe(13);
    await expect(dst.collection('sells').countDocuments()).resolves.toBe(2);
    await expect(dst.collection('sells').countDocuments({ type: 'package' })).resolves.toBe(1);
    await expect(dst.collection('sells').countDocuments({ type: 'feature' })).resolves.toBe(1);
    await expect(dst.collection('albums').findOne({ _id: AL1 })).resolves.toMatchObject({ medias: 2, invites: 1, accepted: 1 });
    await expect(dst.collection('albums').findOne({ _id: AL2 })).resolves.toMatchObject({ medias: 1 });
    const buyer = await dst.collection('users').findOne({ _id: U1 });
    expect(buyer?.endTime).toBeGreaterThan(0);
  });

  it('re-run without clearFirst resumes from the cursor instead of rescanning', async () => {
    await activity.seedAdminActivity({ clearFirst: true, batchSize: 2 });

    const result = await activity.seedAdminActivity({ batchSize: 2 });

    expect(result.completed).toBe(true);
    expect(result.users).toBe(0);
    expect(result.baseActivities).toBe(0);
    expect(result.ordersTotal).toBe(0);
    const dst = client.db('pixo-admin-db');
    await expect(dst.collection('base_activities').countDocuments()).resolves.toBe(13);
    await expect(dst.collection('sells').countDocuments()).resolves.toBe(2);
  });

  it('labels unmatched orders as "Unknown" instead of a raw order id', async () => {
    const src = client.db('album-server-db');
    await src.collection('order').deleteMany({});
    await src.collection('order').insertMany([
      {
        _id: O1, user: U1, createdAt: 1700040000000, status: 'COMPLETED', category: '',
        items: [{ type: 'SIZE', quantity: 30 * 1024 * 1024 * 1024 }],
      },
    ]);

    await activity.seedAdminActivity({ clearFirst: true, batchSize: 2 });

    const dst = client.db('pixo-admin-db');
    const sells = await dst.collection('sells').find({ type: 'package' }).toArray();
    expect(sells).toHaveLength(1);
    expect(sells[0].name).toBe('Unknown');
  });
});
