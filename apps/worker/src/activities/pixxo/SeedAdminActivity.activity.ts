import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { createHash } from 'crypto';
import { AnyBulkWriteOperation, Collection, Db, MongoClient, ObjectId } from 'mongodb';
import {
  SeedAdminActivityInput,
  SeedAdminActivityOutput,
  requiredEnv,
  toHex,
  toObjectId,
} from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';
const DEFAULT_ADMIN_DATABASE = 'pixo-admin-db';
const DEFAULT_BATCH_SIZE = 100;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const PLACEHOLDER_HEX = '000000000000000000000000';
const ZERO_OBJECT_ID = new ObjectId(PLACEHOLDER_HEX);

interface DateParts {
  year: number;
  month: string;
  day: number;
  dayOfWeek: string;
}

function dateParts(ts: number): DateParts {
  const d = new Date(ts);
  return {
    year: d.getFullYear(),
    month: d.toLocaleString('en-US', { month: 'short' }),
    day: d.getDate(),
    dayOfWeek: d.toLocaleString('en-US', { weekday: 'short' }),
  };
}

function tsOf(doc: any, field = 'createdAt'): number {
  const t = Number(doc?.[field]);
  return t || (doc._id?.getTimestamp?.().getTime() ?? Date.now());
}

const GB = 1024 * 1024 * 1024;

function resolvePackageName(order: any, packages: any[]): string {
  if (order?.packageName) return String(order.packageName);

  const items = (order?.items ?? []) as any[];
  const sizeItem = items.find((i: any) => i.type === 'SIZE');
  const trafficItem = items.find((i: any) => i.type === 'TRAFFIC');
  const hasSize = Boolean(sizeItem);
  const hasTraffic = Boolean(trafficItem);
  const sizeGB = Math.round((Number(sizeItem?.quantity) || 0) / GB);
  const trafficGB = Math.round((Number(trafficItem?.quantity) || 0) / GB);
  const year = Number(items.find((i: any) => i.type === 'YEAR')?.quantity) || 0;

  const matches = (packages ?? []).filter((p: any) => {
    if (order?.category && p.category && String(p.category) !== String(order.category)) return false;
    const pi = (p.items ?? []) as any[];
    const storage = pi.find((x: any) => x.type === 'STORAGE');
    const traffic = pi.find((x: any) => x.type === 'TRAFFIC');
    if (hasSize || hasTraffic) {
      if (hasSize && (!storage || Number(storage.quantity) !== sizeGB)) return false;
      if (hasTraffic && (!traffic || Number(traffic.quantity) !== trafficGB)) return false;
    } else {
      if (storage || traffic) return false;
    }
    return true;
  });

  if (matches.length === 1) {
    return String(matches[0].name ?? matches[0].id);
  }
  if (matches.length > 1) {
    const exact = matches.find((p: any) => {
      const dur = ((p.items ?? []) as any[]).find((x: any) => x.type === 'DURATION');
      return !dur || (year > 0 && Math.abs(Number(dur.quantity) - year) < 0.01);
    });
    return String((exact ?? matches[0]).name ?? (exact ?? matches[0]).id);
  }

  if (order?.packageId) return String(order.packageId);
  if (order?._id) return (order._id.toHexString?.() ?? String(order._id));
  return String(order?.id ?? '');
}

function derivedObjectId(...parts: (string | ObjectId)[]): ObjectId {
  const key = parts.map((p) => (p instanceof ObjectId ? p.toHexString() : String(p))).join(':');
  return new ObjectId(createHash('md5').update(key).digest('hex').slice(0, 24));
}

async function writeBulk(collection: Collection, ops: AnyBulkWriteOperation[]): Promise<void> {
  if (ops.length === 0) return;
  try {
    await collection.bulkWrite(ops, { ordered: false });
  } catch (err: any) {
    const writeErrors: any[] = err?.writeErrors ?? [];
    const allDupes =
      (writeErrors.length > 0 && writeErrors.every((e) => e?.code === 11000)) ||
      (writeErrors.length === 0 && err?.code === 11000);
    if (!allDupes) throw err;
  }
}

class UpsertAggregator {
  private entries = new Map<string, { filter: any; inc: Record<string, number>; addToSet: Record<string, any[]> }>();

