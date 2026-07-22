import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import { GenerateAlbumActivityInput, GenerateAlbumActivityOutput, requiredEnv } from '@andon-workflow/lib';
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
        const albums = await db
          .collection('album')
          .find(filter)
          .project<{ _id: ObjectId; author?: ObjectId; name: string; type: string; date: number; createdAt: number }>({
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

        const authorIds = [...new Set(albums.filter(a => a.author).map(a => a.author!.toHexString()))];
        const users = authorIds.length > 0
          ? await db
            .collection('user')
            .find({ _id: { $in: authorIds.map(id => new ObjectId(id)) } })
            .project<{ _id: ObjectId; name?: string; email: string }>({ _id: 1, name: 1, email: 1 })
            .toArray()
          : [];

        const userMap = new Map<string, { name?: string; email: string }>();
        for (const u of users) {
          userMap.set(u._id.toHexString(), { name: u.name, email: u.email });
        }

        for (const album of albums) {
          const albumId = album._id.toHexString();
          const actorId = album.author?.toHexString();
          if (!actorId) {
            jobLog.warn(`Album ${albumId} has no author, skipping`);
            continue;
          }

          const user = userMap.get(actorId);
          const actorName = user?.name || (user?.email ? user.email.split('@')[0] : 'Unknown');

          const eventId = `Backfill_AlbumCreated_${albumId}`;
          const createdAt = album.createdAt || album._id.getTimestamp().getTime();

          try {
            const eventObjId = new ObjectId();
            await db.collection('activity_event').insertOne({
              _id: eventObjId,
              eventId,
              albumId: album._id,
              actorId: album.author!,
              actorName,
              verb: 'CREATED',
              targetType: 'ALBUM',
              targetId: album._id,
              metadata: { name: album.name, type: album.type, date: album.date },
              visibleToRoles: VISIBLE_TO_ROLES,
              visibleToUserIds: [],
              visibilityVersion: 0,
              createdAt,
            });

            const isoDate = new Date(createdAt).toISOString().substring(0, 10);
            await db.collection('activity_summary').updateOne(
              {
                albumId: album._id,
                verb: 'CREATED',
                actorId: album.author!,
                timeWindow: isoDate,
              },
              {
                $setOnInsert: {
                  _id: new ObjectId(),
                  verb: 'CREATED',
                  actorId: album.author!,
                  timeWindow: isoDate,
                  firstEventAt: createdAt,
                  albumId: album._id,
                  metadata: { name: album.name, type: album.type, date: album.date },
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
              { upsert: true },
            );

            eventsCreated++;
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
          lastId: lastId.toHexString(),
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
