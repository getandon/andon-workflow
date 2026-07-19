import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { MongoClient, ObjectId } from 'mongodb';
import { MarkUserAsLegacyInput, MarkUserAsLegacyOutput, requiredEnv } from '@andon-workflow/lib';
import { jobLog } from '../../job-log';

const DEFAULT_DATABASE = 'pixo';
const DEFAULT_BATCH_SIZE = 500;

@Injectable()
export class MarkUserAsLegacyActivity {
  async markUserAsLegacy(input: MarkUserAsLegacyInput = {}): Promise<MarkUserAsLegacyOutput> {
    const database = input.database ?? process.env.MONGO_DATABASE ?? DEFAULT_DATABASE;
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const mongoUri = requiredEnv('MONGODB_URI');

    const client = new MongoClient(mongoUri);
    let totalMatched = 0;
    let totalModified = 0;
    let batch = 0;
    let lastId: ObjectId | null = input.lastId ? new ObjectId(input.lastId) : null;

    try {
      await client.connect();
      const db = client.db(database);
      const collection = db.collection('user');

      while (true) {
        const filter = lastId ? { _id: { $gt: lastId } } : {};
        const users = await collection
          .find(filter)
          .project<{ _id: ObjectId }>({ _id: 1 })
          .sort({ _id: 1 })
          .limit(batchSize)
          .toArray();

        if (users.length === 0) {
          break;
        }

        lastId = users[users.length - 1]._id;
        const ids = users.map((u) => u._id);

        const result = await collection.updateMany(
          { _id: { $in: ids }, isLegacy: { $ne: true } },
          { $set: { isLegacy: true } },
        );

        totalMatched += ids.length;
        totalModified += result.modifiedCount;
        batch++;

        jobLog.info(
          `Batch ${batch}: matched ${ids.length} users, modified ${result.modifiedCount} (total modified: ${totalModified})`,
        );

        Context.current().heartbeat({ batch, lastId: lastId.toHexString() });
      }

      jobLog.success(
        `Completed: ${totalModified} users marked as legacy across ${batch} batches`,
      );

      return { totalMatched, totalModified, batches: batch, completed: true };
    } catch (err) {
      jobLog.failure('MarkUserAsLegacy failed', err);
      throw err;
    } finally {
      await client.close();
    }
  }
}
