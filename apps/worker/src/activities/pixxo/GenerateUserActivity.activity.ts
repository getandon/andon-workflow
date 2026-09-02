import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import { GenerateUserActivityInput, GenerateUserActivityOutput, requiredEnv, insertActivityEvent, upsertActivitySummary, findUnprocessedBatch, markProcessed, clearTargetActivity } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'album-server-db';
const DEFAULT_BATCH_SIZE = 100;

const TARGET_VERBS = ['SIGNED_UP'];
const TARGET_SOURCE_COLLECTIONS = ['user'];

@Injectable()
export class GenerateUserActivity {
  async generateUserActivity(
    input: GenerateUserActivityInput = {},
  ): Promise<GenerateUserActivityOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const client = new MongoClient(mongoUri, { authSource: database });
    let totalUsers = 0;
    let eventsCreated = 0;
    let batch = 0;

    try {
      await client.connect();
      const db = client.db(database);

      if (input.clearFirst) {
        const cleared = await clearTargetActivity(db, TARGET_VERBS, TARGET_SOURCE_COLLECTIONS);
        jobLog.warn(
          `Cleared target activity data: ${cleared.eventsDeleted} events, ${cleared.summariesDeleted} summaries, ${cleared.progressDeleted} progress`,
        );
      }

      while (true) {
        const users: any[] = await findUnprocessedBatch(db, 'user', batchSize);

        if (users.length === 0) break;

        for (const user of users) {
          const userObjId = user._id;
          const actorName = user?.name || (user?.email ? user.email.split('@')[0] : 'Unknown');

          const eventId = `Backfill_AccountSignedUp_${userObjId.toHexString()}`;
          const createdAt = userObjId.getTimestamp().getTime();

          try {
            const eventObjId = new ObjectId();
            await insertActivityEvent(db, {
              _id: eventObjId,
              eventId,
              userId: userObjId,
              actorId: userObjId,
              actorName,
              verb: 'SIGNED_UP',
              targetType: 'ACCOUNT',
              targetId: userObjId,
              metadata: { email: user.email },
              visibleToRoles: [],
              visibleToUserIds: [userObjId],
              visibilityVersion: 0,
              createdAt,
            });

            eventsCreated++;

            const isoTs = new Date(createdAt).toISOString().substring(0, 23);
            await upsertActivitySummary(
              db,
              {
                userId: userObjId,
                verb: 'SIGNED_UP',
                actorId: userObjId,
                timeWindow: isoTs,
              },
              {
                $setOnInsert: {
                  _id: new ObjectId(),
                  userId: userObjId,
                  verb: 'SIGNED_UP',
                  actorId: userObjId,
                  timeWindow: isoTs,
                  firstEventAt: createdAt,
                  metadata: { email: user.email },
                },
                $set: {
                  lastEventAt: createdAt,
                  actorName,
                  visibleToRoles: [],
                  visibleToUserIds: [userObjId],
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

          totalUsers++;
        }

        await markProcessed(db, 'user', users.map(u => u._id));
        batch++;

        jobLog.info(
          `Batch ${batch}: ${users.length} users → total users: ${totalUsers}, events: ${eventsCreated}`,
        );

        Context.current().heartbeat({
          batch,
          processedCount: totalUsers,
          eventsCreated,
        });
      }

      jobLog.success(
        `Completed: ${totalUsers} users processed, ${eventsCreated} activity events created`,
      );

      return {
        totalUsers,
        eventsCreated,
        batches: batch,
        completed: true,
      };
    } catch (err) {
      jobLog.failure('GenerateUserActivity failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
