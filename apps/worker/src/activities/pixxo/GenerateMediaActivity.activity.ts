import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import { GenerateMediaActivityInput, GenerateMediaActivityOutput, requiredEnv, toHex, toObjectId } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';
const DEFAULT_BATCH_SIZE = 100;

const VISIBLE_TO_ROLES = ['OWNER', 'MANAGER', 'GUEST'];

interface MediaGroup {
  albumId: string;
  albumObjId: ObjectId;
  authorId: string;
  authorObjId: ObjectId;
  date: string;
  mediaIds: string[];
  earliestTimestamp: number;
}

@Injectable()
export class GenerateMediaActivity {
  async generateMediaActivity(
    input: GenerateMediaActivityInput = {},
  ): Promise<GenerateMediaActivityOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const client = new MongoClient(mongoUri, { authSource: database });
    let totalMedia = 0;
    let groupsCreated = 0;
    let eventsCreated = 0;
    let batch = 0;
    let lastId: ObjectId | null = input.lastId ? new ObjectId(input.lastId) : null;

    try {
      await client.connect();
      const db = client.db(database);

      const activeGroups = new Map<string, MediaGroup>();

      function groupKey(albumId: string, authorId: string, date: string): string {
        return `${albumId}::${authorId}::${date}`;
      }

      async function flushGroup(group: MediaGroup): Promise<void> {
        const key = groupKey(group.albumId, group.authorId, group.date);
        activeGroups.delete(key);

        const user = await db
          .collection('user')
          .findOne({ _id: group.authorObjId }, { projection: { name: 1, email: 1 } });

        const actorName = user?.name || (user?.email ? user.email.split('@')[0] : 'Unknown');

        const eventId = `Backfill_AlbumMediasUploaded_${group.albumId}_${group.authorId}_${group.date}`;
        const createdAt = group.earliestTimestamp;

        try {
          const eventObjId = new ObjectId();
          await db.collection('activity_event').insertOne({
            _id: eventObjId,
            eventId,
            albumId: group.albumObjId,
            actorId: group.authorObjId,
            actorName,
            verb: 'UPLOADED',
            targetType: 'MEDIA',
            targetId: group.albumObjId,
            metadata: {
              mediaIds: group.mediaIds,
              photoCount: group.mediaIds.length,
            },
            visibleToRoles: VISIBLE_TO_ROLES,
            visibleToUserIds: [],
            visibilityVersion: 0,
            createdAt,
          });

          await db.collection('activity_summary').updateOne(
            {
              albumId: group.albumObjId,
              verb: 'UPLOADED',
              actorId: group.authorObjId,
              timeWindow: group.date,
            },
            {
              $setOnInsert: {
                _id: new ObjectId(),
                albumId: group.albumObjId,
                verb: 'UPLOADED',
                actorId: group.authorObjId,
                timeWindow: group.date,
                firstEventAt: createdAt,
              },
              $set: {
                lastEventAt: createdAt,
                actorName,
                visibleToRoles: VISIBLE_TO_ROLES,
                visibleToUserIds: [],
              },
              $addToSet: {
                eventIds: eventObjId,
                'metadata.mediaIds': { $each: group.mediaIds },
              },
              $inc: {
                count: 1,
                'metadata.photoCount': group.mediaIds.length,
              },
            },
            { upsert: true },
          );

          eventsCreated++;
        } catch (err: any) {
          if (err.code === 11000) {
            return;
          }
          throw err;
        }
      }

      let lastDate: string | null = null;

      while (true) {
        const filter = lastId ? { _id: { $gt: lastId } } : {};
        const mediaDocs = await db
          .collection('media')
          .find(filter)
          .project<{ _id: ObjectId; album: any; author: any; uploadAt: number }>({
            _id: 1,
            album: 1,
            author: 1,
            uploadAt: 1,
          })
          .sort({ _id: 1 })
          .limit(batchSize)
          .toArray();

        if (mediaDocs.length === 0) break;

        for (const media of mediaDocs) {
          const albumId = toHex(media.album);
          const authorId = toHex(media.author);
          let albumObjId = toObjectId(media.album);
          let authorObjId = toObjectId(media.author);
          if (!albumObjId) albumObjId = new ObjectId('000000000000000000000000');
          if (!authorObjId) authorObjId = new ObjectId('000000000000000000000000');
          const uploadAt = Number(media.uploadAt) || media._id.getTimestamp().getTime();
          const date = new Date(uploadAt).toISOString().substring(0, 10);

          if (lastDate !== null && date !== lastDate) {
            const staleKeys: string[] = [];
            for (const [key, group] of activeGroups) {
              if (group.date !== date) {
                staleKeys.push(key);
              }
            }
            for (const key of staleKeys) {
              const group = activeGroups.get(key)!;
              await flushGroup(group);
              groupsCreated++;
            }
          }
          lastDate = date;

          const key = groupKey(albumId, authorId, date);
          let group = activeGroups.get(key);
          if (!group) {
            group = {
              albumId,
              albumObjId,
              authorId,
              authorObjId,
              date,
              mediaIds: [],
              earliestTimestamp: uploadAt,
            };
            activeGroups.set(key, group);
          }

          group.mediaIds.push(media._id.toHexString());
          if (uploadAt < group.earliestTimestamp) {
            group.earliestTimestamp = uploadAt;
          }

          totalMedia++;
        }

        lastId = mediaDocs[mediaDocs.length - 1]._id;
        batch++;

        jobLog.info(
          `Batch ${batch}: ${mediaDocs.length} media → total: ${totalMedia}, groups: ${activeGroups.size}, events: ${eventsCreated}`,
        );

        Context.current().heartbeat({
          batch,
          lastId: lastId.toHexString(),
          totalMedia,
          groupsCreated,
          eventsCreated,
        });
      }

      for (const group of activeGroups.values()) {
        await flushGroup(group);
        groupsCreated++;
      }

      jobLog.success(
        `Completed: ${totalMedia} media → ${groupsCreated} groups, ${eventsCreated} activity events created`,
      );

      return {
        totalMedia,
        groupsCreated,
        eventsCreated,
        batches: batch,
        completed: true,
      };
    } catch (err) {
      jobLog.failure('GenerateMediaActivity failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}