  add(
    key: string,
    filter: any,
    inc: Record<string, number>,
    addToSet?: [string, any][],
  ): void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { filter, inc: {}, addToSet: {} };
      this.entries.set(key, entry);
    }
    for (const [field, value] of Object.entries(inc)) {
      entry.inc[field] = (entry.inc[field] ?? 0) + value;
    }
    if (addToSet) {
      for (const [field, id] of addToSet) {
        (entry.addToSet[field] ??= []).push(id);
      }
    }
  }

  toOps(upsert = true): AnyBulkWriteOperation[] {
    const ops: AnyBulkWriteOperation[] = [];
    for (const entry of this.entries.values()) {
      const update: any = {};
      if (Object.keys(entry.inc).length > 0) update.$inc = entry.inc;
      if (Object.keys(entry.addToSet).length > 0) {
        update.$addToSet = Object.fromEntries(
          Object.entries(entry.addToSet).map(([field, ids]) => [field, { $each: ids }]),
        );
      }
      if (Object.keys(update).length === 0) continue;
      ops.push({ updateOne: { filter: entry.filter, update, upsert } });
    }
    return ops;
  }
}

interface BackfillCursor {
  _id: string;
  lastId: ObjectId;
}

async function loadCursor(dst: Db, sourceCollection: string): Promise<ObjectId> {
  const doc = await dst.collection<BackfillCursor>('backfill_cursor').findOne({ _id: sourceCollection });
  return doc?.lastId instanceof ObjectId ? doc.lastId : ZERO_OBJECT_ID;
}

async function saveCursor(dst: Db, sourceCollection: string, lastId: ObjectId): Promise<void> {
  await dst
    .collection<BackfillCursor>('backfill_cursor')
    .updateOne({ _id: sourceCollection }, { $set: { lastId } }, { upsert: true });
}

@Injectable()
export class SeedAdminActivity {
  async seedAdminActivity(input: SeedAdminActivityInput = {}): Promise<SeedAdminActivityOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const adminDatabase = input.adminDatabase ?? process.env.ADMIN_DATABASE ?? DEFAULT_ADMIN_DATABASE;
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const client = new MongoClient(mongoUri, { authSource: database });

    const counts = {
      users: 0,
      albums: 0,
      media: 0,
      invites: 0,
      accepted: 0,
      orders: 0,
      ordersTotal: 0,
      ordersCompleted: 0,
      ordersSkippedStatus: 0,
      ordersSkippedCategory: 0,
      sells: 0,
      baseActivities: 0,
    };
    let batch = 0;

