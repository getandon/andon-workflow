import { Injectable } from '@nestjs/common';
import { Context, ApplicationFailure } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import { HydrateUserNamesFromEmailInput, HydrateUserNamesFromEmailOutput, requiredEnv } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'pixo';
const DEFAULT_BATCH_SIZE = 500;

@Injectable()
export class HydrateUserNamesFromEmailActivity {
  async hydrateUserNamesFromEmail(input: HydrateUserNamesFromEmailInput = {}): Promise<HydrateUserNamesFromEmailOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const heartbeatDetails = Context.current().info.heartbeatDetails as { lastId?: string } | undefined;
    const resumeId = input.lastId ?? heartbeatDetails?.lastId;

    let lastId: ObjectId | null = null;
    if (resumeId) {
      try {
        lastId = new ObjectId(resumeId);
      } catch {
        throw ApplicationFailure.nonRetryable(
          `Invalid lastId: "${resumeId}" is not a valid ObjectId`,
        );
      }
    }

    const client = new MongoClient(mongoUri);
    let totalProcessed = 0;
    let namesFixed = 0;
    let batch = 0;

    try {
      await client.connect();
      const db = client.db(database);
      const collection = db.collection('user');

      while (true) {
        const filter: Record<string, unknown> = { name: null, email: { $ne: null } };
        if (lastId) {
          filter._id = { $gt: lastId };
        }

        const users = await collection
          .find(filter)
          .project<{ _id: ObjectId; email: string }>({ _id: 1, email: 1 })
          .sort({ _id: 1 })
          .limit(batchSize)
          .toArray();

        if (users.length === 0) {
          break;
        }

        lastId = users[users.length - 1]._id;

        const bulkOps = users.map((u) => ({
          updateOne: {
            filter: { _id: u._id, name: null },
            update: { $set: { name: u.email.split('@')[0] } },
          },
        }));

        const result = await collection.bulkWrite(bulkOps);

        totalProcessed += users.length;
        namesFixed += result.modifiedCount;
        batch++;

        jobLog.info(
          `Batch ${batch}: processed ${users.length} users, fixed ${result.modifiedCount} names (total fixed: ${namesFixed})`,
        );

        Context.current().heartbeat({ batch, namesFixed, lastId: lastId.toHexString() });
      }

      jobLog.success(
        `Completed: ${namesFixed} null names hydrated from email across ${batch} batches`,
      );

      return { totalProcessed, namesFixed, batches: batch, completed: true };
    } catch (err) {
      jobLog.failure('HydrateUserNamesFromEmail failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
