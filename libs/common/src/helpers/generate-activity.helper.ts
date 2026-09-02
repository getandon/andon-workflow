import { ObjectId } from 'mongodb';

export interface ActivityLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  success: (msg: string) => void;
  failure: (msg: string, err: unknown) => void;
}

export interface UserInfo {
  name?: string;
  email: string;
}

export async function fetchUserMap(
  db: any,
  userIds: string[],
): Promise<Map<string, UserInfo>> {
  const userMap = new Map<string, UserInfo>();
  const hexIds = [...new Set(userIds.filter((h: string) => h && h.length === 24))];

  if (hexIds.length === 0) return userMap;

  const users = await db
    .collection('user')
    .find({ _id: { $in: hexIds.map((id: string) => new ObjectId(id)) } })
    .project({
      _id: 1,
      name: 1,
      email: 1,
    })
    .toArray();

  for (const u of users) {
    userMap.set(u._id.toHexString(), { name: u.name, email: u.email });
  }

  return userMap;
}

export interface ClearTargetActivityResult {
  eventsDeleted: number;
  summariesDeleted: number;
  progressDeleted: number;
}

export async function clearTargetActivity(
  db: any,
  verbs: string[],
  sourceCollections: string[],
): Promise<ClearTargetActivityResult> {
  const events = await db.collection('activity_event').deleteMany({ verb: { $in: verbs } });
  const summaries = await db.collection('activity_summary').deleteMany({ verb: { $in: verbs } });
  const progress = await db.collection('backfill_progress').deleteMany({ sourceCollection: { $in: sourceCollections } });
  return {
    eventsDeleted: events.deletedCount ?? 0,
    summariesDeleted: summaries.deletedCount ?? 0,
    progressDeleted: progress.deletedCount ?? 0,
  };
}

export async function insertActivityEvent(
  db: any,
  event: {
    _id: ObjectId;
    eventId: string;
    albumId?: ObjectId;
    userId?: ObjectId;
    actorId: ObjectId;
    actorName: string;
    verb: string;
    targetType: string;
    targetId: ObjectId;
    metadata: Record<string, unknown>;
    visibleToRoles: string[];
    visibleToUserIds: ObjectId[];
    visibilityVersion: number;
    createdAt: number;
  },
): Promise<void> {
  await db.collection('activity_event').insertOne(event);
}

export async function markProcessed(
  db: any,
  sourceCollection: string,
  sourceIds: ObjectId[],
): Promise<void> {
  if (sourceIds.length === 0) return;
  try {
    await db.collection('backfill_progress').insertMany(
      sourceIds.map(id => ({ sourceCollection, sourceId: id })),
      { ordered: false },
    );
  } catch (err: any) {
    if (err.code !== 11000) throw err;
  }
}

const ensuredBackfillIndexes = new Set<string>();

async function ensureBackfillProgressIndex(db: any): Promise<void> {
  const name: string | undefined = db?.databaseName;
  if (name && ensuredBackfillIndexes.has(name)) return;
  try {
    await db.collection('backfill_progress').createIndex?.({ sourceCollection: 1, sourceId: -1 });
  } catch {
    // non-fatal: index may already exist with a different spec, or permissions restrict creation
  }
  if (name) ensuredBackfillIndexes.add(name);
}

export async function findUnprocessedBatch(
  db: any,
  sourceCollection: string,
  batchSize: number,
): Promise<any[]> {
  await ensureBackfillProgressIndex(db);

  const last = await db
    .collection('backfill_progress')
    .find({ sourceCollection })
    .sort({ sourceId: -1 })
    .limit(1)
    .toArray();

  const lastId = last[0]?.sourceId;

  const query = lastId ? { _id: { $gt: lastId } } : {};

  return await db
    .collection(sourceCollection)
    .find(query)
    .sort({ _id: 1 })
    .limit(batchSize)
    .toArray();
}

export async function upsertActivitySummary(
  db: any,
  match: Record<string, unknown>,
  doc: Record<string, unknown>,
  eventId: string,
  log: ActivityLog,
): Promise<void> {
  try {
    await db.collection('activity_summary').updateOne(
      match,
      doc,
      { upsert: true },
    );
  } catch (err: any) {
    if (err.code === 11000) {
      log.warn(`Duplicate summary upsert for ${eventId}, continuing`);
    } else {
      throw err;
    }
  }
}
