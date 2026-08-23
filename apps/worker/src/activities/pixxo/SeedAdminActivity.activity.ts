import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import {
  SeedAdminActivityInput,
  SeedAdminActivityOutput,
  requiredEnv,
  toHex,
  toObjectId,
  markProcessed,
} from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';
const DEFAULT_ADMIN_DATABASE = 'pixo-admin-db';
const DEFAULT_BATCH_SIZE = 100;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const PLACEHOLDER_HEX = '000000000000000000000000';

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

      await dst
        .collection('backfill_progress')
        .createIndex({ sourceCollection: 1, sourceId: 1 }, { unique: true });

      if (input.clearFirst) {
        for (const c of [
          'base_activities',
          'activities',
          'user_activities',
          'sells',
          'albums',
          'album_types',
          'users',
          'backfill_progress',
        ]) {
          await dst.collection(c).deleteMany({});
        }
        jobLog.warn('Cleared admin analytics collections');
      }

      const findUnprocessed = async (sourceCollection: string): Promise<any[]> => {
        const processed = await dst
          .collection('backfill_progress')
          .find({ sourceCollection })
          .project({ sourceId: 1 })
          .toArray();
        const processedIds = processed.map((p: any) => p.sourceId);
        if (processedIds.length === 0) {
          return src
            .collection(sourceCollection)
            .find({})
            .sort({ _id: 1 })
            .limit(batchSize)
            .toArray();
        }
        return src
          .collection(sourceCollection)
          .find({ _id: { $nin: processedIds } })
          .limit(batchSize)
          .toArray();
      };

      const markDone = async (sourceCollection: string, ids: ObjectId[]) => {
        await markProcessed(dst, sourceCollection, ids);
      };

      const insertBase = async (
        date: DateParts,
        authorId: ObjectId,
        type: string,
        metadata: Record<string, unknown>,
      ) => {
        await dst.collection('base_activities').insertOne({ ...date, authorId, type, metadata });
        counts.baseActivities++;
      };

      const incActivity = async (date: DateParts, inc: Record<string, number>) => {
        await dst.collection('activities').updateOne(date, { $inc: inc }, { upsert: true });
      };

      const incUserActivity = async (
        date: DateParts,
        inc: Record<string, number>,
        activeUserId?: ObjectId,
      ) => {
        const update: any = { $inc: inc };
        if (activeUserId) update.$addToSet = { activeUserIds: activeUserId };
        await dst.collection('user_activities').updateOne(date, update, { upsert: true });
      };

      // ── Phase 1: users → signup ────────────────────────────────────────────
      while (true) {
        const users = await findUnprocessed('user');
        if (users.length === 0) break;

        for (const u of users) {
          const date = dateParts(tsOf(u));
          const authorId = u._id;
          await insertBase(date, authorId, 'signup', { email: u.email });
          await incActivity(date, { users: 1 });
          await incUserActivity(date, { newUsers: 1 }, authorId);
          await dst
            .collection('users')
            .updateOne({ _id: authorId }, { $setOnInsert: { email: u.email } }, { upsert: true });
          counts.users++;
        }

        await markDone('user', users.map((u: any) => u._id));
        batch++;
        Context.current().heartbeat({ phase: 'users', batch, users: counts.users });
      }

      // ── Phase 2: albums → createAlbum ──────────────────────────────────────
      while (true) {
        const albums = await findUnprocessed('album');
        if (albums.length === 0) break;

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

        for (const a of albums) {
          const date = dateParts(tsOf(a));
          const albumId = a._id;
          let authorId = toObjectId(a.author);
          if (!authorId) authorId = albumToOwner.get(albumId.toHexString()) ?? new ObjectId(PLACEHOLDER_HEX);

          const metadata = {
            albumId: albumId.toHexString(),
            name: a.name,
            type: String(a.type ?? ''),
            date: Number(a.date) || 0,
          };
          await insertBase(date, authorId, 'createAlbum', metadata);
          await incActivity(date, { albums: 1 });
          await incUserActivity(date, { albums: 1 }, authorId);
          await dst.collection('albums').updateOne(
            { _id: albumId },
            {
              $setOnInsert: {
                authorId,
                name: a.name,
                type: String(a.type ?? ''),
                date: Number(a.date) || 0,
                medias: 0,
              },
            },
            { upsert: true },
          );
          await dst
            .collection('album_types')
            .updateOne({ type: a.type }, { $inc: { value: 1 } }, { upsert: true });
          counts.albums++;
        }

        await markDone('album', albums.map((a: any) => a._id));
        batch++;
        Context.current().heartbeat({ phase: 'albums', batch, albums: counts.albums });
      }

      // ── Phase 3: media → uploadImage ───────────────────────────────────────
      while (true) {
        const mediaDocs = await findUnprocessed('media');
        if (mediaDocs.length === 0) break;

        for (const m of mediaDocs) {
          const date = dateParts(tsOf(m, 'uploadAt'));
          const albumId = toObjectId(m.album) ?? new ObjectId(PLACEHOLDER_HEX);
          const authorId = toObjectId(m.author) ?? new ObjectId(PLACEHOLDER_HEX);
          const size = (m.formats ?? []).reduce((s: number, f: any) => s + (Number(f.size) || 0), 0);

          await insertBase(date, authorId, 'uploadImage', {
            albumId: toHex(m.album),
            mediaId: m._id.toHexString(),
            size,
          });
          await incActivity(date, { medias: 1, uploads: 1, size });
          await incUserActivity(date, { medias: 1, uploads: 1 }, authorId);
          await dst.collection('albums').updateOne({ _id: albumId }, { $inc: { medias: 1 } });
          counts.media++;
        }

        await markDone('media', mediaDocs.map((m: any) => m._id));
        batch++;
        Context.current().heartbeat({ phase: 'media', batch, media: counts.media });
      }

      // ── Phase 4: invites → invite ──────────────────────────────────────────
      while (true) {
        const invites = await findUnprocessed('album_invite');
        if (invites.length === 0) break;

        for (const i of invites) {
          const date = dateParts(tsOf(i));
          const albumId = toObjectId(i.album) ?? new ObjectId(PLACEHOLDER_HEX);
          const authorId = toObjectId(i.author) ?? new ObjectId(PLACEHOLDER_HEX);

          await insertBase(date, authorId, 'invite', {
            albumId: toHex(i.album),
            email: i.inviteKey ?? i.email ?? '',
            inviteId: i._id.toHexString(),
          });
          await incUserActivity(date, { invites: 1 }, authorId);
          await dst.collection('albums').updateOne({ _id: albumId }, { $inc: { invites: 1 } });
          counts.invites++;
        }

        await markDone('album_invite', invites.map((i: any) => i._id));
        batch++;
        Context.current().heartbeat({ phase: 'invites', batch, invites: counts.invites });
      }

      // ── Phase 5: roles → acceptInvite ──────────────────────────────────────
      while (true) {
        const roles = await findUnprocessed('album_role');
        if (roles.length === 0) break;

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

        for (const r of roles) {
          if (r.userRole === 'OWNER') continue;
          const userId = toHex(r.user);
          const albumId = toHex(r.album);
          if (userId === authorMap.get(albumId)) continue;

          const date = dateParts(tsOf(r));
          const userObjId = toObjectId(r.user) ?? new ObjectId(PLACEHOLDER_HEX);
          const albumObjId = toObjectId(r.album) ?? new ObjectId(PLACEHOLDER_HEX);

          await insertBase(date, userObjId, 'acceptInvite', {
            inviteId: '',
            type: String(r.userRole ?? ''),
            albumId,
          });
          await incUserActivity(date, { accepted: 1 }, userObjId);
          await dst.collection('albums').updateOne({ _id: albumObjId }, { $inc: { accepted: 1 } });
          counts.accepted++;
        }

        await markDone('album_role', roles.map((r: any) => r._id));
        batch++;
        Context.current().heartbeat({ phase: 'roles', batch, accepted: counts.accepted });
      }

      // ── Phase 6: orders → purchase ─────────────────────────────────────────
      const packages = await src.collection('packages').find({}).toArray();
      let sampledStatuses: Array<{ status: string; category: string }> = [];
      while (true) {
        const orders = await findUnprocessed('order');
        if (orders.length === 0) break;

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

          const amount = o.subtotal ?? (o.items ?? []).reduce(
            (s: number, it: any) => s + (it.prices?.[0]?.price ?? 0),
            0,
          );
          const name = resolvePackageName(o, packages);
          const type = category === 'ADDON' ? 'purchaseFeature' : 'purchasePackage';

          await insertBase(date, userObjId, type, {
            packageId: o.packageId ?? o._id.toHexString(),
            name,
            amount,
            currency: 'EUR',
          });

          await dst.collection('sells').insertOne({
            ...date,
            type: category === 'ADDON' ? 'feature' : 'package',
            name,
            count: 1,
            revenue: amount,
          });
          counts.sells++;

          const duration = (o.items ?? []).find((it: any) => it.type === 'YEAR')?.quantity ?? 0;
          await incUserActivity(
            date,
            category === 'ADDON' ? { features: 1 } : { packages: 1 },
            userObjId,
          );
          if (category !== 'ADDON') {
            await dst
              .collection('users')
              .updateOne({ _id: userObjId }, { $set: { endTime: tsOf(o) + duration * ONE_YEAR_MS } });
          }

          counts.orders++;
        }

        // Only mark the batch "done" for orders whose sells were actually written;
        // otherwise `backfill_progress` would hide them from future re-runs.
        const writtenIds = orders
          .filter((o: any) => String(o?.status ?? '').toUpperCase() === 'COMPLETED' && !['TRYON', 'GUEST'].includes(o?.category ?? ''))
          .map((o: any) => o._id);
        if (writtenIds.length > 0) {
          await markDone('order', writtenIds);
        }
        batch++;
        Context.current().heartbeat({
          phase: 'orders',
          batch,
          orders: counts.orders,
          ordersTotal: counts.ordersTotal,
          sells: counts.sells,
        });
      }

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