    try {
      await client.connect();
      const src = client.db(database);
      const dst = client.db(adminDatabase);

      jobLog.warn(
        `SeedAdminActivity: source.db="${database}" target.database="${adminDatabase}"`,
      );

      if (input.clearFirst) {
        for (const c of [
          'base_activities',
          'activities',
          'user_activities',
          'sells',
          'albums',
          'album_types',
          'users',
          'backfill_cursor',
        ]) {
          await dst.collection(c).deleteMany({});
        }
        jobLog.warn('Cleared admin analytics collections');
      }

      const forEachBatch = async (
        sourceCollection: string,
        phase: string,
        handleBatch: (docs: any[]) => Promise<Record<string, unknown>> | void,
      ): Promise<void> => {
        let lastId = await loadCursor(dst, sourceCollection);
        while (true) {
          const docs = await src
            .collection(sourceCollection)
            .find({ _id: { $gt: lastId } })
            .sort({ _id: 1 })
            .limit(batchSize)
            .toArray();
          if (docs.length === 0) break;

          const extras = (await handleBatch(docs)) ?? {};

          lastId = docs[docs.length - 1]._id;
          await saveCursor(dst, sourceCollection, lastId);
          batch++;
          Context.current().heartbeat({ phase, batch, ...extras });
        }
      };

      // ── Phase 1: users → signup ────────────────────────────────────────────
      await forEachBatch('user', 'users', async (users) => {
        const baseOps: AnyBulkWriteOperation[] = [];
        const activityAgg = new UpsertAggregator();
        const userActivityAgg = new UpsertAggregator();
        const userOps: AnyBulkWriteOperation[] = [];

        for (const u of users) {
          const date = dateParts(tsOf(u));
          const authorId = u._id;
          const dateKey = JSON.stringify(date);
          baseOps.push({
            insertOne: {
              document: {
                _id: derivedObjectId('user', u._id, 'signup'),
                ...date,
                authorId,
                type: 'signup',
                metadata: { email: u.email },
              },
            },
          });
          counts.baseActivities++;
          activityAgg.add(dateKey, date, { users: 1 });
          userActivityAgg.add(dateKey, date, { newUsers: 1 }, [['activeUserIds', authorId]]);
          userOps.push({
            updateOne: {
              filter: { _id: authorId },
              update: { $setOnInsert: { email: u.email } },
              upsert: true,
            },
          });
          counts.users++;
        }

        await writeBulk(dst.collection('base_activities'), baseOps);
        await writeBulk(dst.collection('activities'), activityAgg.toOps());
        await writeBulk(dst.collection('user_activities'), userActivityAgg.toOps());
        await writeBulk(dst.collection('users'), userOps);
        return { users: counts.users };
      });

      // ── Phase 2: albums → createAlbum ──────────────────────────────────────
      await forEachBatch('album', 'albums', async (albums) => {
        const withoutAuthor = albums.filter((a: any) => !a.author);
        const albumToOwner = new Map<string, ObjectId>();
        if (withoutAuthor.length > 0) {
          const ownerRoles = await src
            .collection('album_role')
            .find({ album: { $in: withoutAuthor.map((a: any) => a._id) }, userRole: 'OWNER' })
            .project({ album: 1, user: 1 })
            .toArray();
          for (const r of ownerRoles as any[]) {
            if (r.user) albumToOwner.set(r.album.toHexString(), r.user);
          }
        }

        const baseOps: AnyBulkWriteOperation[] = [];
        const activityAgg = new UpsertAggregator();
        const userActivityAgg = new UpsertAggregator();
        const albumOps: AnyBulkWriteOperation[] = [];
        const albumTypeAgg = new UpsertAggregator();

        for (const a of albums) {
          const date = dateParts(tsOf(a));
          const albumId = a._id;
          let authorId = toObjectId(a.author);
          if (!authorId) authorId = albumToOwner.get(albumId.toHexString()) ?? new ObjectId(PLACEHOLDER_HEX);
          const dateKey = JSON.stringify(date);

          const metadata = {
            albumId: albumId.toHexString(),
            name: a.name,
            type: String(a.type ?? ''),
            date: Number(a.date) || 0,
          };
          baseOps.push({
            insertOne: {
              document: {
                _id: derivedObjectId('album', albumId, 'createAlbum'),
                ...date,
                authorId,
                type: 'createAlbum',
                metadata,
              },
            },
          });
          counts.baseActivities++;
          activityAgg.add(dateKey, date, { albums: 1 });
          userActivityAgg.add(dateKey, date, { albums: 1 }, [['activeUserIds', authorId]]);
          albumOps.push({
            updateOne: {
              filter: { _id: albumId },
              update: {
                $setOnInsert: {
                  authorId,
                  name: a.name,
                  type: String(a.type ?? ''),
                  date: Number(a.date) || 0,
                  medias: 0,
                },
              },
              upsert: true,
            },
          });
          if (a.type !== undefined && a.type !== null) {
            albumTypeAgg.add(String(a.type), { type: a.type }, { value: 1 });
          }
          counts.albums++;
        }

        await writeBulk(dst.collection('base_activities'), baseOps);
        await writeBulk(dst.collection('activities'), activityAgg.toOps());
        await writeBulk(dst.collection('user_activities'), userActivityAgg.toOps());
        await writeBulk(dst.collection('albums'), albumOps);
        await writeBulk(dst.collection('album_types'), albumTypeAgg.toOps());
        return { albums: counts.albums };
      });

      // ── Phase 3: media → uploadImage ───────────────────────────────────────
      await forEachBatch('media', 'media', async (mediaDocs) => {
        const baseOps: AnyBulkWriteOperation[] = [];
        const activityAgg = new UpsertAggregator();
        const userActivityAgg = new UpsertAggregator();
        const albumAgg = new UpsertAggregator();

        for (const m of mediaDocs) {
          const date = dateParts(tsOf(m, 'uploadAt'));
          const albumId = toObjectId(m.album) ?? new ObjectId(PLACEHOLDER_HEX);
          const authorId = toObjectId(m.author) ?? new ObjectId(PLACEHOLDER_HEX);
          const size = (m.formats ?? []).reduce((s: number, f: any) => s + (Number(f.size) || 0), 0);
          const dateKey = JSON.stringify(date);

          baseOps.push({
            insertOne: {
              document: {
                _id: derivedObjectId('media', m._id, 'uploadImage'),
                ...date,
                authorId,
                type: 'uploadImage',
                metadata: {
                  albumId: toHex(m.album),
                  mediaId: m._id.toHexString(),
                  size,
                },
              },
            },
          });
          counts.baseActivities++;
          activityAgg.add(dateKey, date, { medias: 1, uploads: 1, size });
          userActivityAgg.add(dateKey, date, { medias: 1, uploads: 1 }, [['activeUserIds', authorId]]);
          albumAgg.add(albumId.toHexString(), { _id: albumId }, { medias: 1 });
          counts.media++;
        }

        await writeBulk(dst.collection('base_activities'), baseOps);
        await writeBulk(dst.collection('activities'), activityAgg.toOps());
        await writeBulk(dst.collection('user_activities'), userActivityAgg.toOps());
        await writeBulk(dst.collection('albums'), albumAgg.toOps(false));
        return { media: counts.media };
      });

      // ── Phase 4: invites → invite ──────────────────────────────────────────
      await forEachBatch('album_invite', 'invites', async (invites) => {
        const baseOps: AnyBulkWriteOperation[] = [];
        const userActivityAgg = new UpsertAggregator();
        const albumAgg = new UpsertAggregator();

        for (const i of invites) {
          const date = dateParts(tsOf(i));
          const albumId = toObjectId(i.album) ?? new ObjectId(PLACEHOLDER_HEX);
          const authorId = toObjectId(i.author) ?? new ObjectId(PLACEHOLDER_HEX);
          const dateKey = JSON.stringify(date);

          baseOps.push({
            insertOne: {
              document: {
                _id: derivedObjectId('album_invite', i._id, 'invite'),
                ...date,
                authorId,
                type: 'invite',
                metadata: {
                  albumId: toHex(i.album),
                  email: i.inviteKey ?? i.email ?? '',
                  inviteId: i._id.toHexString(),
                },
              },
            },
          });
          counts.baseActivities++;
          userActivityAgg.add(dateKey, date, { invites: 1 }, [['activeUserIds', authorId]]);
          albumAgg.add(albumId.toHexString(), { _id: albumId }, { invites: 1 });
          counts.invites++;
        }

        await writeBulk(dst.collection('base_activities'), baseOps);
        await writeBulk(dst.collection('user_activities'), userActivityAgg.toOps());
        await writeBulk(dst.collection('albums'), albumAgg.toOps(false));
        return { invites: counts.invites };
      });

      // ── Phase 5: roles → acceptInvite ──────────────────────────────────────
      await forEachBatch('album_role', 'roles', async (roles) => {
        const albumIds = [...new Set(roles.map((r: any) => toHex(r.album)))];
        const authorMap = new Map<string, string>();
        if (albumIds.length > 0) {
          const albums = await src
            .collection('album')
            .find({ _id: { $in: albumIds.map((id: string) => new ObjectId(id)) } })
            .project({ _id: 1, author: 1 })
            .toArray();
          for (const a of albums as any[]) {
            if (a.author) authorMap.set(a._id.toHexString(), toHex(a.author));
          }
        }

        const baseOps: AnyBulkWriteOperation[] = [];
        const userActivityAgg = new UpsertAggregator();
        const albumAgg = new UpsertAggregator();

        for (const r of roles) {
          if (r.userRole === 'OWNER') continue;
          const userId = toHex(r.user);
          const albumId = toHex(r.album);
          if (userId === authorMap.get(albumId)) continue;

          const date = dateParts(tsOf(r));
          const userObjId = toObjectId(r.user) ?? new ObjectId(PLACEHOLDER_HEX);
          const albumObjId = toObjectId(r.album) ?? new ObjectId(PLACEHOLDER_HEX);
          const dateKey = JSON.stringify(date);

          baseOps.push({
            insertOne: {
              document: {
                _id: derivedObjectId('album_role', r._id, 'acceptInvite'),
                ...date,
                authorId: userObjId,
                type: 'acceptInvite',
                metadata: {
                  inviteId: '',
                  type: String(r.userRole ?? ''),
                  albumId,
                },
              },
            },
          });
          counts.baseActivities++;
          userActivityAgg.add(dateKey, date, { accepted: 1 }, [['activeUserIds', userObjId]]);
          albumAgg.add(albumObjId.toHexString(), { _id: albumObjId }, { accepted: 1 });
          counts.accepted++;
        }

        await writeBulk(dst.collection('base_activities'), baseOps);
        await writeBulk(dst.collection('user_activities'), userActivityAgg.toOps());
        await writeBulk(dst.collection('albums'), albumAgg.toOps(false));
        return { accepted: counts.accepted };
      });

      // ── Phase 6: orders → purchase ─────────────────────────────────────────
      const packages = await src.collection('packages').find({}).toArray();
      let sampledStatuses: Array<{ status: string; category: string }> = [];
      await forEachBatch('order', 'orders', async (orders) => {
        const baseOps: AnyBulkWriteOperation[] = [];
        const sellOps: AnyBulkWriteOperation[] = [];
        const userActivityAgg = new UpsertAggregator();
        const endTimeByUser = new Map<string, number>();

        for (const o of orders) {
          counts.ordersTotal++;
          const status = String(o?.status ?? '').toUpperCase();
          if (status !== 'COMPLETED') {
            counts.ordersSkippedStatus++;
            if (sampledStatuses.length < 5) {
              sampledStatuses.push({ status, category: String(o?.category ?? '') });
            }
            continue;
          }
          counts.ordersCompleted++;

          const category = o.category ?? '';
          if (category === 'TRYON' || category === 'GUEST') {
            counts.ordersSkippedCategory++;
            continue;
          }

          const date = dateParts(tsOf(o));
          const userObjId = o.user && o.user._id ? o.user._id : toObjectId(o.user) ?? new ObjectId(PLACEHOLDER_HEX);
          const dateKey = JSON.stringify(date);

          const amount = o.subtotal ?? (o.items ?? []).reduce(
            (s: number, it: any) => s + (it.prices?.[0]?.price ?? 0),
            0,
          );
          const name = resolvePackageName(o, packages);
          const type = category === 'ADDON' ? 'purchaseFeature' : 'purchasePackage';
          const sellType = category === 'ADDON' ? 'feature' : 'package';

          baseOps.push({
            insertOne: {
              document: {
                _id: derivedObjectId('order', o._id, type),
                ...date,
                authorId: userObjId,
                type,
                metadata: {
                  packageId: o.packageId ?? o._id.toHexString(),
                  name,
                  amount,
                  currency: 'EUR',
                },
              },
            },
          });
          counts.baseActivities++;
          sellOps.push({
            insertOne: {
              document: {
                _id: derivedObjectId('sells', o._id, sellType),
                ...date,
                type: sellType,
                name,
                count: 1,
                revenue: amount,
              },
            },
          });
          counts.sells++;

          const duration = (o.items ?? []).find((it: any) => it.type === 'YEAR')?.quantity ?? 0;
          userActivityAgg.add(
            dateKey,
            date,
            category === 'ADDON' ? { features: 1 } : { packages: 1 },
            [['activeUserIds', userObjId]],
          );
          if (category !== 'ADDON') {
            endTimeByUser.set(userObjId.toHexString(), tsOf(o) + duration * ONE_YEAR_MS);
          }

          counts.orders++;
        }

        await writeBulk(dst.collection('base_activities'), baseOps);
        await writeBulk(dst.collection('sells'), sellOps);
        await writeBulk(dst.collection('user_activities'), userActivityAgg.toOps());
        await writeBulk(
          dst.collection('users'),
          [...endTimeByUser.entries()].map(([hex, endTime]) => ({
            updateOne: {
              filter: { _id: new ObjectId(hex) },
              update: { $set: { endTime } },
            },
          })),
        );
        return { orders: counts.orders, ordersTotal: counts.ordersTotal, sells: counts.sells };
      });

      if (counts.ordersTotal > 0 && counts.ordersCompleted === 0) {
        jobLog.warn(
          `SeedAdminActivity: ${counts.ordersTotal} order(s) found but 0 completed (skippedStatus=${counts.ordersSkippedStatus}, skippedCategory=${counts.ordersSkippedCategory}). Sample: ${JSON.stringify(sampledStatuses)}`,
        );
      }
      const sellCount = await dst.collection('sells').countDocuments({ type: 'package' });
      const uaCount = await dst.collection('user_activities').countDocuments();
      jobLog.warn(
        `SeedAdminActivity: admin db "${adminDatabase}" sells(type=package)=${sellCount}, user_activities=${uaCount}`,
      );

      jobLog.success(
        `Completed: users=${counts.users}, albums=${counts.albums}, media=${counts.media}, invites=${counts.invites}, accepted=${counts.accepted}, orders=${counts.orders} (total=${counts.ordersTotal}, completed=${counts.ordersCompleted}, skippedStatus=${counts.ordersSkippedStatus}, skippedCategory=${counts.ordersSkippedCategory}), sells=${counts.sells}, baseActivities=${counts.baseActivities}`,
      );

      return { ...counts, batches: batch, completed: true };
    } catch (err) {
      jobLog.failure('SeedAdminActivity failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
