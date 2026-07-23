import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import { GenerateAlbumActivityInput, GenerateAlbumActivityOutput, requiredEnv, toHex, toObjectId, fetchUserMap, insertActivityEvent, upsertActivitySummary } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';
const DEFAULT_BATCH_SIZE = 50;

const VISIBLE_TO_ROLES = ['OWNER', 'MANAGER', 'GUEST'];

@Injectable()
export class GenerateAlbumActivity {
  async generateAlbumActivity(
    input: GenerateAlbumActivityInput = {},
  ): Promise<GenerateAlbumActivityOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const client = new MongoClient(mongoUri, { authSource: database });
    let totalAlbums = 0;
    let eventsCreated = 0;
    let batch = 0;
    let lastId: ObjectId | null = input.lastId ? new ObjectId(input.lastId) : null;

    try {
      await client.connect();
      const db = client.db(database);

      while (true) {
        const filter = lastId ? { _id: { $gt: lastId } } : {};
        const albums: any[] = await db
          .collection('album')
          .find(filter)
          .project({
            _id: 1,
            author: 1,
            name: 1,
            type: 1,
            date: 1,
            createdAt: 1,
          })
          .sort({ _id: 1 })
          .limit(batchSize)
          .toArray();

        if (albums.length === 0) break;

        const authorIds = albums
          .filter(a => a.author)
          .map(a => toHex(a.author))
          .filter(h => h && h.length === 24);

        const albumsWithoutAuthor = albums.filter(a => !a.author);
        const albumObjIds = albumsWithoutAuthor.map(a => a._id);

        let ownerRoles: any[] = [];
        const albumToOwner = new Map<string, ObjectId>();

        if (albumObjIds.length > 0) {
          ownerRoles = await db
            .collection('album_role')
            .find({ album: { $in: albumObjIds }, userRole: 'OWNER' })
            .project({ _id: 1, album: 1, user: 1 })
            .toArray();

          for (const role of ownerRoles) {
            if (role.user) {
              albumToOwner.set(role.album.toHexString(), role.user);
            }
          }
        }

        const ownerUserIds = ownerRoles
          .map(r => toHex(r.user))
          .filter(h => h && h.length === 24);

        const allUserIds = [...authorIds, ...ownerUserIds];
        const userMap = await fetchUserMap(db, allUserIds);

        for (const album of albums) {
          const albumId = album._id.toHexString();
          let actorObjId: ObjectId;
          let actorId = toHex(album.author);

          if (album.author) {
            actorObjId = toObjectId(album.author) ?? new ObjectId('000000000000000000000000');
          } else {
            const ownerUserId = albumToOwner.get(albumId);
            if (ownerUserId) {
              actorObjId = toObjectId(ownerUserId) ?? new ObjectId('000000000000000000000000');
              actorId = toHex(ownerUserId);
            } else {
              jobLog.warn(`Album ${albumId} has no author and no OWNER in album_role, using placeholder actor`);
              actorObjId = new ObjectId('000000000000000000000000');
              actorId = '';
            }
          }

          const user = actorId ? userMap.get(actorId) : undefined;
          const actorName = user?.name || (user?.email ? user.email.split('@')[0] : 'Unknown');

          const eventId = `Backfill_AlbumCreated_${albumId}`;
          const createdAt = Number(album.createdAt) || album._id.getTimestamp().getTime();

          try {
            const eventObjId = new ObjectId();
            await insertActivityEvent(db, {
              _id: eventObjId,
              eventId,
              albumId: album._id,
              actorId: actorObjId,
              actorName,
              verb: 'CREATED',
              targetType: 'ALBUM',
              targetId: album._id,
              metadata: { name: album.name, type: album.type, date: Number(album.date) || 0 },
              visibleToRoles: VISIBLE_TO_ROLES,
              visibleToUserIds: [],
              visibilityVersion: 0,
              createdAt,
            });

            eventsCreated++;

            const isoDate = new Date(createdAt).toISOString().substring(0, 10);
            await upsertActivitySummary(
              db,
              {
                albumId: album._id,
                verb: 'CREATED',
                actorId: actorObjId,
                timeWindow: isoDate,
              },
              {
                $setOnInsert: {
                  _id: new ObjectId(),
                  verb: 'CREATED',
                  actorId: actorObjId,
                  timeWindow: isoDate,
                  firstEventAt: createdAt,
                  albumId: album._id,
                  metadata: { name: album.name, type: album.type, date: Number(album.date) || 0 },
                },
                $set: {
                  lastEventAt: createdAt,
                  actorName,
                  visibleToRoles: VISIBLE_TO_ROLES,
                  visibleToUserIds: [],
                },
                $addToSet: { eventIds: eventObjId },
                $inc: { count: 1 },
              },
              eventId,
              jobLog,
            );
          } catch (err: any) {
            if (err.code === 11000) {
              continue;
            }
            throw err;
          }

          totalAlbums++;
        }

        lastId = albums[albums.length - 1]._id;
        batch++;

        jobLog.info(
          `Batch ${batch}: ${albums.length} albums → total albums: ${totalAlbums}, events: ${eventsCreated}`,
        );

        Context.current().heartbeat({
          batch,
          lastId: lastId!.toHexString(),
          totalAlbums,
          eventsCreated,
        });
      }

      jobLog.success(
        `Completed: ${totalAlbums} albums processed, ${eventsCreated} activity events created`,
      );

      return {
        totalAlbums,
        eventsCreated,
        batches: batch,
        completed: true,
      };
    } catch (err) {
      jobLog.failure('GenerateAlbumActivity failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
