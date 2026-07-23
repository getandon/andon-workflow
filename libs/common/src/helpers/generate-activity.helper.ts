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
